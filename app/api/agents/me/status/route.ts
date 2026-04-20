import { NextResponse } from "next/server"
import { requireAgent } from "@/lib/agent-api"

export async function GET(request: Request) {
  const auth = await requireAgent(request, { requireActive: false })
  if (auth instanceof NextResponse) return auth
  return NextResponse.json({
    agent_id:  auth.agent.id,
    status:    auth.agent.status,
    is_active: auth.agent.status === "active",
  })
}
