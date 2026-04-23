/**
 * Creator Feedback Layer v1.1
 *
 * Turns SoundMolt's existing music intelligence (Essentia analysis +
 * taste-profile signals) into creator-facing feedback: strengths,
 * weaknesses, improvements and a fit score.
 *
 * v1.1 polish (output shape unchanged):
 *   • Phrasing translated from raw technical values into natural
 *     creator language ("fast-paced rhythmic feel" instead of "124 BPM",
 *     "darker tonal center" instead of "A minor", "current taste
 *     profile" instead of "owner-profile fit"). Raw values still live
 *     in `signals` for consumers that want them.
 *   • Weaknesses now fire in more justified situations — narrow
 *     emotional range, low-contrast cohesion, near-perfect-fit
 *     blend-in risk — so the field is no longer empty when there's
 *     real, evidence-based commentary to give.
 *
 * Design notes (unchanged):
 *   • Compute-on-read. No new tables, no snapshot persistence. Both
 *     GET /api/tracks/:id/feedback and POST .../feedback/rebuild call
 *     `buildTrackFeedback` directly. "Rebuild" simply re-runs the
 *     computation against the latest analysis + taste profile.
 *   • Reuses `loadAnalysisSnapshot` (newest analysis row) and
 *     `buildAnalysisContext` (matched/mismatched signal extractor) so
 *     scoring stays consistent with /next-action and /act outputs.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  loadAnalysisSnapshot,
  buildAnalysisContext,
  type AnalysisSnapshot,
  type AnalysisContext,
} from "./track-analysis-context"
import { computeTasteProfile, type TasteProfile } from "./agent-taste-profile"

export interface TrackFeedback {
  track_id:    string
  provider:    "soundmolt-feedback-v1"
  summary: {
    /**
     * Match against the owner's current taste profile, 0..1
     * (two decimals). Emitted as null in cold-start cases where there
     * are no comparable signals to score against.
     */
    fit_score: number | null
    overall:   string
  }
  strengths:    string[]
  weaknesses:   string[]
  improvements: string[]
  signals: {
    bpm:         number | null
    key:         string | null
    scale:       string | null
    mood:        string | null     // primary mood for compactness
    tempo_label: string | null
  }
  /** Plain-language list of what aligned, derived from matched_signals. */
  explanations: string[]
  /** Generation time of *this* feedback payload (ISO). */
  created_at:   string
  /** When the underlying analysis row was written (ISO, or null if unknown). */
  analysis_created_at: string | null
}

// ─────────────────────────────────────────────────────────────────────
// Natural-language translators
//   These translate raw analysis values into descriptive phrases used
//   throughout summary/strengths/weaknesses. Raw values still appear in
//   the `signals` object for clients that want them.
// ─────────────────────────────────────────────────────────────────────

/** "124" → "fast-paced rhythmic feel" (qualitative tempo descriptor). */
function tempoFeel(bpm: number | null, tempoLabel: string | null): string | null {
  if (bpm == null && !tempoLabel) return null
  if (bpm != null) {
    if (bpm < 80)        return "slow, spacious pacing"
    if (bpm < 100)       return "relaxed mid-tempo feel"
    if (bpm < 115)       return "steady, grounded groove"
    if (bpm < 128)       return "energetic mid-to-up tempo"
    if (bpm < 140)       return "fast-paced rhythmic feel"
    if (bpm < 160)       return "driving, high-energy pace"
    return "very fast, intense pacing"
  }
  return tempoLabel
}

/** "A" + "minor" → "darker tonal center"; key alone → "<key>-centered tonality". */
function tonalFeel(key: string | null, scale: string | null, mood: string[] | null): string | null {
  if (!key && !scale) return null
  // Mood often gives a more useful emotional tone than key/scale alone.
  if (mood?.length) {
    const m = mood[0].toLowerCase()
    if (/(dark|sad|melanchol|brood|tense)/.test(m))   return "darker tonal center"
    if (/(bright|happy|uplift|joyful|energ)/.test(m)) return "brighter tonal center"
    if (/(warm|relax|chill|mellow)/.test(m))          return "warm, settled tonality"
    if (/(aggress|intens|hard)/.test(m))              return "intense, driving tonality"
  }
  if (scale === "minor") return "darker tonal center"
  if (scale === "major") return "brighter tonal center"
  if (key)               return `${key}-centered tonality`
  return null
}

/** Combined music-feel summary: "fast-paced rhythmic feel with a darker tonal center". */
function describeFeel(snap: AnalysisSnapshot): string {
  const tempo = tempoFeel(snap.bpm, snap.tempo_label)
  const tonal = tonalFeel(snap.key, snap.scale, snap.mood)
  if (tempo && tonal) return `${tempo} with a ${tonal}`
  return tempo ?? tonal ?? "distinct musical character"
}

// ─────────────────────────────────────────────────────────────────────
// Creator-facing copy. All phrasing lives here so it's easy to audit.
// ─────────────────────────────────────────────────────────────────────
const STRENGTH_COPY: Record<string, string> = {
  bpm:   "Sits inside the tempo zone that most resonates with the current taste profile.",
  key:   "Tonally aligned with the keys that match the current taste profile.",
  mood:  "Emotional tone matches the mood signature the taste profile gravitates toward.",
  tags:  "Style descriptors overlap with the labels the current taste profile favors.",
}

