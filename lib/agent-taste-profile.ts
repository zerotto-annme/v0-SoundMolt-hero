import { getAdminClient } from "./supabase-admin"

/**
 * Agent Taste Profile v1 — compute-on-read.
 *
 * Builds a lightweight, interpretable taste profile from real data the
 * agent has already produced:
 *   - public.track_plays    (event_type ∈ play | replay)
 *   - public.track_analysis (results jsonb: bpm/key/energy/brightness/mood/tags)
 *   - public.tracks         (style → genre)
 *
 * No cache table. POST /rebuild calls the same function and returns a
 * fresh result. If/when a stored snapshot is added later, swap this
 * helper's call site without changing the route shape.
 */

export interface TasteProfile {
  agent_id:   string
  updated_at: string
  summary: {
    favorite_bpm_range?:         string
    top_moods?:                  string[]
    top_tags?:                   string[]
    top_genres?:                 string[]
    preferred_energy_range?:     [number, number]
    preferred_brightness_range?: [number, number]
    favorite_keys?:              string[]
  }
  signals: {
    listened_tracks_count:  number
    replayed_tracks_count:  number
    analyzed_tracks_count:  number
    favorited_tracks_count: number
  }
  message?: string
}

// Replays are a stronger signal than first plays. Favorites would be
// stronger still, but `track_favorites` lands in Phase 4 — until then
// we keep the weighting honest at 0 for favorites.
const PLAY_WEIGHT     = 1
const REPLAY_WEIGHT   = 2
const FAVORITE_WEIGHT = 3

// ─── small math helpers ────────────────────────────────────────────────
function percentileRange(values: number[], lowQ = 0.25, highQ = 0.75): [number, number] | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))]
  return [at(lowQ), at(highQ)]
}

function topN<T>(weighted: Map<T, number>, n: number): T[] {
  return [...weighted.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k)
}

function bumpString(map: Map<string, number>, key: unknown, weight: number) {
  if (typeof key !== "string") return
  const trimmed = key.trim()
  if (!trimmed) return
  map.set(trimmed, (map.get(trimmed) ?? 0) + weight)
}

function readNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string") {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

// ─── main aggregator ───────────────────────────────────────────────────
export async function computeTasteProfile(agentId: string): Promise<TasteProfile> {
  const admin = getAdminClient()

  // 1) Pull every play/replay event for this agent and the joined track's
  //    genre (style). Single round-trip via foreign-table select.
  const { data: playRows, error: playErr } = await admin
    .from("track_plays")
    .select("track_id, event_type, tracks!inner(style)")
    .eq("agent_id", agentId)

  if (playErr) throw new Error(`taste-profile: failed to read plays: ${playErr.message}`)

  type PlayRow = {
    track_id: string
    event_type: "play" | "replay"
    tracks: { style: string | null } | null
  }
  const plays = (playRows ?? []) as unknown as PlayRow[]

  // Per-track weight (replays count more than first plays).
  const trackWeight = new Map<string, number>()
  let listened = 0
  let replayed = 0
  for (const row of plays) {
    const w = row.event_type === "replay" ? REPLAY_WEIGHT : PLAY_WEIGHT
    trackWeight.set(row.track_id, (trackWeight.get(row.track_id) ?? 0) + w)
    if (row.event_type === "replay") replayed++
    else                              listened++
  }

  // Top genres come from listened/replayed tracks' style column.
  const genreCounts = new Map<string, number>()
  for (const row of plays) {
    const w = row.event_type === "replay" ? REPLAY_WEIGHT : PLAY_WEIGHT
    bumpString(genreCounts, row.tracks?.style, w)
  }

  // 2) Pull all analysis records for tracks the agent has touched.
  const trackIds = [...trackWeight.keys()]
  type AnalysisRow = { track_id: string; results: Record<string, unknown> | null }
  let analyses: AnalysisRow[] = []
  if (trackIds.length > 0) {
    // Scope to THIS agent's own analysis memory — other agents may have
    // analyzed the same track and their numbers must not leak into this
    // profile. (Required by spec: "current authenticated agent should
    // only see ... its own taste profile".)
    const { data: analysisRows, error: analysisErr } = await admin
      .from("track_analysis")
      .select("track_id, results")
      .eq("agent_id", agentId)
      .in("track_id", trackIds)
    if (analysisErr) throw new Error(`taste-profile: failed to read analyses: ${analysisErr.message}`)
    analyses = (analysisRows ?? []) as AnalysisRow[]
  }

  // Distinct analyzed tracks the agent has actually heard.
  const analyzedTrackIds = new Set(analyses.map((a) => a.track_id))
  const analyzedCount    = analyzedTrackIds.size

  // 3) Aggregate across analysis rows, weighted by per-track listen weight.
  const bpms:        number[] = []
  const energies:    number[] = []
  const brightness:  number[] = []
  const moodCounts   = new Map<string, number>()
  const tagCounts    = new Map<string, number>()
  const keyCounts    = new Map<string, number>()

  for (const row of analyses) {
    const w = trackWeight.get(row.track_id) ?? 1
    const r = row.results ?? {}

    const bpm = readNumber(r.bpm)
    if (bpm !== null) for (let i = 0; i < w; i++) bpms.push(bpm)

    const energy = readNumber(r.energy)
    if (energy !== null) for (let i = 0; i < w; i++) energies.push(energy)

    const bright = readNumber(r.brightness)
    if (bright !== null) for (let i = 0; i < w; i++) brightness.push(bright)

    bumpString(keyCounts, r.key, w)

    if (Array.isArray(r.mood)) for (const m of r.mood) bumpString(moodCounts, m, w)
    if (Array.isArray(r.tags)) for (const t of r.tags) bumpString(tagCounts, t, w)
  }

  // 4) Build the summary. Omit any facet we don't have data for so the
  //    response stays honest instead of padded.
  const summary: TasteProfile["summary"] = {}

  const bpmRange = percentileRange(bpms)
  if (bpmRange) summary.favorite_bpm_range = `${Math.round(bpmRange[0])}-${Math.round(bpmRange[1])}`

  const energyRange = percentileRange(energies)
  if (energyRange) summary.preferred_energy_range = [+energyRange[0].toFixed(2), +energyRange[1].toFixed(2)]

  const brightRange = percentileRange(brightness)
  if (brightRange) summary.preferred_brightness_range = [+brightRange[0].toFixed(2), +brightRange[1].toFixed(2)]

  const moods   = topN(moodCounts,  3); if (moods.length)   summary.top_moods     = moods
  const tags    = topN(tagCounts,   3); if (tags.length)    summary.top_tags      = tags
  const genres  = topN(genreCounts, 3); if (genres.length)  summary.top_genres    = genres
  const keys    = topN(keyCounts,   3); if (keys.length)    summary.favorite_keys = keys

  const signals = {
    listened_tracks_count:  listened,
    replayed_tracks_count:  replayed,
    analyzed_tracks_count:  analyzedCount,
    favorited_tracks_count: 0, // Phase 4: track_favorites lands then.
  }

  const profile: TasteProfile = {
    agent_id:   agentId,
    updated_at: new Date().toISOString(),
    summary,
    signals,
  }

  // Sparse-but-valid response when the agent hasn't generated enough memory yet.
  if (listened === 0 && replayed === 0 && analyzedCount === 0) {
    profile.message = "Not enough data yet to build a strong taste profile."
  }

  return profile
}

// Suppress unused-warning until Phase 4 (track_favorites) wires this in.
void FAVORITE_WEIGHT
