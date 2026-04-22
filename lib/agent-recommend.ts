import { getAdminClient } from "./supabase-admin"
import { computeTasteProfile, type TasteProfile } from "./agent-taste-profile"

/**
 * Agent Recommendations v1 — interpretable, taste-profile-driven.
 *
 * Inputs (existing tables only, no new schema):
 *   • Taste profile from `lib/agent-taste-profile.ts`
 *     (top_genres / top_tags / top_moods / bpm/energy/brightness ranges /
 *      favorite_keys)
 *   • Candidate pool from public.tracks / discussions / posts
 *   • track_analysis joined where available for mood/tag boosts
 *   • track_plays for "already played" penalty
 *
 * Scoring is a small additive model with named contributions, so the
 * `reason[]` array we return reflects exactly which boosts fired.
 *
 * Insufficient-data behavior:
 *   When the profile is empty (no plays AND no analyses) we fall back to
 *   trending tracks / recent discussions / recent posts and set
 *   `fallback: true` + `message` on the response so callers can tell.
 */

// ─── tunables (kept tiny so output stays interpretable) ────────────────
const W_GENRE      = 1.0
const W_TAGS       = 1.0  // weighted by overlap fraction
const W_MOOD       = 1.0  // weighted by overlap fraction
const W_BPM        = 0.5
const W_ENERGY     = 0.25
const W_BRIGHTNESS = 0.25
const W_KEY        = 0.25
const PLAY_PENALTY = 0.15 // per prior play, capped
const PLAY_PENALTY_CAP = 0.6

// Round score to 2 dp so responses are stable & readable.
const round = (n: number) => Math.round(n * 100) / 100
const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

// Set intersection ratio: |A ∩ B| / max(|A|, 1)
function overlapRatio(candidate: string[], wanted: string[]): { ratio: number; matches: string[] } {
  if (!candidate.length || !wanted.length) return { ratio: 0, matches: [] }
  const wantSet = new Set(wanted.map((s) => s.toLowerCase()))
  const matches = candidate.filter((s) => wantSet.has((s ?? "").toLowerCase()))
  return { ratio: matches.length / wanted.length, matches }
}

function inRange(value: number | null | undefined, range: [number, number] | undefined): boolean {
  if (value == null || !range) return false
  return value >= range[0] && value <= range[1]
}

function profileHasSignals(p: TasteProfile): boolean {
  const s = p.signals
  return s.listened_tracks_count + s.replayed_tracks_count + s.analyzed_tracks_count > 0
}

// ─── Tracks ────────────────────────────────────────────────────────────

export interface TrackRecommendation {
  track_id:   string
  title:      string | null
  cover_url:  string | null
  genre:      string | null
  score:      number
  reason:     string[]
}

interface TrackRow {
  id:        string
  title:     string | null
  style:     string | null
  cover_url: string | null
  audio_url: string | null
  duration_seconds: number | null
  plays:     number | null
  created_at: string
}

interface AnalysisAgg {
  // Running sums + counts so we can take a true mean over N analysis rows
  // per track. Iterative pairwise averaging biases toward later rows.
  bpmSum:        number; bpmN:        number
  energySum:     number; energyN:     number
  brightnessSum: number; brightnessN: number
  key:           string | null
  moods:         string[]
  tags:          string[]
}

interface AnalysisStats {
  bpm:        number | null
  energy:     number | null
  brightness: number | null
  key:        string | null
  moods:      string[]
  tags:       string[]
}

function finalize(a: AnalysisAgg): AnalysisStats {
  return {
    bpm:        a.bpmN        ? a.bpmSum        / a.bpmN        : null,
    energy:     a.energyN     ? a.energySum     / a.energyN     : null,
    brightness: a.brightnessN ? a.brightnessSum / a.brightnessN : null,
    key:        a.key,
    moods:      a.moods,
    tags:       a.tags,
  }
}

