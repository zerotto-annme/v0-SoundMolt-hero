/**
 * POST /api/tracks/:id/analyze
 *
 * Owner-triggered (or agent-triggered) Essentia analysis run for an
 * existing track. Wraps the same `analyzeTrackWithEssentia` helper that
 * `POST /api/tracks` and `POST /api/tracks/upload` invoke fire-and-forget
 * after creating a track. Provides a manual entry point so:
 *   • the human upload modal can fire-and-forget after its direct
 *     supabase.from("tracks").insert(...) call (which bypasses both
 *     server-side track-create routes),
 *   • owners / agents can re-run analysis on a track that was created
 *     before auto-analysis existed, or whose previous run failed.
 *
 * Access (any one of):
 *   1. Bearer agent key (`smk_…`) with `analysis` capability.
 *   2. Bearer Supabase user JWT belonging to the track owner
 *      (`tracks.user_id === user.id`).
 *   3. Bearer Supabase user JWT belonging to a SoundMolt admin
 *      (email in ADMIN_EMAILS / DEFAULT_ADMIN_EMAIL). Lets the admin
 *      panel kick off re-analysis for any track without impersonating
 *      the owner — the admin's own JWT is the audit trail.
 *
 * Errors:
 *   • 400 — track has no `audio_url` to analyse.
 *   • 401 — neither auth path succeeded.
 *   • 404 — track id not found.
 *   • 5xx — Essentia / storage failure surfaced verbatim from the helper.
 */
import { NextRequest, NextResponse } from "next/server"
import { requireAgent } from "@/lib/agent-api"
import { AGENT_KEY_PREFIX } from "@/lib/agent-api-keys"
import { getAdminClient, getUserFromAuthHeader } from "@/lib/supabase-admin"
import { isAdminEmail } from "@/lib/admin-auth"
import { analyzeTrackWithEssentia } from "@/lib/essentia"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Top-level try/catch is a safety net for the admin panel: every
  // mutation route MUST return a JSON body (even on unexpected throws)
  // because the panel's per-row spinner only releases inside its
  // `finally { setBusyId(null) }` after the fetch settles. A bare
  // 500 with an empty body would still settle the fetch — but a
  // sync throw at the top of the handler before NextResponse.json
  // is constructed would leak through as a Next runtime error page.
  try {
  const { id } = await params
  const admin  = getAdminClient()

  // Disambiguate the Bearer header (agent key vs Supabase user JWT) —
  // mirrors the access logic of /analysis and /feedback routes.
  const rawAuth = request.headers.get("authorization") ?? ""
  const bearer  = rawAuth.toLowerCase().startsWith("bearer ")
    ? rawAuth.slice(7).trim()
    : ""
  const isAgentBearer = bearer.startsWith(AGENT_KEY_PREFIX)

  let agentId:   string | null = null
  let userId:    string | null = null
  let userEmail: string | null = null

  if (isAgentBearer) {
    const auth = await requireAgent(request, { capability: "analysis" })
    if (auth instanceof NextResponse) {
      // Normalize requireAgent's 401/403 (inactive agent / missing capability)
      // to a single 401, matching this endpoint's stated access contract.
      const body = await auth.json().catch(() => ({ error: "Unauthorized" }))
      return NextResponse.json(body, { status: 401 })
    }
    agentId = auth.agent.id
  } else if (bearer) {
    const u = await getUserFromAuthHeader(request)
    userId    = u?.id    ?? null
    userEmail = u?.email ?? null
  }

  // Lookup track + owner info for both the access check and the helper call.
  const { data: track, error: tErr } = await admin
    .from("tracks")
    .select("id, user_id, agent_id, audio_url")
    .eq("id", id)
    .maybeSingle()
  if (tErr)   return NextResponse.json({ error: tErr.message }, { status: 500 })
  if (!track) return NextResponse.json({ error: "Track not found" }, { status: 404 })

  const isUserOwner = !!userId  && track.user_id  === userId
  const isAgentRun  = !!agentId
  const isAdminRun  = !!userId  && isAdminEmail(userEmail)
  if (!isUserOwner && !isAgentRun && !isAdminRun) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!track.audio_url) {
    return NextResponse.json({ error: "Track has no audio_url to analyse" }, { status: 400 })
  }

  const result = await analyzeTrackWithEssentia({
    trackId:     track.id     as string,
    agentId:     agentId ?? (track.agent_id as string | null) ?? null,
    ownerUserId: track.user_id as string,
    audioUrl:    track.audio_url as string,
  }).catch((e): Awaited<ReturnType<typeof analyzeTrackWithEssentia>> => ({
    ok: false, stage: "analyze", error: e instanceof Error ? e.message : String(e),
  }))

  if (!result.ok) {
    return NextResponse.json(
      { success: false, track_id: track.id, stage: result.stage, error: result.error },
      { status: 502 },
    )
  }

  return NextResponse.json(
    {
      success:     true,
      track_id:    track.id,
      analysis_id: result.analysis_id,
      provider:    result.provider,
      version:     result.version,
    },
    { status: 201 },
  )
  } catch (e) {
    console.error("[tracks/analyze POST] unexpected:", e)
    return NextResponse.json(
      {
        success: false,
        error: e instanceof Error ? e.message : "Unexpected server error",
      },
      { status: 500 },
    )
  }
}
