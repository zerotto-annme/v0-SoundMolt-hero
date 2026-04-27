import { NextResponse } from "next/server"
import { getAdminClient, getUserFromAuthHeader, hasServiceRoleKey } from "@/lib/supabase-admin"
import {
  extractEssentiaFeatures,
  generateProducerReport,
  loadCachedTrackFeatures,
} from "@/lib/ai-producer-analysis"

// POST /api/ai-producer/review
//
// Stage-1 endpoint for the AI Producer Review module. Creates a new
// review row in public.ai_producer_reviews and runs the (mocked) AI
// analysis to populate report_json.
//
// Hard rules enforced here:
//   • Auth required — Bearer JWT, validated server-side.
//   • A review is ALWAYS created, even when the user has 0 credits.
//     Credits affect ONLY the access_type / blur on the report page,
//     not whether a review exists.
//   • Review creation must be atomic with credit accounting:
//       1. read user_credits
//       2. insert review (status=processing, access_type computed)
//       3. if a credit was spent → bump user_credits, log a row in
//          credit_transactions tied to the new review.id
//       4. run mock analysis → write report_json + status=ready
//   • This module is private. We only ever write to ai_producer_*
//     tables (and the credit_* helpers). The normal Upload Track /
//     /api/tracks / feed pipeline is NOT touched.
//
// Body:
//   {
//     source_type:   "uploaded_file" | "existing_track",
//     audio_url:     string,
//     track_id?:     string,        // when source_type=uploaded_file
//     original_track_id?: string,   // when source_type=existing_track
//     title?:        string,
//     genre?:        string,
//     daw?:          string,
//     feedback_focus?: string,
//     comment?:      string
//   }
//
// Response:
//   200 { ok: true, review: { id, status, access_type, credits_used } }
//   400 invalid input
//   401 unauthorized
//   500 server misconfigured / unknown error

const MAX_TEXT_LEN = 4000

function clampText(value: unknown, max = MAX_TEXT_LEN): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  return trimmed.slice(0, max)
}

function readUuid(value: unknown): string | null {
  if (typeof value !== "string") return null
  const v = value.trim()
  // permissive uuid check — Postgres will hard-validate on insert
  if (!/^[0-9a-f-]{32,36}$/i.test(v)) return null
  return v
}

// ─── Real AI analysis (Stage 7) ────────────────────────────────────────
// The mock that lived here was replaced by a two-step pipeline:
//   1. Pull (or compute) raw Essentia features for the audio file.
//   2. Ask OpenAI gpt-4o-mini to turn those features + the user's
//      submission inputs into a producer-style report_json.
// See lib/ai-producer-analysis.ts for both helpers. All failure paths
// are surfaced into report_json.error and status="failed" so the
// frontend's existing failed-review screen can render them; we never
// crash the request because the credit was already debited.

