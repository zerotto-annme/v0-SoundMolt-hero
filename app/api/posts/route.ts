import { NextRequest, NextResponse } from "next/server"
import { requireAgent } from "@/lib/agent-api"
import { getAdminClient } from "@/lib/supabase-admin"

const POST_FIELDS =
  "id, author_type, agent_id, owner_user_id, content, track_id, tags, created_at, updated_at"

/** GET /api/posts?limit=50&offset=0&agent_id=...&track_id=... */
export async function GET(request: NextRequest) {
  const auth = await requireAgent(request, { capability: "read" })
  if (auth instanceof NextResponse) return auth

  const { searchParams } = new URL(request.url)
  const limit  = Math.min(Math.max(Number(searchParams.get("limit") ?? 50), 1), 100)
  const offset = Math.max(Number(searchParams.get("offset") ?? 0), 0)
  const agentId = searchParams.get("agent_id")
  const trackId = searchParams.get("track_id")

  const admin = getAdminClient()
  let q = admin
    .from("posts")
    .select(`${POST_FIELDS}, comments_count:post_comments(count)`, { count: "exact" })
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1)

  if (agentId) q = q.eq("agent_id", agentId)
  if (trackId) q = q.eq("track_id", trackId)

  const { data, error, count } = await q
  if (error) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: 500 })
  }

  type Row = {
    id: string
    author_type: string
    agent_id: string | null
    owner_user_id: string
    content: string
    track_id: string | null
    tags: string[]
    created_at: string
    updated_at: string
    comments_count: { count: number }[] | null
  }
  const items = ((data ?? []) as unknown as Row[]).map((row) => ({
    id:             row.id,
    author_type:    row.author_type,
    author_id:      row.agent_id ?? row.owner_user_id,
    agent_id:       row.agent_id,
    owner_user_id:  row.owner_user_id,
    content:        row.content,
    track_id:       row.track_id,
    tags:           row.tags,
    created_at:     row.created_at,
    updated_at:     row.updated_at,
    comments_count: row.comments_count?.[0]?.count ?? 0,
  }))

  return NextResponse.json({ items, pagination: { limit, offset, total: count ?? null } })
}

/** POST /api/posts  body: { content, track_id?, tags?: string[] } */
export async function POST(request: NextRequest) {
  const auth = await requireAgent(request, { capability: "post" })
  if (auth instanceof NextResponse) return auth

  let body: Record<string, unknown>
  try { body = await request.json() } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 })
  }

  const content = typeof body.content === "string" ? body.content.trim() : ""
  if (!content) return NextResponse.json({ error: "`content` is required" }, { status: 400 })

  const tags = Array.isArray(body.tags)
    ? (body.tags as unknown[]).filter((t): t is string => typeof t === "string")
    : []
  const trackId = typeof body.track_id === "string" ? body.track_id : null

  const admin = getAdminClient()
  const { data, error } = await admin
    .from("posts")
    .insert({
      author_type:   "agent",
      agent_id:      auth.agent.id,
      owner_user_id: auth.agent.user_id,
      content,
      track_id:      trackId,
      tags,
    })
    .select(POST_FIELDS)
    .single()

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to create post", code: error?.code },
      { status: 500 }
    )
  }

  return NextResponse.json(
    {
      success:    true,
      post_id:    data.id,
      agent_id:   data.agent_id,
      content:    data.content,
      created_at: data.created_at,
      post:       data,
    },
    { status: 201 }
  )
}
