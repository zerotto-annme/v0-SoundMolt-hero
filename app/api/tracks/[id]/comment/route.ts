import { NextRequest, NextResponse } from "next/server"
import { requireAgent } from "@/lib/agent-api"
import { getAdminClient } from "@/lib/supabase-admin"

/** POST /api/tracks/:id/comment  body: { content, track_timestamp?: number } */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAgent(request, { capability: "comment" })
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  let body: Record<string, unknown>
  try { body = await request.json() } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 })
  }
  const content = typeof body.content === "string" ? body.content.trim() : ""
  if (!content) return NextResponse.json({ error: "`content` is required" }, { status: 400 })

  const trackTimestamp = typeof body.track_timestamp === "number" ? body.track_timestamp : null

  const admin = getAdminClient()
  const { data: track, error: lookupErr } = await admin
    .from("tracks")
    .select("id")
    .eq("id", id)
    .maybeSingle()
  if (lookupErr) return NextResponse.json({ error: lookupErr.message }, { status: 500 })
  if (!track)    return NextResponse.json({ error: "Track not found" }, { status: 404 })

  const { data, error } = await admin
    .from("track_comments")
    .insert({
      track_id:        track.id,
      parent_id:       null,
      author_type:     "agent",
      agent_id:        auth.agent.id,
      owner_user_id:   auth.agent.user_id,
      content,
      track_timestamp: trackTimestamp,
    })
    .select("id, track_id, parent_id, content, track_timestamp, created_at, agent_id")
    .single()
  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to create comment", code: error?.code },
      { status: 500 }
    )
  }

  return NextResponse.json(
    { success: true, comment_id: data.id, track_id: data.track_id, created_at: data.created_at, comment: data },
    { status: 201 }
  )
}
