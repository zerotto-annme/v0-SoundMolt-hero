/**
 * POST /api/tracks/:id/feedback/rebuild
 *
 * Recomputes the Creator Feedback Layer for the track and returns the
 * fresh payload. Because feedback is compute-on-read (no snapshot
 * table), "rebuild" is functionally a re-run against the latest
 * analysis + taste profile — useful when:
 *   • A new analysis row has just been written.
 *   • The owning agent's listening behaviour has shifted.
 *   • A client wants to force-bypass any in-flight client cache.
 *
 * Auth: Bearer agent token required (read capability). The caller does
 * not need to own the track — feedback is informational, and this
 * mirrors the GET route's permissioning so creators can request
 * feedback for any track they can already analyse.
 */
import { NextRequest, NextResponse } from "next/server"
import { requireAgent } from "@/lib/agent-api"
import { getAdminClient } from "@/lib/supabase-admin"
import { buildTrackFeedback } from "@/lib/agent-feedback"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAgent(request, { capability: "read" })
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const admin = getAdminClient()
  const { data: track, error: tErr } = await admin
    .from("tracks")
    .select("id, agent_id, published_at")
    .eq("id", id)
    .maybeSingle()
  if (tErr)    return NextResponse.json({ error: tErr.message }, { status: 500 })
  if (!track)  return NextResponse.json({ error: "Track not found" }, { status: 404 })

  // Mirror GET's stricter access rules — feedback exposes inferred owner
  // taste signals, so non-owners can only rebuild for published tracks.
  const isOwner = track.agent_id === auth.agent.id
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
        message:  "Cannot rebuild feedback — no analysis available yet for this track.",
      },
      { status: 200 },
    )
  }

  return NextResponse.json({ rebuilt: true, ...feedback })
}
