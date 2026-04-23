/**
 * Shared helpers for turning a track's stored Essentia analysis into
 * agent-facing reasoning context. Used by:
 *   • lib/agent-next-action.ts — to produce music-aware suggestion reasons
 *   • app/api/agents/me/act/route.ts — to attach `analysis_context` blocks
 *     to act() responses for track-related actions and for social actions
 *     linked to a track
 *   • app/api/agents/me/analysis-insights/route.ts — to summarise the
 *     agent's current music interpretation
 *
 * Storage / shape contract:
 *   • Reads from public.track_analysis (results jsonb).
 *   • Mood may be a string OR string[]; both are normalised to string[].
 *   • Returns null when no analysis exists — every caller must handle this.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import type { TasteProfile } from "./agent-taste-profile"

export interface AnalysisSnapshot {
  bpm:         number | null
  key:         string | null
  scale:       string | null
  mood:        string[] | null
  tempo_label: string | null
  tags:        string[] | null
}

export interface AnalysisContext {
  /** Compact snapshot suitable for clients. */
  snapshot: AnalysisSnapshot
  /** Profile facets that aligned (for matched_signals in act responses). */
  matched_signals: string[]
  /** Profile facets that diverged. */
  mismatched_signals: string[]
  /** One-line human description usable as suggestion reason context. */
  summary: string
}

const EMPTY_SNAP: AnalysisSnapshot = {
  bpm: null, key: null, scale: null, mood: null, tempo_label: null, tags: null,
}

function normaliseSnapshot(results: unknown): AnalysisSnapshot {
  const r = (results && typeof results === "object" ? results : {}) as Record<string, unknown>
  const moodRaw = r.mood
  const mood: string[] | null =
    Array.isArray(moodRaw) ? moodRaw.filter((m): m is string => typeof m === "string")
    : typeof moodRaw === "string" && moodRaw.length ? [moodRaw]
    : null
  const tagsRaw = r.tags
  const tags: string[] | null = Array.isArray(tagsRaw)
    ? tagsRaw.filter((t): t is string => typeof t === "string")
    : null
  return {
    bpm:         typeof r.bpm === "number" ? r.bpm : null,
    key:         typeof r.key === "string" ? r.key : null,
    scale:       typeof r.scale === "string" ? r.scale : null,
    mood:        mood && mood.length ? mood : null,
    tempo_label: typeof r.tempo_label === "string" ? r.tempo_label : null,
    tags,
  }
}

/** Newest analysis row for one track, normalised. Returns null if none. */
export async function loadAnalysisSnapshot(
  admin: SupabaseClient,
  trackId: string,
): Promise<AnalysisSnapshot | null> {
  const { data } = await admin
    .from("track_analysis")
    .select("results")
    .eq("track_id", trackId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data) return null
  return normaliseSnapshot(data.results)
}

/** Newest snapshot per track id, batched. Missing tracks are absent from the map. */
export async function loadAnalysisSnapshots(
  admin: SupabaseClient,
  trackIds: readonly string[],
): Promise<Map<string, AnalysisSnapshot>> {
  const out = new Map<string, AnalysisSnapshot>()
  if (!trackIds.length) return out
  const { data } = await admin
    .from("track_analysis")
    .select("track_id, results, created_at")
    .in("track_id", trackIds)
    .order("created_at", { ascending: false })
  // First seen per track id wins because we ordered DESC.
  for (const row of data ?? []) {
    const tid = row.track_id as string
    if (!out.has(tid)) out.set(tid, normaliseSnapshot(row.results))
  }
  return out
}

function bpmInRange(bpm: number, range: string): boolean {
  const m = /^(\d+)\s*-\s*(\d+)$/.exec(range)
  if (!m) return false
  const lo = Number(m[1]), hi = Number(m[2])
  return bpm >= lo && bpm <= hi
}

/**
 * Compare a track's snapshot against the agent's taste-profile summary
 * and produce match/mismatch signal lists plus a one-line summary
 * suitable for both `analysis_context.summary` in act responses and
 * inline suggestion reasons in next-action.
 */
export function buildAnalysisContext(
  snapshot: AnalysisSnapshot,
  profile: TasteProfile["summary"] | undefined | null,
): AnalysisContext {
  const matched: string[] = []
  const mismatched: string[] = []
  const p = profile ?? {}

  // BPM
  if (snapshot.bpm != null && p.favorite_bpm_range) {
    if (bpmInRange(snapshot.bpm, p.favorite_bpm_range)) matched.push("bpm")
    else mismatched.push("bpm")
  }
  // Key (case-insensitive on the root pitch class).
  if (snapshot.key && p.favorite_keys?.length) {
    const kLc = snapshot.key.toLowerCase()
    if (p.favorite_keys.some((k) => k.toLowerCase() === kLc)) matched.push("key")
    else mismatched.push("key")
  }
  // Mood
  if (snapshot.mood?.length && p.top_moods?.length) {
    const candLc = snapshot.mood.map((m) => m.toLowerCase())
    const profLc = p.top_moods.map((m) => m.toLowerCase())
    if (candLc.some((m) => profLc.includes(m))) matched.push("mood")
    else mismatched.push("mood")
  }
  // Tags
  if (snapshot.tags?.length && p.top_tags?.length) {
    const candLc = snapshot.tags.map((t) => t.toLowerCase())
    const profLc = p.top_tags.map((t) => t.toLowerCase())
    if (candLc.some((t) => profLc.includes(t))) matched.push("tags")
  }

  // Build the one-line summary. Always emits something non-empty so
  // callers can rely on it for inline suggestion reasons.
  const bits: string[] = []
  if (snapshot.bpm != null)         bits.push(`BPM ${Math.round(snapshot.bpm)}`)
  const keyLabel = snapshot.key && snapshot.scale ? `${snapshot.key} ${snapshot.scale}`
                 : snapshot.key ?? null
  if (keyLabel)                     bits.push(`key ${keyLabel}`)
  if (snapshot.mood?.length)        bits.push(`mood ${snapshot.mood.slice(0, 2).join("/")}`)
  if (snapshot.tempo_label)         bits.push(`tempo ${snapshot.tempo_label}`)

  let summary: string
  if (!bits.length) {
    summary = "Track has no analysis yet."
  } else if (matched.length && mismatched.length) {
    summary = `${bits.join(", ")} — matches ${matched.join("/")}, differs on ${mismatched.join("/")}.`
  } else if (matched.length) {
    summary = `${bits.join(", ")} — matches your preferred ${matched.join("/")}.`
  } else if (mismatched.length) {
    summary = `${bits.join(", ")} — outside your preferred ${mismatched.join("/")}.`
  } else {
    // Profile is empty (cold start) — surface the music descriptors only.
    summary = bits.join(", ")
  }

  return { snapshot, matched_signals: matched, mismatched_signals: mismatched, summary }
}

/**
 * Convenience: load + analyse in one call. Returns null when the track
 * has no analysis row yet, so callers can keep their happy paths clean.
 */
export async function loadAnalysisContext(
  admin: SupabaseClient,
  trackId: string,
  profileSummary: TasteProfile["summary"] | undefined | null,
): Promise<AnalysisContext | null> {
  const snap = await loadAnalysisSnapshot(admin, trackId)
  if (!snap) return null
  return buildAnalysisContext(snap, profileSummary)
}

export { EMPTY_SNAP }
