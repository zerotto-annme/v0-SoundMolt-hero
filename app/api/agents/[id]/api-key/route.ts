import { NextRequest, NextResponse } from "next/server"
import {
  generateAgentApiKey,
  getAgentApiKeyLast4,
  hashAgentApiKey,
} from "@/lib/agent-api-keys"
import { getAdminClient, getUserFromAuthHeader } from "@/lib/supabase-admin"

/**
 * Verify the request is authenticated by a Supabase user who owns the
 * given agent. Returns the agent row on success, or a NextResponse on
 * failure that the caller should return directly.
 */
async function requireAgentOwner(
  request: NextRequest,
  agentId: string
): Promise<{ ownerId: string } | NextResponse> {
  const user = await getUserFromAuthHeader(request)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const admin = getAdminClient()
  const { data: agent, error } = await admin
    .from("agents")
    .select("id, user_id")
    .eq("id", agentId)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 })
  }
  if (agent.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  return { ownerId: user.id }
}

/**
 * GET /api/agents/:id/api-key
 *
 * Returns metadata about the agent's active API key (no plaintext).
 * Owner-authenticated.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const ownerCheck = await requireAgentOwner(request, id)
  if (ownerCheck instanceof NextResponse) return ownerCheck

  const admin = getAdminClient()
  const { data, error } = await admin
    .from("agent_api_keys")
    .select("id, api_key_last4, is_active, created_at, revoked_at, last_used_at")
    .eq("agent_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }

  return NextResponse.json({ key: data ?? null })
}

/**
 * POST /api/agents/:id/api-key
 *
 * Regenerate (or initially create) the agent's API key. Any existing
 * active key is revoked atomically. Returns the plaintext key exactly
 * once — it is never persisted in plaintext.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const ownerCheck = await requireAgentOwner(request, id)
  if (ownerCheck instanceof NextResponse) return ownerCheck
  const { ownerId } = ownerCheck

  const admin = getAdminClient()

  // Generate, hash. We persist only the hash + last 4 chars.
  const plaintext = generateAgentApiKey()
  const api_key_hash = hashAgentApiKey(plaintext)
  const api_key_last4 = getAgentApiKeyLast4(plaintext)

  // Preferred path: atomic revoke+insert via Postgres function.
  const { data: rotated, error: rpcErr } = await admin.rpc("rotate_agent_api_key", {
    p_agent_id:      id,
    p_owner_user_id: ownerId,
    p_hash:          api_key_hash,
    p_last4:         api_key_last4,
  })

  let row: { id: string; api_key_last4: string; created_at: string } | null = null

  if (!rpcErr && rotated) {
    row = Array.isArray(rotated) ? rotated[0] : rotated
  } else {
    // Fallback when the rotate_agent_api_key function isn't present yet
    // (older deployment of migration 027). Two-step revoke + insert.
    // Detect "function not found" (PGRST202) and fall through; bubble any
    // other error up to the client with details.
    const isMissingFn =
      rpcErr?.code === "PGRST202" ||
      /could not find the function/i.test(rpcErr?.message ?? "")

    if (rpcErr && !isMissingFn) {
      console.error("[agent-api-key] rotate rpc error:", rpcErr)
      return NextResponse.json(
        { error: `Failed to create key: ${rpcErr.message}`, code: rpcErr.code ?? null },
        { status: 500 }
      )
    }

    const nowIso = new Date().toISOString()
    const { error: revokeErr } = await admin
      .from("agent_api_keys")
      .update({ is_active: false, revoked_at: nowIso })
      .eq("agent_id", id)
      .eq("is_active", true)

    if (revokeErr) {
      console.error("[agent-api-key] revoke fallback error:", revokeErr)
      return NextResponse.json(
        { error: `Failed to revoke previous key: ${revokeErr.message}`, code: revokeErr.code ?? null },
        { status: 500 }
      )
    }

    const { data: inserted, error: insertErr } = await admin
      .from("agent_api_keys")
      .insert({
        agent_id: id,
        owner_user_id: ownerId,
        api_key_hash,
        api_key_last4,
        is_active: true,
      })
      .select("id, api_key_last4, created_at")
      .single()

    if (insertErr || !inserted) {
      console.error("[agent-api-key] insert fallback error:", insertErr)
      return NextResponse.json(
        {
          error: `Failed to create key: ${insertErr?.message ?? "unknown insert error"}`,
          code: insertErr?.code ?? null,
        },
        { status: 500 }
      )
    }

    row = inserted
  }

  if (!row) {
    return NextResponse.json({ error: "Failed to create key: no row returned" }, { status: 500 })
  }

  return NextResponse.json({
    success:       true,
    api_key:       plaintext,                                  // shown ONCE
    apiKey:        plaintext,                                  // alias for spec compatibility
    api_key_last4: row.api_key_last4,
    masked:        `${"•".repeat(8)}${row.api_key_last4}`,
    key_id:        row.id,
    created_at:    row.created_at,
    status:        "active",
  })
}

/**
 * DELETE /api/agents/:id/api-key
 *
 * Revoke (disable) the agent's currently active API key. The agent
 * loses API access immediately.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const ownerCheck = await requireAgentOwner(request, id)
  if (ownerCheck instanceof NextResponse) return ownerCheck

  const admin = getAdminClient()
  const { error } = await admin
    .from("agent_api_keys")
    .update({ is_active: false, revoked_at: new Date().toISOString() })
    .eq("agent_id", id)
    .eq("is_active", true)

  if (error) {
    console.error("[agent-api-key] delete error:", error.message)
    return NextResponse.json({ error: "Failed to revoke key" }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
