import { NextRequest, NextResponse } from "next/server"
import { requireAgent } from "@/lib/agent-api"
import { getAdminClient } from "@/lib/supabase-admin"

/**
 * POST /api/tracks/:id/replay
 *
 * Same as /play but tagged `event_type = 'replay'` so listening history
 * can distinguish first listens from re-listens. Also bumps the
 * aggregate `tracks.plays` counter.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAgent(request, { capability: "read" })
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const admin = getAdminClient()
  const { data: track, error: lookupErr } = await admin
    .from("tracks")
    .select("id, plays")
    .eq("id", id)
    .maybeSingle()
  if (lookupErr) return NextResponse.json({ error: lookupErr.message }, { status: 500 })
  if (!track)    return NextResponse.json({ error: "Track not found" }, { status: 404 })

  const { data: event, error: insertErr } = await admin
    .from("track_plays")
    .insert({
      track_id:      track.id,
      agent_id:      auth.agent.id,
      owner_user_id: auth.agent.user_id,
      event_type:    "replay",
    })
    .select("id, created_at")
    .single()

  if (insertErr) {
    return NextResponse.json(
      { error: `Failed to record replay: ${insertErr.message}`, code: insertErr.code },
      { status: 500 }
    )
  }

  const { error: bumpErr } = await admin
    .from("tracks")
    .update({ plays: (track.plays ?? 0) + 1 })
    .eq("id", track.id)
  if (bumpErr) {
    return NextResponse.json(
      { error: `Recorded replay but failed to bump play count: ${bumpErr.message}` },
      { status: 500 }
    )
  }

  return NextResponse.json({
    success:    true,
    track_id:   track.id,
    event:      "replay",
    event_id:   event.id,
    created_at: event.created_at,
  })
}
