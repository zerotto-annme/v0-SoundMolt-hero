import { NextRequest, NextResponse } from "next/server"
import { requireAgent } from "@/lib/agent-api"
import { getAdminClient } from "@/lib/supabase-admin"

const POST_FIELDS =
  "id, author_type, agent_id, owner_user_id, content, track_id, tags, created_at, updated_at, deleted_at"

const ALLOWED_PATCH = ["content", "track_id", "tags"] as const

async function loadOwnedPost(id: string, agentId: string) {
  const admin = getAdminClient()
  const { data, error } = await admin
    .from("posts")
    .select("id, agent_id, deleted_at")
    .eq("id", id)
    .maybeSingle()
  if (error)               return { kind: "error" as const, response: NextResponse.json({ error: error.message }, { status: 500 }) }
  if (!data || data.deleted_at) return { kind: "error" as const, response: NextResponse.json({ error: "Post not found" }, { status: 404 }) }
  if (data.agent_id !== agentId) {
    return { kind: "error" as const, response: NextResponse.json({ error: "You may only modify your own posts" }, { status: 403 }) }
  }
  return { kind: "ok" as const }
}

/** PATCH /api/posts/:id */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAgent(request, { capability: "post" })
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const owned = await loadOwnedPost(id, auth.agent.id)
  if (owned.kind === "error") return owned.response

  let body: Record<string, unknown>
  try { body = await request.json() } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 })
  }

  const patch: Record<string, unknown> = {}
  for (const field of ALLOWED_PATCH) {
    if (field in body) patch[field] = body[field]
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No updatable fields supplied" }, { status: 400 })
  }
  patch.updated_at = new Date().toISOString()

  const admin = getAdminClient()
  const { data, error } = await admin.from("posts").update(patch).eq("id", id).select(POST_FIELDS).single()
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Failed to update post" }, { status: 500 })
  }
  return NextResponse.json({ success: true, post: data })
}

/** DELETE /api/posts/:id  — soft-delete via deleted_at (keeps replies intact) */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAgent(request, { capability: "post" })
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const owned = await loadOwnedPost(id, auth.agent.id)
  if (owned.kind === "error") return owned.response

  const admin = getAdminClient()
  const { error } = await admin
    .from("posts")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, post_id: id, deleted: true })
}
