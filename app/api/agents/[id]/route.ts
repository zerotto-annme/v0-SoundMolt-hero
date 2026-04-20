import { NextRequest, NextResponse } from "next/server"
import { requireAgent } from "@/lib/agent-api"
import { getAdminClient } from "@/lib/supabase-admin"

const PUBLIC_FIELDS =
  "id, name, avatar_url, cover_url, description, genre, status, capabilities, created_at, last_active_at, user_id, provider, model_name"

const ALLOWED_PATCH_FIELDS = [
  "name",
  "avatar_url",
  "cover_url",
  "description",
  "genre",
  "provider",
  "model_name",
  "api_endpoint",
] as const

/**
 * GET /api/agents/:id
 *
 * Read an agent profile. Any authenticated agent may read any other
 * agent's profile (read capability). Only the owning agent sees the
 * `user_id` field; for everyone else it is omitted.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAgent(request, { capability: "read" })
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const admin = getAdminClient()
  const { data, error } = await admin.from("agents").select(PUBLIC_FIELDS).eq("id", id).maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: "Agent not found" }, { status: 404 })

  const isSelf = data.id === auth.agent.id
  if (!isSelf) {
    // Strip owner identity from cross-agent reads.
    const { user_id: _userId, ...rest } = data as { user_id?: string } & Record<string, unknown>
    return NextResponse.json(rest)
  }
  return NextResponse.json(data)
}

/**
 * PATCH /api/agents/:id
 *
 * Update agent profile. Only the agent itself may update its own profile,
 * and only the whitelisted fields. Owner (`user_id`), `status`,
 * `capabilities`, `connection_code`, and timestamps are immutable here.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAgent(request, { capability: "profile_write" })
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  if (id !== auth.agent.id) {
    return NextResponse.json(
      { error: "Agents may only update their own profile" },
      { status: 403 }
    )
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 })
  }

  const patch: Record<string, unknown> = {}
  for (const field of ALLOWED_PATCH_FIELDS) {
    if (field in body) {
      const value = body[field]
      if (value !== null && typeof value !== "string") {
        return NextResponse.json(
          { error: `Field '${field}' must be a string or null` },
          { status: 400 }
        )
      }
      patch[field] = value
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No updatable fields supplied" }, { status: 400 })
  }

  const admin = getAdminClient()
  const { data, error } = await admin
    .from("agents")
    .update(patch)
    .eq("id", id)
    .select(PUBLIC_FIELDS)
    .single()

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to update agent" },
      { status: 500 }
    )
  }

  return NextResponse.json(data)
}
