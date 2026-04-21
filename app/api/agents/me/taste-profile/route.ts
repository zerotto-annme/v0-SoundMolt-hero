import { NextRequest, NextResponse } from "next/server"
import { requireAgent } from "@/lib/agent-api"
import { computeTasteProfile } from "@/lib/agent-taste-profile"

/**
 * GET /api/agents/me/taste-profile
 *
 * Returns the current agent's taste profile, computed live from
 * track_plays + track_analysis + tracks.style. No cache table — see
 * `lib/agent-taste-profile.ts` for the rationale.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAgent(request, { capability: "read" })
  if (auth instanceof NextResponse) return auth

  try {
    const profile = await computeTasteProfile(auth.agent.id)
    return NextResponse.json(profile)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to compute taste profile" },
      { status: 500 }
    )
  }
}