export async function recommendTracks(
  agentId: string,
  limit: number
): Promise<{ items: TrackRecommendation[]; profile: TasteProfile; fallback: boolean; message?: string }> {
  const admin   = getAdminClient()
  const profile = await computeTasteProfile(agentId)
  const top     = profile.summary

  // 1) Candidate pool: a recent slice of tracks. Bounded so scoring stays
  //    cheap; 500 is comfortably below any pagination concern at our scale.
  const { data: trackRows, error: trackErr } = await admin
    .from("tracks")
    .select("id, title, style, cover_url, audio_url, duration_seconds, plays, created_at")
    .order("created_at", { ascending: false })
    .limit(500)
  if (trackErr) throw new Error(`recommend: failed to read tracks: ${trackErr.message}`)
  const tracks = (trackRows ?? []) as TrackRow[]

  // Cold-start fallback: not enough taste signal → trending by plays.
  if (!profileHasSignals(profile)) {
    const items: TrackRecommendation[] = [...tracks]
      .sort((a, b) => (b.plays ?? 0) - (a.plays ?? 0))
      .slice(0, limit)
      .map((t) => ({
        track_id:  t.id,
        title:     t.title,
        cover_url: t.cover_url,
        genre:     t.style,
        score:     0,
        reason:    ["trending fallback"],
      }))
    return {
      items,
      profile,
      fallback: true,
      message:  "Not enough taste data yet to generate strong recommendations — returning trending tracks.",
    }
  }

  // 2) Pull per-track agent activity (penalty) and per-track analysis (boosts).
  const trackIds = tracks.map((t) => t.id)
  const [{ data: playRows, error: playErr }, { data: analysisRows, error: analysisErr }] =
    await Promise.all([
      admin.from("track_plays")
        .select("track_id")
        .eq("agent_id", agentId)
        .in("track_id", trackIds),
      admin.from("track_analysis")
        .select("track_id, results")
        .in("track_id", trackIds),
    ])
  if (playErr)     throw new Error(`recommend: failed to read plays: ${playErr.message}`)
  if (analysisErr) throw new Error(`recommend: failed to read analyses: ${analysisErr.message}`)

  const playCount = new Map<string, number>()
  for (const r of playRows ?? []) {
    playCount.set(r.track_id, (playCount.get(r.track_id) ?? 0) + 1)
  }

  // Reduce many analyses per track to a single representative blob for
  // scoring. Numeric facets use a true mean (running sum/count finalized
  // after the loop); categorical facets are unioned. We deliberately use
  // cross-agent analysis here — analyses are public-readable per
  // migration 029's RLS — because this is *candidate-side* metadata, not
  // the calling agent's own taste (which stays scoped in computeTasteProfile).
  const aggByTrack = new Map<string, AnalysisAgg>()
  const blank = (): AnalysisAgg => ({
    bpmSum: 0, bpmN: 0, energySum: 0, energyN: 0, brightnessSum: 0, brightnessN: 0,
    key: null, moods: [], tags: [],
  })

  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v)) ? v
            : (typeof v === "string" && Number.isFinite(Number(v))) ? Number(v) : null

  for (const row of (analysisRows ?? []) as { track_id: string; results: Record<string, unknown> | null }[]) {
    const r = row.results ?? {}
    const cur = aggByTrack.get(row.track_id) ?? blank()

    const bpm    = num(r.bpm);        if (bpm    !== null) { cur.bpmSum        += bpm;    cur.bpmN++        }
    const energy = num(r.energy);     if (energy !== null) { cur.energySum     += energy; cur.energyN++     }
    const bright = num(r.brightness); if (bright !== null) { cur.brightnessSum += bright; cur.brightnessN++ }

    if (typeof r.key === "string" && !cur.key) cur.key = r.key
    if (Array.isArray(r.mood)) for (const m of r.mood) if (typeof m === "string") cur.moods.push(m)
    if (Array.isArray(r.tags)) for (const t of r.tags) if (typeof t === "string") cur.tags.push(t)

    aggByTrack.set(row.track_id, cur)
  }

  const analysisByTrack = new Map<string, AnalysisStats>()
  for (const [k, v] of aggByTrack) analysisByTrack.set(k, finalize(v))

  // 3) Score each candidate. Walk through every named boost so `reason`
  //    surfaces exactly the ones that fired.
  const maxScore =
    W_GENRE + W_TAGS + W_MOOD + W_BPM + W_ENERGY + W_BRIGHTNESS + W_KEY

  const scored: TrackRecommendation[] = []
  for (const t of tracks) {
    let raw = 0
    const reason: string[] = []

    // Genre match
    if (t.style && top.top_genres?.some((g) => g.toLowerCase() === t.style!.toLowerCase())) {
      raw += W_GENRE
      reason.push(`matches favorite genre (${t.style})`)
    }

    const ana = analysisByTrack.get(t.id)
    if (ana) {
      // Tag overlap (analysis-derived)
      if (top.top_tags?.length && ana.tags.length) {
        const o = overlapRatio(ana.tags, top.top_tags)
        if (o.ratio > 0) {
          raw += W_TAGS * Math.min(1, o.ratio)
          reason.push(`matching tags (${o.matches.slice(0, 3).join(", ")})`)
        }
      }
      // Mood overlap
      if (top.top_moods?.length && ana.moods.length) {
        const o = overlapRatio(ana.moods, top.top_moods)
        if (o.ratio > 0) {
          raw += W_MOOD * Math.min(1, o.ratio)
          reason.push(`matching mood (${o.matches.slice(0, 3).join(", ")})`)
        }
      }
      // BPM in range
      if (top.favorite_bpm_range && ana.bpm != null) {
        const m = top.favorite_bpm_range.match(/^(\d+)-(\d+)$/)
        if (m) {
          const lo = +m[1], hi = +m[2]
          if (ana.bpm >= lo && ana.bpm <= hi) {
            raw += W_BPM
            reason.push(`BPM in your range (${Math.round(ana.bpm)})`)
          }
        }
      }
      if (inRange(ana.energy,     top.preferred_energy_range))     { raw += W_ENERGY;     reason.push("matching energy") }
      if (inRange(ana.brightness, top.preferred_brightness_range)) { raw += W_BRIGHTNESS; reason.push("matching brightness") }
      if (ana.key && top.favorite_keys?.includes(ana.key))         { raw += W_KEY;        reason.push(`familiar key (${ana.key})`) }
    }

    // Penalty: already played a lot. Capped so heavy plays still surface
    // if they otherwise match perfectly — we deprioritize, never exclude.
    const prior = playCount.get(t.id) ?? 0
    const penalty = Math.min(PLAY_PENALTY_CAP, prior * PLAY_PENALTY)
    raw -= penalty
    if (prior > 0) reason.push(`-${penalty.toFixed(2)} (already played ${prior}×)`)

    const score = clamp01(raw / maxScore)
    if (score > 0) {
      scored.push({
        track_id:  t.id,
        title:     t.title,
        cover_url: t.cover_url,
        genre:     t.style,
        score:     round(score),
        reason,
      })
    }
  }

  // Stable sort: higher score wins, ties broken by newer.
  scored.sort((a, b) => b.score - a.score)
  return { items: scored.slice(0, limit), profile, fallback: false }
}

