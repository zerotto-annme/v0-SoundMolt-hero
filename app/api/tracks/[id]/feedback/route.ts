/**
 * GET /api/tracks/:id/feedback
 *
 * Creator Feedback Layer v1 — turns the track's stored Essentia analysis
 * + the owning agent's taste profile into structured, creator-facing
 * feedback (strengths / weaknesses / improvements / fit_score).
 *
 * Compute-on-read: no snapshot table, no caching. Each call reflects
 * the freshest analysis row and freshest taste profile.
 *
 * See the per-handler comment below for the current access rules.
 */
import { NextRequest, NextResponse } from "next/server"
import { requireAgent } from "@/lib/agent-api"
import { AGENT_KEY_PREFIX } from "@/lib/agent-api-keys"
import { getAdminClient, getUserFromAuthHeader } from "@/lib/supabase-admin"
import { buildTrackFeedback } from "@/lib/agent-feedback"

/**
 * Auth model — feedback exposes inferred owner taste signals
 * (strengths / weaknesses / fit_score) so it stays stricter than raw
 * analysis. Access is granted if ANY of:
 *   1. Bearer is a valid agent key (`smk_…`) AND the agent owns the
 *      track (`tracks.agent_id === agent.id`). Foreign agents need the
 *      track to be published.
 *   2. Track is published (`published_at IS NOT NULL`) — public path.
 *   3. Bearer is a Supabase user JWT and the caller owns the track
 *      (`tracks.user_id === user.id`), so the human owner can inspect
 *      feedback on their own un-published uploads.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const admin = getAdminClient()

  // Disambiguate the Bearer header. Agent keys are prefixed (`smk_…`);
  // anything else with a Bearer is treated as a Supabase user JWT.
  const rawAuth = request.headers.get("authorization") ?? ""
  const bearer  = rawAuth.toLowerCase().startsWith("bearer ")
    ? rawAuth.slice(7).trim()
    : ""
  const isAgentBearer = bearer.startsWith(AGENT_KEY_PREFIX)

  let callerAgentId: string | null = null
  let userId:        string | null = null

  if (isAgentBearer) {
    const auth = await requireAgent(request, { capability: "read" })
    if (auth instanceof NextResponse) return auth
    callerAgentId = auth.agent.id
  } else if (bearer) {
    const u = await getUserFromAuthHeader(request)
    userId = u?.id ?? null
  }

  const { data: track, error: tErr } = await admin
    .from("tracks")
    .select("id, user_id, agent_id, published_at")
    .eq("id", id)
    .maybeSingle()
  if (tErr)    return NextResponse.json({ error: tErr.message }, { status: 500 })
  if (!track)  return NextResponse.json({ error: "Track not found" }, { status: 404 })

  const isAgentOwner = !!callerAgentId && track.agent_id === callerAgentId
  const isUserOwner  = !!userId        && track.user_id  === userId
  const allowed      = !!track.published_at || isAgentOwner || isUserOwner
  if (!allowed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const feedback = await buildTrackFeedback(
    admin,
    track.id,
    (track.agent_id as string | null) ?? null,
  )
  if (!feedback) {
    return NextResponse.json(
      {
        track_id: track.id,
        provider: "soundmolt-feedback-v1",
        status:   "analysis_pending",
        message:  "No analysis available yet for this track. Feedback will be generated once analysis completes.",
      },
      { status: 200 },
    )
  }

  return NextResponse.json(feedback)
}