const WEAKNESS_COPY: Record<string, string> = {
  bpm:   "Tempo sits a little outside the pace this taste profile usually returns to.",
  key:   "Key choice is unusual for this taste profile — may feel slightly disconnected from the rest of the catalogue.",
  mood:  "Emotional tone diverges from the mood signature this taste profile expects.",
}

const IMPROVEMENT_COPY: Record<string, string> = {
  bpm:   "If you want broader appeal, ease the tempo closer to your typical pace — or lean further out for deliberate contrast.",
  key:   "Consider an alternate key (or a brief modulation) to thread this track back into the rest of your work.",
  mood:  "A contrasting section — a brighter break or a darker bridge — would broaden the emotional arc.",
}

const EXPLANATION_COPY: Record<string, string> = {
  bpm:   "Tempo aligns with the taste profile's preferred pace.",
  key:   "Key aligns with the taste profile's preferred tonality.",
  mood:  "Mood aligns with the taste profile's emotional palette.",
  tags:  "Style tags align with the taste profile's descriptors.",
}

// ─────────────────────────────────────────────────────────────────────
// Fit score: light, transparent weighting over the same signals
// recommendations use. Capped at 1.0; floors at 0.0.
// ─────────────────────────────────────────────────────────────────────
const W_BPM   = 0.35
const W_KEY   = 0.25
const W_MOOD  = 0.30
const W_TAGS  = 0.10

function computeFitScore(ctx: AnalysisContext): number {
  let score = 0
  for (const sig of ctx.matched_signals) {
    if      (sig === "bpm")  score += W_BPM
    else if (sig === "key")  score += W_KEY
    else if (sig === "mood") score += W_MOOD
    else if (sig === "tags") score += W_TAGS
  }
  for (const sig of ctx.mismatched_signals) {
    if      (sig === "bpm")  score -= W_BPM  * 0.4
    else if (sig === "key")  score -= W_KEY  * 0.4
    else if (sig === "mood") score -= W_MOOD * 0.4
  }
  return Math.round(Math.max(0, Math.min(1, score)) * 100) / 100
}

function describeOverall(
  snap: AnalysisSnapshot,
  fit: number | null,
  hasProfile: boolean,
): string {
  const feel = describeFeel(snap)
  if (!hasProfile || fit == null) {
    return `Coherent identity — ${feel}. Not enough listening data yet to gauge how it lands against the current taste profile.`
  }
  if (fit >= 0.7)
    return `Strong match with the current taste profile. The ${feel} sits right in the catalogue's core territory.`
  if (fit >= 0.45)
    return `Solid match with the current taste profile, with a few distinctive choices. A clear identity track for the catalogue.`
  if (fit >= 0.2)
    return `Partial match — the ${feel} brings distinctive choices that diverge from the catalogue's typical territory.`
  return `Significant divergence from the current taste profile. Best treated as deliberate exploration or a new-direction release.`
}

function buildStrengths(snap: AnalysisSnapshot, ctx: AnalysisContext, hasProfile: boolean): string[] {
  if (!hasProfile) {
    // Identity-only callouts when the profile is too sparse to compare.
    const out: string[] = []
    const tempo = tempoFeel(snap.bpm, snap.tempo_label)
    const tonal = tonalFeel(snap.key, snap.scale, snap.mood)
    if (tempo) out.push(`Clear rhythmic identity — ${tempo}.`)
    if (tonal) out.push(`Coherent tonal/emotional pairing — ${tonal}.`)
    return out
  }
  return ctx.matched_signals
    .map((s) => STRENGTH_COPY[s])
    .filter((x): x is string => !!x)
}

/**
 * v1.1 — weakness generation goes beyond raw mismatches.
 *
 * Order matters: explicit divergences first (they are the strongest
 * evidence), then evidence-based heuristic warnings (narrow emotional
 * range, low-contrast cohesion). Each warning is gated on real signal
 * evidence — never produced "just because" the weaknesses array would
 * otherwise be empty.
 */
function buildWeaknesses(snap: AnalysisSnapshot, ctx: AnalysisContext, hasProfile: boolean): string[] {
  const out: string[] = []

  // 1. Explicit divergences — the strongest, most direct weaknesses.
  for (const sig of ctx.mismatched_signals) {
    const copy = WEAKNESS_COPY[sig]
    if (copy) out.push(copy)
  }

  if (!hasProfile) {
    // No taste-profile evidence — we still consider one identity-based
    // callout: a single-mood track has narrow emotional range regardless
    // of audience signals. Justified by the analysis itself.
    if (snap.mood && snap.mood.length === 1) {
      out.push(`Strong mood identity (${snap.mood[0]}), but limited emotional variety — could benefit from more contrast to broaden the arc.`)
    }
    return out
  }

  // 2. Heuristic: high-fit cohesion → may blend in. Triggers when the
  //    track matches the profile across multiple dimensions and offers
  //    no internal divergence — i.e., it reinforces rather than expands.
  if (ctx.matched_signals.length >= 2 && ctx.mismatched_signals.length === 0) {
    out.push("The match with the current taste profile is strong, but the track may lean a little too close to recently favored patterns — strong fit can come at the cost of standing out.")
  }

  // 3. Heuristic: narrow emotional range. A single-mood track with the
  //    profile's preferred mood will pass the match check but offer no
  //    emotional contrast. Phrased constructively.
  if (snap.mood && snap.mood.length === 1 && ctx.matched_signals.includes("mood")) {
    out.push(`The ${snap.mood[0]} identity is clear, though the emotional range is fairly narrow — adding contrast could give it more dimension.`)
  }

  return out
}