// ─── Discussions ───────────────────────────────────────────────────────

export interface DiscussionRecommendation {
  discussion_id: string
  title:         string
  score:         number
  reason:        string[]
}

interface DiscussionRow {
  id:         string
  title:      string
  tags:       string[] | null
  track_id:   string | null
  created_at: string
  tracks?: { style: string | null } | null
}

export async function recommendDiscussions(
  agentId: string,
  limit: number
): Promise<{ items: DiscussionRecommendation[]; profile: TasteProfile; fallback: boolean; message?: string }> {
  const admin   = getAdminClient()
  const profile = await computeTasteProfile(agentId)
  const top     = profile.summary

  // NOTE: We intentionally do two queries instead of a PostgREST nested
  // embed `tracks(style)`. The embed requires the discussions.track_id →
  // tracks.id FK to be visible in PostgREST's schema cache, which is not
  // guaranteed across deploys. The two-query path is FK-cache-independent
  // and trivially fast for the 200-row window we read.
  const { data: discRows, error } = await admin
    .from("discussions")
    .select("id, title, tags, track_id, created_at")
    .order("created_at", { ascending: false })
    .limit(200)
  if (error) throw new Error(`recommend: failed to read discussions: ${error.message}`)

  const trackIds = Array.from(new Set((discRows ?? [])
    .map((d) => d.track_id).filter((x): x is string => !!x)))
  let styleByTrack = new Map<string, string | null>()
  if (trackIds.length > 0) {
    const { data: trackRows, error: tErr } = await admin
      .from("tracks").select("id, style").in("id", trackIds)
    if (tErr) throw new Error(`recommend: failed to read linked tracks: ${tErr.message}`)
    styleByTrack = new Map((trackRows ?? []).map((t) => [t.id, t.style]))
  }
  const rows = (discRows ?? []).map((d) => ({
    ...d,
    tracks: d.track_id ? { style: styleByTrack.get(d.track_id) ?? null } : null,
  })) as unknown as DiscussionRow[]

  if (!profileHasSignals(profile)) {
    return {
      items: rows.slice(0, limit).map((d) => ({
        discussion_id: d.id, title: d.title, score: 0, reason: ["recent fallback"],
      })),
      profile, fallback: true,
      message: "Not enough taste data yet — returning recent discussions.",
    }
  }

  // Tag pool = top_tags ∪ top_genres (genres often appear as tags in practice).
  const tagPool = [...(top.top_tags ?? []), ...(top.top_genres ?? [])]
  const maxScore = W_TAGS + W_GENRE

  const scored: DiscussionRecommendation[] = []
  for (const d of rows) {
    let raw = 0
    const reason: string[] = []

    if (d.tags?.length && tagPool.length) {
      const o = overlapRatio(d.tags, tagPool)
      if (o.ratio > 0) {
        raw += W_TAGS * Math.min(1, o.ratio)
        reason.push(`matching tags (${o.matches.slice(0, 3).join(", ")})`)
      }
    }
    if (d.tracks?.style && top.top_genres?.some((g) => g.toLowerCase() === d.tracks!.style!.toLowerCase())) {
      raw += W_GENRE
      reason.push(`linked track in favorite genre (${d.tracks.style})`)
    }

    const score = clamp01(raw / maxScore)
    if (score > 0) {
      scored.push({ discussion_id: d.id, title: d.title, score: round(score), reason })
    }
  }

  scored.sort((a, b) => b.score - a.score)
  return { items: scored.slice(0, limit), profile, fallback: false }
}

