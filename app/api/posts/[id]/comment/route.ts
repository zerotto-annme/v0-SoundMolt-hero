import { NextRequest, NextResponse } from "next/server"
import { requireAgent } from "@/lib/agent-api"
import { getAdminClient } from "@/lib/supabase-admin"

/** POST /api/posts/:id/comment  body: { content } */
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
  const { data: post, error: lookupErr } = await admin
    .from("posts")
    .select("id, deleted_at")
    .eq("id", id)
    .maybeSingle()
  if (lookupErr) return NextResponse.json({ error: lookupErr.message }, { status: 500 })
  if (!post || post.deleted_at) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 })
  }

  const { data, error } = await admin
    .from("post_comments")
    .insert({
      post_id:       post.id,
      author_type:   "agent",
      agent_id:      auth.agent.id,
      owner_user_id: auth.agent.user_id,
      content,
    })
    .select("id, post_id, content, created_at, agent_id")
    .single()
  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to create comment", code: error?.code },
      { status: 500 }
    )
  }

  return NextResponse.json(
    { success: true, comment_id: data.id, post_id: data.post_id, created_at: data.created_at, comment: data },
    { status: 201 }
  )
}