export async function POST(request: Request) {
  console.log("AI PRODUCER REQUEST RECEIVED")
  try {
  if (!hasServiceRoleKey()) {
    console.error("[api/ai-producer/review] missing service role key")
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 })
  }

  const authed = await getUserFromAuthHeader(request)
  if (!authed) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 })
  }

  const sourceType = typeof body?.source_type === "string" ? body.source_type : null
  if (sourceType !== "uploaded_file" && sourceType !== "existing_track") {
    return NextResponse.json(
      { error: "invalid_source_type", message: "source_type must be 'uploaded_file' or 'existing_track'." },
      { status: 400 },
    )
  }

  let audioUrl = clampText(body?.audio_url, 2000)
  // Optional: track duration in seconds. Existing tracks resolve it
  // server-side from public.tracks.duration_seconds; uploaded files
  // may pass it from the client. We only use it as a fallback hint
  // for the LLM prompt (Stage 8) — never block on it.
  let trackDurationSeconds: number | null =
    typeof body?.track_duration === "number" && Number.isFinite(body.track_duration) && body.track_duration > 0
      ? Math.round(body.track_duration)
      : null

  const trackId = readUuid(body?.track_id)
  const originalTrackId = readUuid(body?.original_track_id)

  // Mode-specific id requirement: existing_track must reference a real
  // tracks row; uploaded_file may carry a free-form internal id (or
  // none at all).
  if (sourceType === "existing_track" && !originalTrackId) {
    return NextResponse.json(
      { error: "missing_original_track_id", message: "original_track_id is required for existing_track reviews." },
      { status: 400 },
    )
  }

  // For uploaded_file, audio_url MUST be supplied by the caller (the
  // upload component generates it via Supabase storage). For
  // existing_track we resolve it server-side from public.tracks below
  // so callers can safely send only { source_type, original_track_id }
  // without exposing or having to know the storage URL.
  if (sourceType === "uploaded_file" && !audioUrl) {
    return NextResponse.json(
      { error: "missing_audio_url", message: "audio_url is required." },
      { status: 400 },
    )
  }

  const title = clampText(body?.title, 200)
  const genre = clampText(body?.genre, 100)
  const daw = clampText(body?.daw, 100)
  const feedbackFocus = clampText(body?.feedback_focus, 200)
  const comment = clampText(body?.comment, MAX_TEXT_LEN)

  const admin = getAdminClient()

  // ─── Authorize and resolve audio_url for existing_track ────────────
  // Owner-only. Always look up the track row server-side to:
  //   (a) verify the caller actually owns this track (broken access
  //       control otherwise — a logged-in user could post any other
  //       user's track id and burn their own credit on it),
  //   (b) fetch the canonical audio_url so we cannot be tricked into
  //       analysing a spoofed external file.
  // We deliberately IGNORE any client-supplied audio_url for
  // existing_track requests; the public.tracks row is the source of
  // truth. Backward-compat for the existing /ai-producer page is
  // preserved because that page also points at a real track row owned
  // by the same user — the server-resolved url will match.
  if (sourceType === "existing_track") {
    const { data: trackRow, error: trackErr } = await admin
      .from("tracks")
      .select("user_id, audio_url, duration_seconds")
      .eq("id", originalTrackId as string)
      .maybeSingle()
    if (trackErr) {
      console.error("[api/ai-producer/review] track lookup failed:", trackErr)
      return NextResponse.json(
        { error: "track_lookup_failed", message: trackErr.message },
        { status: 500 },
      )
    }
    if (!trackRow) {
      return NextResponse.json(
        { error: "track_not_found", message: "Could not resolve the requested track." },
        { status: 404 },
      )
    }
    if (trackRow.user_id !== authed.id) {
      // Same shape as the spec for owner-only buttons: report not-
      // found rather than leaking ownership info.
      return NextResponse.json(
        { error: "forbidden", message: "You can only run AI Producer reviews on your own tracks." },
        { status: 403 },
      )
    }
    const resolved = clampText(trackRow.audio_url, 2000)
    if (!resolved) {
      return NextResponse.json(
        { error: "track_no_audio", message: "Track has no playable audio file." },
        { status: 500 },
      )
    }
    audioUrl = resolved
    if (typeof trackRow.duration_seconds === "number" && trackRow.duration_seconds > 0) {
      trackDurationSeconds = Math.round(trackRow.duration_seconds)
    } else if (typeof trackRow.duration_seconds === "string") {
      const n = Number(trackRow.duration_seconds)
      if (Number.isFinite(n) && n > 0) trackDurationSeconds = Math.round(n)
    }
  }

  // ─── 1. Read current credit balance (or treat missing row as 0) ─────
  let currentBalance = 0
  try {
    const { data: creditsRow, error: creditsErr } = await admin
      .from("user_credits")
      .select("credits_balance")
      .eq("user_id", authed.id)
      .maybeSingle()
    if (creditsErr) {
      console.error("[api/ai-producer/review] credits read failed:", creditsErr)
    } else if (creditsRow && typeof creditsRow.credits_balance === "number") {
      currentBalance = creditsRow.credits_balance
    }
  } catch (err) {
    console.error("[api/ai-producer/review] credits read threw:", err)
  }

  const willSpendCredit = currentBalance >= 1
  const accessType = willSpendCredit ? "full" : "free"
  const creditsUsed = willSpendCredit ? 1 : 0

  // ─── 2. Insert the review row (status=processing) ──────────────────
  const insertPayload = {
    user_id: authed.id,
    track_id: sourceType === "uploaded_file" ? trackId : null,
    original_track_id: sourceType === "existing_track" ? originalTrackId : null,
    source_type: sourceType,
    audio_url: audioUrl,
    title,
    genre,
    daw,
    feedback_focus: feedbackFocus,
    comment,
    status: "processing" as const,
    access_type: accessType as "free" | "full",
    credits_used: creditsUsed,
  }

  const { data: review, error: insertErr } = await admin
    .from("ai_producer_reviews")
    .insert(insertPayload)
    .select("id, status, access_type, credits_used")
    .single()

  if (insertErr || !review) {
    console.error("[api/ai-producer/review] review insert failed:", insertErr)
    return NextResponse.json(
      { error: "review_insert_failed", message: insertErr?.message ?? "Failed to create review." },
      { status: 500 },
    )
  }

  // ─── 3. If we spent a credit, debit balance + write ledger entry ───
  // Best-effort: if either step fails we log but DO NOT fail the
  // request — the review itself was created successfully and the user
  // would otherwise lose their submission. The mismatch is observable
  // in logs and via the admin credits page (Stage 5).
  if (willSpendCredit) {
    const newBalance = currentBalance - 1

    // Use upsert so a missing user_credits row is created if necessary
    // (defensive — currentBalance only > 0 when a row already exists,
    // but we keep the path resilient to manual data edits).
    const { error: balanceErr } = await admin
      .from("user_credits")
      .upsert(
        { user_id: authed.id, credits_balance: newBalance },
        { onConflict: "user_id" },
      )
    if (balanceErr) {
      console.error("[api/ai-producer/review] credit debit failed:", balanceErr)
    }

    const { error: txErr } = await admin
      .from("credit_transactions")
      .insert({
        user_id: authed.id,
        amount: -1,
        type: "review_spend",
        reason: "AI Producer Review",
        review_id: review.id,
      })
    if (txErr) {
      console.error("[api/ai-producer/review] credit ledger insert failed:", txErr)
    }
  }

  // ─── 4. Background analysis: Essentia features → OpenAI report ────
  // The route returns IMMEDIATELY here with status="processing" so the
  // browser never sees a "Failed to fetch" timeout on a 30–60 second
  // pipeline. The actual analysis runs as a fire-and-forget task that
  // updates the row to "ready" / "failed" + report_json when done.
  // The review page (app/ai-producer/reviews/[id]/page.tsx) already
  // polls every 3s until the row flips off "processing".
  // Pipeline (per Stage 7 spec):
  //   a. Resolve raw audio features. For an existing track we first
  //      try the cached track_analysis row (avoids re-uploading the
  //      audio to Essentia for the same file). For an uploaded file
  //      we always extract fresh.
  //   b. If features cannot be obtained → status=failed with the
  //      Essentia error in report_json.error. Credit stays debited
  //      (we already charged once and never charge "extra").
  //   c. Hand the features + user inputs to OpenAI gpt-4o-mini.
  //      LLM failure → status=failed with the OpenAI error in
  //      report_json.error.
  //   d. Success → status=ready with the structured report_json.
  console.log(`[api/ai-producer/review] review ${review.id} created (source=${sourceType}, credits_used=${creditsUsed})`)

  const finalizeReview = async () => {
    let finalStatus: "ready" | "failed" = "ready"
    let reportJson: unknown = null

    try {
      // 4a. Audio features.
      console.log(`[api/ai-producer/review] ${review.id} audio analysis started`)
      let features: Record<string, unknown> | null = null
      let analysisError: string | null = null
      if (sourceType === "existing_track" && originalTrackId) {
        const cached = await loadCachedTrackFeatures(admin, originalTrackId)
        if (cached) {
          features = cached
          console.log(`[api/ai-producer/review] ${review.id} audio analysis completed (cached)`)
        }
      }
      if (!features) {
        const extract = await extractEssentiaFeatures(audioUrl as string)
        if (extract.ok) {
          features = extract.features
          console.log(`[api/ai-producer/review] ${review.id} audio analysis completed (fresh)`)
        } else {
          analysisError = `essentia ${extract.stage}: ${extract.error}`
          console.error(`[api/ai-producer/review] ${review.id} audio analysis failed:`, analysisError)
        }
      }

      if (!features || analysisError) {
        finalStatus = "failed"
        reportJson = {
          version: 1,
          generated_at: new Date().toISOString(),
          error: analysisError ?? "audio_analysis_failed",
          stage: "audio_analysis",
        }
      } else {
        // 4b. LLM report.
        console.log("Calling OpenAI...")
        console.log(`[api/ai-producer/review] ${review.id} LLM report generation started`)
        const gen = await generateProducerReport(features, {
          title,
          genre,
          daw,
          feedback_focus: feedbackFocus,
          comment,
          track_duration: trackDurationSeconds,
        })
        if (gen.ok) {
          reportJson = gen.report
          console.log(`[api/ai-producer/review] ${review.id} report saved`)
        } else {
          finalStatus = "failed"
          const errMsg = `openai ${gen.stage}: ${gen.error}`
          console.error(`[api/ai-producer/review] ${review.id} LLM failed:`, errMsg)
          reportJson = {
            version: 1,
            generated_at: new Date().toISOString(),
            error: errMsg,
            stage: "llm",
            audio_features: features,
          }
        }
      }
    } catch (err: any) {
      // Catch any unexpected throw from the analysis pipeline so the
      // row never gets stuck on "processing" forever (the polling UI
      // would spin indefinitely otherwise).
      console.error(`[api/ai-producer/review] ${review.id} background analysis threw:`, err)
      finalStatus = "failed"
      reportJson = {
        version: 1,
        generated_at: new Date().toISOString(),
        error: err?.message || "background_analysis_unhandled",
        stage: "background",
      }
    }

    // Bounded retry on the finalise UPDATE so a transient Supabase
    // hiccup cannot leave the row stuck on "processing" forever (the
    // polling UI would spin indefinitely otherwise). 3 attempts with
    // exponential backoff (500ms, 2s, 5s) — total worst-case 7.5s
    // extra latency on the background task. Each attempt is wrapped
    // in its own try/catch so a thrown exception (vs a returned
    // {error}) cannot kill the retry loop. If ALL attempts still
    // fail, we attempt a last-ditch minimal "failed" UPDATE with just
    // the status + a tiny error report (no large report_json) — this
    // covers the case where the original payload is the problem
    // (size, serialization, etc) so the polling UI can at least exit
    // "processing" and show the failed state.
    const finalisePayload = { status: finalStatus, report_json: reportJson }
    const backoffsMs = [500, 2000, 5000]
    let finalErr: unknown = null
    for (let attempt = 0; attempt < backoffsMs.length; attempt++) {
      try {
        const { error: e } = await admin
          .from("ai_producer_reviews")
          .update(finalisePayload)
          .eq("id", review.id)
        if (!e) {
          finalErr = null
          break
        }
        finalErr = e
        console.error(
          `[api/ai-producer/review] ${review.id} finalise update attempt ${attempt + 1}/${backoffsMs.length} failed:`,
          e,
        )
      } catch (caught) {
        finalErr = caught
        console.error(
          `[api/ai-producer/review] ${review.id} finalise update attempt ${attempt + 1}/${backoffsMs.length} threw:`,
          caught,
        )
      }
      if (attempt < backoffsMs.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, backoffsMs[attempt]))
      }
    }

    if (finalErr) {
      // Last-ditch minimal fallback: discard report_json (which might
      // be the cause of the failure) and at least flip status off
      // "processing" so the polling UI exits.
      try {
        const fallbackPayload = {
          status: "failed" as const,
          report_json: {
            version: 1,
            generated_at: new Date().toISOString(),
            error: "finalize_persist_failed",
            stage: "finalize",
          },
        }
        const { error: fbErr } = await admin
          .from("ai_producer_reviews")
          .update(fallbackPayload)
          .eq("id", review.id)
        if (fbErr) {
          console.error(
            `[api/ai-producer/review] ${review.id} CRITICAL: fallback failed update also failed — row stuck on "processing":`,
            fbErr,
            "original:",
            finalErr,
          )
        } else {
          console.error(
            `[api/ai-producer/review] ${review.id} finalize fallback applied (status=failed, finalize_persist_failed). Original error:`,
            finalErr,
          )
        }
      } catch (fbCaught) {
        console.error(
          `[api/ai-producer/review] ${review.id} CRITICAL: fallback update threw — row stuck on "processing":`,
          fbCaught,
          "original:",
          finalErr,
        )
      }
    } else if (finalStatus === "failed") {
      console.error(`[api/ai-producer/review] ${review.id} failed`)
    } else {
      console.log(`[api/ai-producer/review] ${review.id} finalised (status=${finalStatus})`)
    }
  }

  // Fire-and-forget. The Node process keeps running on Replit's
  // long-running dev/prod server, so the background task completes
  // independently of the HTTP response.
  void finalizeReview().catch((err) => {
    console.error(`[api/ai-producer/review] ${review.id} background finalize unexpected:`, err)
  })

  // Return IMMEDIATELY — the browser sees a fast 200, navigates to
  // /ai-producer/reviews/:id, and that page polls every 3s until the
  // status flips to "ready" or "failed".
  return NextResponse.json({
    ok: true,
    review: {
      id: review.id,
      status: "processing",
      access_type: review.access_type,
      credits_used: review.credits_used,
    },
  })
  } catch (err: any) {
    console.error("AI PRODUCER ERROR:", err)
    return NextResponse.json(
      {
        ok: false,
        error: "ai_producer_unhandled",
        message: err?.message || "Unhandled server error in AI Producer review.",
      },
      { status: 500 },
    )
  }
}
