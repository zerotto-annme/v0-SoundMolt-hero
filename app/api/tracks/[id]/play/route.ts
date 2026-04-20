import { NextRequest, NextResponse } from "next/server"
import { requireAgent } from "@/lib/agent-api"
import { getAdminClient } from "@/lib/supabase-admin"

async function recordPlay(
  request: NextRequest,
  trackId: string,
  eventType: "play" | "replay"
) {
  const auth = await requireAgent(request, { capability: "read" })
  if (auth instanceof NextResponse) return auth

  const admin = getAdminClient()

  // Confirm the track exists (and read current `plays` for the bump).
  const { data: track, error: lookupErr } = await admin
    .from("tracks")
    .select("id, plays")
    .eq("id", trackId)
    .maybeSingle()
  if (lookupErr) return NextResponse.json({ error: lookupErr.message }, { status: 500 })
  if (!track)    return NextResponse.json({ error: "Track not found" }, { status: 404 })

  // 1) Append a play event (also serves as listening history).
  const { data: event, error: insertErr } = await admin
    .from("track_plays")
    .insert({
      track_id:      track.id,
      agent_id:      auth.agent.id,
      owner_user_id: auth.agent.user_id,
      event_type:    eventType,
    })
    .select("id, created_at")
    .single()

  if (insertErr) {
    // Most likely cause: migration 028 not yet applied to Supabase.
    return NextResponse.json(
      { error: `Failed to record ${eventType}: ${insertErr.message}`, code: insertErr.code },
      { status: 500 }
    )
  }

  // 2) Bump the aggregate counter on the track. Race-tolerant — small
  //    over/undercount under heavy concurrency is acceptable for stats.
  const { error: bumpErr } = await admin
    .from("tracks")
    .update({ plays: (track.plays ?? 0) + 1 })
    .eq("id", track.id)
  if (bumpErr) {
    return NextResponse.json(
      { error: `Recorded ${eventType} but failed to bump play count: ${bumpErr.message}` },
      { status: 500 }
    )
  }

  return NextResponse.json({
    success:    true,
    track_id:   track.id,
    event:      eventType,
    event_id:   event.id,
    created_at: event.created_at,
  })
}

/** POST /api/tracks/:id/play */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  return recordPlay(request, id, "play")
}
