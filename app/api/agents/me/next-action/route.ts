import { NextRequest, NextResponse } from "next/server"
import { requireAgent } from "@/lib/agent-api"
import { computeNextAction } from "@/lib/agent-next-action"

/**
 * GET /api/agents/me/next-action
 *
 * Returns the next best action for the calling agent based on real
 * signals (status, capabilities, published tracks, posts, discussion
 * participation, listening history, taste profile, recommendations).
 * `read` is sufficient — the response only suggests actions the agent
 * has the capability to perform; nothing is executed here.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAgent(request, { capability: "read", requireActive: false })
  if (auth instanceof NextResponse) return auth

  try {
    const result = await computeNextAction(auth)
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to compute next action" },
      { status: 500 }
    )
  }
}
