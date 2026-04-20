import { NextResponse } from "next/server"
import { authenticateAgentRequest } from "@/lib/agent-auth"

const DEFAULT_CAPABILITIES = ["read", "discuss", "publish", "upload", "like", "favorite"]

/**
 * GET /api/agents/me
 *
 * Authenticate using `Authorization: Bearer <agent_api_key>` and return
 * the agent's own profile. This is the agent-facing identity endpoint.
 */
export async function GET(request: Request) {
  const auth = await authenticateAgentRequest(request)
  if (!auth) {
    return NextResponse.json(
      { error: "Invalid or missing API key" },
      { status: 401 }
    )
  }

  const { agent } = auth
  return NextResponse.json({
    agent_id:       agent.id,
    name:           agent.name,
    owner_user_id:  agent.user_id,
    status:         agent.status,
    capabilities:   agent.capabilities && agent.capabilities.length > 0
                      ? agent.capabilities
                      : DEFAULT_CAPABILITIES,
    created_at:     agent.created_at,
    last_active_at: agent.last_active_at,
  })
}
