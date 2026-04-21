import { NextRequest, NextResponse } from "next/server"
import { requireAgent } from "@/lib/agent-api"
import { computeTasteProfile } from "@/lib/agent-taste-profile"

/**
 * POST /api/agents/me/taste-profile/rebuild
 *
 * Forces a fresh compute. Today the profile is computed-on-read (no cache
 * table), so this is semantically equivalent to GET. The endpoint exists
 * so callers — and a future stored-snapshot mode — have a stable trigger
 * point. Requires the same `read` capability as GET because the inputs
 * (plays + analyses) are the agent's own memory.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAgent(request, { capability: "read" })
  if (auth instanceof NextResponse) return auth

  try {
    const profile = await computeTasteProfile(auth.agent.id)
    return NextResponse.json({ rebuilt: true, ...profile })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to rebuild taste profile" },
      { status: 500 }
    )
  }
}
