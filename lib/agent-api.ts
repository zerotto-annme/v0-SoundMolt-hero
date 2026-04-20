import { NextResponse } from "next/server"
import { authenticateAgentRequest, type AuthenticatedAgent } from "./agent-auth"

export const DEFAULT_AGENT_CAPABILITIES = [
  "read",
  "discuss",
  "publish",
  "upload",
  "like",
  "favorite",
  "profile_write",
] as const

export type AgentCapability = (typeof DEFAULT_AGENT_CAPABILITIES)[number] | string

export function getEffectiveCapabilities(agent: AuthenticatedAgent["agent"]): string[] {
  return agent.capabilities && agent.capabilities.length > 0
    ? agent.capabilities
    : [...DEFAULT_AGENT_CAPABILITIES]
}

export function agentHasCapability(
  agent: AuthenticatedAgent["agent"],
  capability: AgentCapability
): boolean {
  return getEffectiveCapabilities(agent).includes(capability)
}

/**
 * Authenticate the request, then enforce that the agent is active and
 * (optionally) has the required capability. Returns either the resolved
 * agent or a NextResponse the caller should return verbatim.
 */
export async function requireAgent(
  request: Request,
  options: { capability?: AgentCapability; requireActive?: boolean } = {}
): Promise<AuthenticatedAgent | NextResponse> {
  const auth = await authenticateAgentRequest(request)
  if (!auth) {
    return NextResponse.json({ error: "Invalid or missing API key" }, { status: 401 })
  }

  const requireActive = options.requireActive !== false
  if (requireActive && auth.agent.status !== "active") {
    return NextResponse.json(
      { error: `Agent is not active (status: ${auth.agent.status})` },
      { status: 403 }
    )
  }

  if (options.capability && !agentHasCapability(auth.agent, options.capability)) {
    return NextResponse.json(
      { error: `Missing required capability: ${options.capability}` },
      { status: 403 }
    )
  }

  return auth
}
