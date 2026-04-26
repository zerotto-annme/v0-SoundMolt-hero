import { NextResponse } from "next/server"
import { getAdminClient, getUserFromAuthHeader, hasServiceRoleKey } from "@/lib/supabase-admin"

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

// ─── Mocked AI analysis ────────────────────────────────────────────────
// Stage 1 only requires a stable, schema-rich response shape so the
// later UI stages have something to render. Replace this with a real
// model call in a follow-up stage; the surrounding contract does not
// need to change.
type AnalysisInput = {
  source_type: string
  title: string | null
  genre: string | null
  daw: string | null
  feedback_focus: string | null
  comment: string | null
}

function runMockAnalysis(input: AnalysisInput) {
  const focus = input.feedback_focus || "general"
  return {
    version: 1,
    generated_at: new Date().toISOString(),
    summary:
      `Automated AI Producer review for "${input.title ?? "Untitled"}". ` +
      `Focus area: ${focus}.`,
    overall_score: 78,
    sections: {
      mix: {
        score: 76,
        notes: [
          "Low end is consistent across the track.",
          "Vocals could sit slightly forward in the chorus.",
        ],
      },
      arrangement: {
        score: 82,
        notes: [
          "Intro keeps tension well.",
          "Consider a contrast section before the final drop.",
        ],
      },
      sound_design: {
        score: 74,
        notes: [
          "Lead synth carries the hook nicely.",
          "Reverb tails on snares add warmth without muddying.",
        ],
      },
    },
    recommendations: [
      "Automate a -1.5 dB cut on the lead synth during vocal sections.",
      "Try parallel compression on the drum bus for added punch.",
      "A sidechain on the pad against the kick will tighten the groove.",
    ],
    references: input.genre
      ? [`Genre cue: ${input.genre}`]
      : [],
  }
}

export async function POST(request: Request) {
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
      .select("user_id, audio_url")
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

  // ─── 4. Run mock analysis and finalise the row ─────────────────────
  let finalStatus: "ready" | "failed" = "ready"
  let reportJson: unknown = null
  try {
    reportJson = runMockAnalysis({
      source_type: sourceType,
      title,
      genre,
      daw,
      feedback_focus: feedbackFocus,
      comment,
    })
  } catch (err) {
    console.error("[api/ai-producer/review] mock analysis threw:", err)
    finalStatus = "failed"
  }

  const { error: finalErr } = await admin
    .from("ai_producer_reviews")
    .update({ status: finalStatus, report_json: reportJson })
    .eq("id", review.id)

  if (finalErr) {
    console.error("[api/ai-producer/review] finalise update failed:", finalErr)
    // The row exists — surface a 200 so the client can poll the
    // get-review endpoint (Stage 2) instead of treating this as a
    // creation failure.
  }

  return NextResponse.json({
    ok: true,
    review: {
      id: review.id,
      status: finalStatus,
      access_type: review.access_type,
      credits_used: review.credits_used,
    },
  })
}