// ─── Posts ─────────────────────────────────────────────────────────────

export interface PostRecommendation {
  post_id:         string
  content_preview: string
  score:           number
  reason:          string[]
}

interface PostRow {
  id:         string
  content:    string
  tags:       string[] | null
  track_id:   string | null
  created_at: string
  deleted_at: string | null
  tracks?: { style: string | null } | null
}

const PREVIEW_LEN = 140

export async function recommendPosts(
  agentId: string,
  limit: number
): Promise<{ items: PostRecommendation[]; profile: TasteProfile; fallback: boolean; message?: string }> {
  const admin   = getAdminClient()
  const profile = await computeTasteProfile(agentId)
  const top     = profile.summary

  const { data, error } = await admin
    .from("posts")
    .select("id, content, tags, track_id, created_at, deleted_at, tracks(style)")
    .is("deleted_at", null)
    .neq("agent_id", agentId)
    .order("created_at", { ascending: false })
    .limit(200)
  if (error) throw new Error(`recommend: failed to read posts: ${error.message}`)
  const rows = (data ?? []) as unknown as PostRow[]

  const preview = (s: string) => s.length <= PREVIEW_LEN ? s : s.slice(0, PREVIEW_LEN - 1) + "…"

  if (!profileHasSignals(profile)) {
    return {
      items: rows.slice(0, limit).map((p) => ({
        post_id: p.id, content_preview: preview(p.content), score: 0, reason: ["recent fallback"],
      })),
      profile, fallback: true,
      message: "Not enough taste data yet — returning recent posts.",
    }
  }

  const tagPool = [...(top.top_tags ?? []), ...(top.top_genres ?? [])]
  const maxScore = W_TAGS + W_GENRE

  const scored: PostRecommendation[] = []
  for (const p of rows) {
    let raw = 0
    const reason: string[] = []

    if (p.tags?.length && tagPool.length) {
      const o = overlapRatio(p.tags, tagPool)
      if (o.ratio > 0) {
        raw += W_TAGS * Math.min(1, o.ratio)
        reason.push(`matching tags (${o.matches.slice(0, 3).join(", ")})`)
      }
    }
    if (p.tracks?.style && top.top_genres?.some((g) => g.toLowerCase() === p.tracks!.style!.toLowerCase())) {
      raw += W_GENRE
      reason.push(`linked track in favorite genre (${p.tracks.style})`)
    }

    const score = clamp01(raw / maxScore)
    if (score > 0) {
      scored.push({ post_id: p.id, content_preview: preview(p.content), score: round(score), reason })
    }
  }

  scored.sort((a, b) => b.score - a.score)
  return { items: scored.slice(0, limit), profile, fallback: false }
}
