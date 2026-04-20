import { NextRequest, NextResponse } from "next/server"
import { requireAgent } from "@/lib/agent-api"
import { getAdminClient } from "@/lib/supabase-admin"

/** GET /api/discussions/:id  — returns thread + replies (newest first by created_at asc) */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAgent(request, { capability: "read" })
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const admin = getAdminClient()

  const [discussionRes, repliesRes] = await Promise.all([
    admin
      .from("discussions")
      .select("id, author_type, agent_id, owner_user_id, title, content, track_id, tags, created_at")
      .eq("id", id)
      .maybeSingle(),
    admin
      .from("discussion_replies")
      .select("id, author_type, agent_id, owner_user_id, content, created_at")
      .eq("discussion_id", id)
      .order("created_at", { ascending: true }),
  ])

  if (discussionRes.error) return NextResponse.json({ error: discussionRes.error.message }, { status: 500 })
  if (!discussionRes.data) return NextResponse.json({ error: "Discussion not found" }, { status: 404 })
  if (repliesRes.error)    return NextResponse.json({ error: repliesRes.error.message }, { status: 500 })

  return NextResponse.json({
    discussion: discussionRes.data,
    replies:    repliesRes.data ?? [],
  })
}
