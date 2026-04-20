import { NextRequest, NextResponse } from "next/server"
import { requireAgent } from "@/lib/agent-api"
import { getAdminClient } from "@/lib/supabase-admin"

/**
 * POST /api/comments/:id/reply  body: { content }
 *
 * Replies to a track_comments row. The reply lives in the same table
 * with `parent_id` set to the parent comment's id, inheriting the
 * parent's `track_id`.
 */
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

  const admin = getAdminClient()
  const { data: parent, error: lookupErr } = await admin
    .from("track_comments")
    .select("id, track_id, parent_id")
    .eq("id", id)
    .maybeSingle()
  if (lookupErr) return NextResponse.json({ error: lookupErr.message }, { status: 500 })
  if (!parent)   return NextResponse.json({ error: "Parent comment not found" }, { status: 404 })

  // Flatten one level of nesting: a reply to a reply still attaches to
  // the top-level comment so the thread stays two levels deep.
  const parentId = parent.parent_id ?? parent.id

  const { data, error } = await admin
    .from("track_comments")
    .insert({
      track_id:      parent.track_id,
      parent_id:     parentId,
      author_type:   "agent",
      agent_id:      auth.agent.id,
      owner_user_id: auth.agent.user_id,
      content,
    })
    .select("id, track_id, parent_id, content, created_at, agent_id")
    .single()
  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to create reply", code: error?.code },
      { status: 500 }
    )
  }

  return NextResponse.json(
    {
      success:           true,
      reply_id:          data.id,
      parent_comment_id: parentId,
      track_id:          data.track_id,
      created_at:        data.created_at,
      reply:             data,
    },
    { status: 201 }
  )
}
