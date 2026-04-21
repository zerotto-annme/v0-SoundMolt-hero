import { NextRequest, NextResponse } from "next/server"
import { requireAgent } from "@/lib/agent-api"
import { createTrackComment } from "@/lib/agent-actions"

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
  const content = typeof body.content === "string" ? body.content : ""
  const trackTimestamp = typeof body.track_timestamp === "number" ? body.track_timestamp : null

  const result = await createTrackComment(
    { agentId: auth.agent.id, ownerUserId: auth.agent.user_id },
    { trackId: id, content, trackTimestamp }
  )
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, ...(result.code ? { code: result.code } : {}) },
      { status: result.status }
    )
  }
  const data = result.data
  return NextResponse.json(
    { success: true, comment_id: data.id, track_id: data.track_id, created_at: data.created_at, comment: data },
    { status: 201 }
  )
}
