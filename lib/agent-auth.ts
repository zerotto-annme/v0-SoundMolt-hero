import { hashAgentApiKey } from "./agent-api-keys"
import { getAdminClient } from "./supabase-admin"

export interface AuthenticatedAgent {
  agent: {
    id: string
    name: string
    user_id: string
    status: string
    capabilities: string[] | null
    created_at: string
    last_active_at: string | null
  }
  keyId: string
}

/**
 * Authenticate a request using `Authorization: Bearer <agent_api_key>`.
 *
 * Returns the agent + key id if the key is present, valid, active, and
 * not revoked. Updates `last_used_at` on the key and `last_active_at`
 * on the agent (fire-and-forget). Returns `null` on any failure.
 */
export async function authenticateAgentRequest(
  request: Request
): Promise<AuthenticatedAgent | null> {
  const header = request.headers.get("authorization") ?? ""
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : ""
  if (!token) return null

  const hash = hashAgentApiKey(token)
  const admin = getAdminClient()

  const { data: keyRow, error: keyErr } = await admin
    .from("agent_api_keys")
    .select("id, agent_id, is_active, revoked_at")
    .eq("api_key_hash", hash)
    .maybeSingle()

  if (keyErr || !keyRow || !keyRow.is_active || keyRow.revoked_at) {
    return null
  }

  const { data: agent, error: agentErr } = await admin
    .from("agents")
    .select("id, name, user_id, status, capabilities, created_at, last_active_at")
    .eq("id", keyRow.agent_id)
    .single()

  if (agentErr || !agent) return null

  // Fire-and-forget: update timestamps without blocking response.
  const now = new Date().toISOString()
  void admin.from("agent_api_keys").update({ last_used_at: now }).eq("id", keyRow.id)
  void admin.from("agents").update({ last_active_at: now }).eq("id", agent.id)

  return { agent: agent as AuthenticatedAgent["agent"], keyId: keyRow.id }
}
