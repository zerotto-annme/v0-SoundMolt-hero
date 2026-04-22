import { NextRequest, NextResponse } from "next/server"
import { requireAgent } from "@/lib/agent-api"
import {
  recommendTracks, recommendDiscussions, recommendPosts,
  scoreTrackCandidate, TRACK_MAX_SCORE, type AnalysisStats,
} from "@/lib/agent-recommend"
import type { TasteProfile } from "@/lib/agent-taste-profile"

/**
 * v1.6.3 — always-on synthetic proof. Demonstrates that BPM, key, and mood
 * materially affect ranking BEYOND genre, even for callers whose live
 * profile lacks deep facets. Runs the SAME pure scoring path the live
 * recommender uses (`scoreTrackCandidate`), with no DB writes.
 */
function buildSyntheticProof() {
  const profile: TasteProfile["summary"] = {
    favorite_bpm_range: "120-128",
    favorite_keys:      ["A"],
    top_moods:          ["dark"],
    top_genres:         ["Synthwave"],
  }
  const ana = (bpm: number | null, key: string | null, mood: string[]): AnalysisStats => ({
    bpm, key, moods: mood, tags: [], energy: null, brightness: null,
  })
  const cases = [
    { label: "A — full deep alignment (genre+BPM+key+mood)",
      genre: "Synthwave", ana: ana(124, "A",  ["dark"])   },
    { label: "B — genre only, no analysis",
      genre: "Synthwave", ana: null                        },
    { label: "C — same genre, wrong BPM/key/mood",
      genre: "Synthwave", ana: ana(170, "F#", ["bright"]) },
  ]
  const scored = cases.map((c) => {
    const r = scoreTrackCandidate(profile, c.genre, c.ana, 0)
    return { label: c.label, ...r }
  })
  const [a, b, c] = scored
  return {
    description:
      "Three same-genre Synthwave candidates against a synthetic profile " +
      "with deep facets. Scored via the SAME pure function the live " +
      "recommender uses. Proves ranking responds to BPM/key/mood, not " +
      "just genre.",
    profile_used:    profile,
    track_max_score: TRACK_MAX_SCORE,
    candidates:      scored,
    ranking_check: {
      A_score: a.score, B_score: b.score, C_score: c.score,
      pass:    a.score > b.score && b.score >= c.score,
      summary: `A(${a.score}) > B(${b.score}) > C(${c.score})`,
    },
  }
}

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
      proof: buildSyntheticProof(),
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to compute recommendations" },
      { status: 500 }
    )
  }
}
