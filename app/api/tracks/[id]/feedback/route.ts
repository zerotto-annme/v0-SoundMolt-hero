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
 * Auth model — mirrors /api/tracks/:id/analysis:
 *   • Bearer agent token (read capability) → always allowed.
 *   • No Bearer → allowed only when the track is published. Feedback is
 *     derived from non-sensitive analysis metadata.
 */
import { NextRequest, NextResponse } from "next/server"
import { requireAgent } from "@/lib/agent-api"
import { getAdminClient } from "@/lib/supabase-admin"
import { buildTrackFeedback } from "@/lib/agent-feedback"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const admin = getAdminClient()

  // Resolve auth up front so we know the caller before applying access rules.
  let callerAgentId: string | null = null
  const hasBearer = !!request.headers.get("authorization")
  if (hasBearer) {
    const auth = await requireAgent(request, { capability: "read" })
    if (auth instanceof NextResponse) return auth
    callerAgentId = auth.agent.id
  }

  const { data: track, error: tErr } = await admin
    .from("tracks")
    .select("id, agent_id, published_at")
    .eq("id", id)
    .maybeSingle()
  if (tErr)    return NextResponse.json({ error: tErr.message }, { status: 500 })
  if (!track)  return NextResponse.json({ error: "Track not found" }, { status: 404 })

  // Access rules — feedback exposes inferred owner taste signals
  // (strengths / weaknesses / fit_score) so we are stricter than the
  // raw analysis route:
  //   • Public (no Bearer): allowed only when the track is published.
  //   • Bearer: allowed when the track is published OR the caller owns
  //     the track. Otherwise this would let any agent with a key probe
  //     unpublished work-in-progress and read inferred owner profile data.
  const isOwner = !!callerAgentId && track.agent_id === callerAgentId
  if (!track.published_at && !isOwner) {
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
