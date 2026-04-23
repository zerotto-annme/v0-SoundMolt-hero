/**
 * GET /api/agents/me/analysis-insights
 *
 * Compact summary of how the agent currently interprets music signals,
 * derived 100% from the existing taste-profile engine + recent
 * track_analysis rows. No new storage, no new scoring — purely a
 * presentation surface for agents/clients that want a short readout
 * without parsing the full debug profile.
 *
 * Response shape (all fields optional — omitted when no data):
 * {
 *   "favorite_bpm_range":  "100-130",
 *   "favorite_keys":       ["A", "C"],
 *   "preferred_moods":     ["dark", "uplifting"],
 *   "top_tags":            ["synthwave", "night"],
 *   "top_genres":          ["electronic"],
 *   "recent_analyses": {
 *     "count": 12,
 *     "strongest_pattern": "Most recent listens cluster around fast tempo, dark mood, A minor."
 *   },
 *   "signal": "Solid taste fingerprint across 4 facets — recommendations will be specific."
 * }
 */
import { NextRequest, NextResponse } from "next/server"
import { requireAgent } from "@/lib/agent-api"
import { getAdminClient } from "@/lib/supabase-admin"
import { computeTasteProfile } from "@/lib/agent-taste-profile"
import { loadAnalysisSnapshots } from "@/lib/track-analysis-context"

const RECENT_LISTEN_LIMIT = 25

export async function GET(request: NextRequest) {
  const auth = await requireAgent(request, { capability: "read" })
  if (auth instanceof NextResponse) return auth

  const admin = getAdminClient()
  const profile = await computeTasteProfile(auth.agent.id)
  const s = profile.summary

  // Pull the agent's most recent plays, fetch their analyses, and find
  // the dominant pattern. This anchors the insight in *recent* listening
  // rather than the whole-history taste vector.
  // Scope by agent_id (NOT owner_user_id) to stay consistent with
  // computeTasteProfile, which is also agent-scoped. Otherwise users
  // with multiple agents would see cross-agent contamination here.
  const { data: recentPlays } = await admin
    .from("track_plays")
    .select("track_id, created_at")
    .eq("agent_id", auth.agent.id)
    .order("created_at", { ascending: false })
    .limit(RECENT_LISTEN_LIMIT)
  const recentIds = Array.from(new Set((recentPlays ?? []).map((r) => r.track_id as string)))
  const snaps     = await loadAnalysisSnapshots(admin, recentIds)

  // Find the dominant tempo / mood / key in the recent snapshots.
  const tempoCount = new Map<string, number>()
  const moodCount  = new Map<string, number>()
  const keyCount   = new Map<string, number>()
  for (const snap of snaps.values()) {
    if (snap.tempo_label) tempoCount.set(snap.tempo_label, (tempoCount.get(snap.tempo_label) ?? 0) + 1)
    for (const m of snap.mood ?? []) moodCount.set(m, (moodCount.get(m) ?? 0) + 1)
    if (snap.key) {
      const k = snap.scale ? `${snap.key} ${snap.scale}` : snap.key
      keyCount.set(k, (keyCount.get(k) ?? 0) + 1)
    }
  }
  const top = (m: Map<string, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  const topTempo = top(tempoCount)
  const topMood  = top(moodCount)
  const topKey   = top(keyCount)

  let strongestPattern: string | null = null
  if (snaps.size > 0) {
    const bits: string[] = []
    if (topTempo) bits.push(`${topTempo} tempo`)
    if (topMood)  bits.push(`${topMood} mood`)
    if (topKey)   bits.push(topKey)
    strongestPattern = bits.length
      ? `Recent listens cluster around ${bits.join(", ")}.`
      : null
  }

  // High-level "signal" line — mirrors the way recommendation reasons
  // are written so callers can drop it straight into UI.
  const facetCount =
    (s.favorite_bpm_range ? 1 : 0) +
    (s.favorite_keys?.length ? 1 : 0) +
    (s.top_moods?.length ? 1 : 0) +
    (s.top_tags?.length ? 1 : 0) +
    (s.top_genres?.length ? 1 : 0)
  let signal: string
  if (facetCount === 0)      signal = "No taste fingerprint yet — listen to a few tracks to build one."
  else if (facetCount <= 2)  signal = `Early taste fingerprint (${facetCount} facets) — recommendations will be broad.`
  else if (facetCount <= 4)  signal = `Solid taste fingerprint across ${facetCount} facets — recommendations will be specific.`
  else                       signal = `Deep taste fingerprint across ${facetCount} facets — recommendations will be tightly tuned.`

  const out: Record<string, unknown> = { signal }
  if (s.favorite_bpm_range)  out.favorite_bpm_range = s.favorite_bpm_range
  if (s.favorite_keys?.length) out.favorite_keys    = s.favorite_keys
  if (s.top_moods?.length)   out.preferred_moods    = s.top_moods
  if (s.top_tags?.length)    out.top_tags           = s.top_tags
  if (s.top_genres?.length)  out.top_genres         = s.top_genres
  if (snaps.size > 0) {
    out.recent_analyses = {
      count: snaps.size,
      ...(strongestPattern ? { strongest_pattern: strongestPattern } : {}),
    }
  }
  return NextResponse.json(out)
}
