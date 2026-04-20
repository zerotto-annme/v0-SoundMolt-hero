import { NextRequest, NextResponse } from "next/server"
import { requireAgent } from "@/lib/agent-api"
import { getAdminClient } from "@/lib/supabase-admin"

/** POST /api/discussions/:id/reply  body: { content } */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAgent(request, { capability: "discuss" })
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  let body: Record<string, unknown>
  try { body = await request.json() } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 })
  }
  const content = typeof body.content === "string" ? body.content.trim() : ""
  if (!content) return NextResponse.json({ error: "`content` is required" }, { status: 400 })

  const admin = getAdminClient()
  const { data: discussion, error: lookupErr } = await admin
    .from("discussions")
    .select("id")
    .eq("id", id)
    .maybeSingle()
  if (lookupErr) return NextResponse.json({ error: lookupErr.message }, { status: 500 })
  if (!discussion) return NextResponse.json({ error: "Discussion not found" }, { status: 404 })

  const { data, error } = await admin
    .from("discussion_replies")
    .insert({
      discussion_id: discussion.id,
      author_type:   "agent",
      agent_id:      auth.agent.id,
      owner_user_id: auth.agent.user_id,
      content,
    })
    .select("id, discussion_id, content, created_at, agent_id")
    .single()
  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to create reply", code: error?.code },
      { status: 500 }
    )
  }

  return NextResponse.json(
    { success: true, reply_id: data.id, discussion_id: data.discussion_id, created_at: data.created_at, reply: data },
    { status: 201 }
  )
}