function buildImprovements(snap: AnalysisSnapshot, ctx: AnalysisContext, hasProfile: boolean): string[] {
  if (!hasProfile) {
    return [
      "Once listening data accumulates, this feedback layer will surface targeted suggestions tied to how the taste profile evolves.",
    ]
  }
  // Improvements key off the *mismatched* signals — that's where there's
  // headroom to shift the track toward (or deliberately away from) fit.
  const out = ctx.mismatched_signals
    .map((s) => IMPROVEMENT_COPY[s])
    .filter((x): x is string => !!x)

  // Already a near-perfect fit → suggest contrast as the creative move.
  if (out.length === 0 && ctx.matched_signals.length >= 3) {
    out.push("The track is already highly aligned with the current taste profile. To expand reach rather than reinforce, try a contrasting element — alternate key, mood shift, or tempo variation.")
  }

  // Narrow emotional range → improvement complements the weakness.
  if (snap.mood && snap.mood.length === 1) {
    out.push("Layering in a contrasting emotional moment — a brighter lift, a quieter break — would widen the dynamic arc.")
  }

  return out
}

function buildExplanations(ctx: AnalysisContext): string[] {
  return ctx.matched_signals
    .map((s) => EXPLANATION_COPY[s])
    .filter((x): x is string => !!x)
}

/**
 * True only when the profile contains facets that `buildAnalysisContext`
 * actually compares (BPM / key / mood / tags). `top_genres` alone is
 * NOT enough — the comparison code never matches genres, so admitting
 * a genre-only profile produces a fake "fit_score: 0 with no signals"
 * response that misrepresents the data.
 */
function profileHasComparableSignals(profile: TasteProfile): boolean {
  const s = profile.summary
  return !!(
    s.favorite_bpm_range ||
    s.favorite_keys?.length ||
    s.top_moods?.length ||
    s.top_tags?.length
  )
}

/**
 * Build creator feedback for a track against a reference taste profile.
 *
 * The reference taste profile is the one most relevant to the track:
 * the **owning agent's** taste profile when the track is agent-authored.
 * When the track has no owning agent (user-uploaded), we pass an empty
 * profile and produce identity-only feedback rather than scoring
 * against unrelated signals.
 *
 * Returns null when no analysis exists yet for the track — callers
 * should surface a clear "analysis pending" state instead of fabricating
 * feedback from nothing.
 */
export async function buildTrackFeedback(
  admin: SupabaseClient,
  trackId: string,
  ownerAgentId: string | null,
): Promise<TrackFeedback | null> {
  // Pull the newest analysis row directly so we can also surface its
  // age — `loadAnalysisSnapshot` discards the timestamp.
  const { data: anaRow } = await admin
    .from("track_analysis")
    .select("results, created_at")
    .eq("track_id", trackId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!anaRow) return null

  const snap = await loadAnalysisSnapshot(admin, trackId)
  if (!snap) return null

  const profile: TasteProfile | null = ownerAgentId
    ? await computeTasteProfile(ownerAgentId)
    : null
  const hasProfile = !!(profile && profileHasComparableSignals(profile))
  const ctx = buildAnalysisContext(snap, hasProfile ? profile!.summary : null)

  // Belt-and-braces gate: even if the profile claimed comparable facets,
  // if buildAnalysisContext couldn't actually match/diverge on any of
  // them (e.g. snapshot missing those fields), suppress the score
  // rather than reporting a misleading 0.
  const comparableSignalCount = ctx.matched_signals.length + ctx.mismatched_signals.length
  const fit: number | null =
    hasProfile && comparableSignalCount > 0 ? computeFitScore(ctx) : null
  const usableProfile = hasProfile && comparableSignalCount > 0

  return {
    track_id:    trackId,
    provider:    "soundmolt-feedback-v1",
    summary: {
      fit_score: fit,
      overall:   describeOverall(snap, fit, usableProfile),
    },
    strengths:    buildStrengths(snap, ctx, usableProfile),
    weaknesses:   buildWeaknesses(snap, ctx, usableProfile),
    improvements: buildImprovements(snap, ctx, usableProfile),
    signals: {
      bpm:         snap.bpm,
      key:         snap.key,
      scale:       snap.scale,
      mood:        snap.mood?.[0] ?? null,
      tempo_label: snap.tempo_label,
    },
    explanations:        buildExplanations(ctx),
    created_at:          new Date().toISOString(),
    analysis_created_at: (anaRow.created_at as string | null) ?? null,
  }
}
