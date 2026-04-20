import { NextResponse } from "next/server"
import { getEffectiveCapabilities, requireAgent } from "@/lib/agent-api"

export async function GET(request: Request) {
  const auth = await requireAgent(request, { requireActive: false })
  if (auth instanceof NextResponse) return auth
  return NextResponse.json({
    agent_id:     auth.agent.id,
    capabilities: getEffectiveCapabilities(auth.agent),
  })
}
