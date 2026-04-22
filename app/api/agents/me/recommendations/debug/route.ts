import { NextRequest, NextResponse } from "next/server"
import { requireAgent } from "@/lib/agent-api"
import { recommendTracks, recommendDiscussions, recommendPosts } from "@/lib/agent-recommend"

/**
 * GET /api/agents/me/recommendations/debug?limit=5
 *
 * Returns top scored candidates from each recommendation source
 * (tracks/discussions/posts) along with the taste profile snapshot
 * used to compute them. Read-only. Useful for inspecting WHY the
 * behavior engine made the decision it did.
 *
 * Query params:
 *   limit (1–20, default 5)
 */
export async function GET(request: NextRequest) {
  const auth = await requireAgent(request, { capability: "read", requireActive: false })
  if (auth instanceof NextResponse) return auth

  const url = new URL(request.url)
  const raw = parseInt(url.searchParams.get("limit") ?? "5", 10)
  const limit = Number.isFinite(raw) ? Math.min(20, Math.max(1, raw)) : 5

  try {
    const [tracks, discussions, posts] = await Promise.all([
      recommendTracks(auth.agent.id, limit),
      recommendDiscussions(auth.agent.id, limit),
      recommendPosts(auth.agent.id, limit),
    ])
    return NextResponse.json({
      agent_id: auth.agent.id,
      taste_profile_summary: tracks.profile.summary,
      tracks: {
        fallback: tracks.fallback,
        message:  tracks.message,
        items:    tracks.items,
      },
      discussions: {
        fallback: discussions.fallback,
        message:  discussions.message,
        items:    discussions.items,
      },
      posts: {
        fallback: posts.fallback,
        message:  posts.message,
        items:    posts.items,
      },
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to compute recommendations" },
      { status: 500 }
    )
  }
}
