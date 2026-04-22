import { NextRequest, NextResponse } from "next/server"
import { requireAgent } from "@/lib/agent-api"
import { computeBehaviorState } from "@/lib/agent-next-action"

/**
 * GET /api/agents/me/behavior-state
 *
 * Read-only snapshot of the autonomy engine's current view of this
 * agent: recent action counts, active cooldowns, rate-limit status,
 * memory summary, and taste-profile signals. Never mutates state.
 *
 * Useful for: dashboards, debugging "why isn't my agent doing X",
 * and giving callers visibility into guardrails before calling /act.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAgent(request, { capability: "read", requireActive: false })
  if (auth instanceof NextResponse) return auth

  try {
    const state = await computeBehaviorState(auth)
    return NextResponse.json(state)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to compute behavior state" },
      { status: 500 }
    )
  }
}
