/**
 * Creator Feedback Layer v1
 *
 * Turns SoundMolt's existing music intelligence (Essentia analysis +
 * taste-profile signals) into creator-facing feedback: strengths,
 * weaknesses, improvements and a fit score.
 *
 * Design notes:
 *   • Compute-on-read. No new tables, no snapshot persistence. Both
 *     GET /api/tracks/:id/feedback and POST .../feedback/rebuild call
 *     `buildTrackFeedback` directly. "Rebuild" simply re-runs the
 *     computation against the latest analysis + taste profile.
 *   • Reuses `loadAnalysisSnapshot` (newest analysis row) and
 *     `buildAnalysisContext` (matched/mismatched signal extractor) so
 *     scoring stays consistent with /next-action and /act outputs.
 *   • Phrasing is creator-facing — never leaks raw weights or factor
 *     names. Numeric fit_score is the only number surfaced.
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
     * Owner-profile fit, 0..1 (two decimals). This is alignment with the
     * owning agent's *own* taste signals (BPM/key/mood/tags), not a
     * generalised audience model. Emitted as null in cold-start cases
     * where there are no comparable signals to score against.
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
// Phrasing helpers — keep all creator-facing strings in one place so
// they read consistently and are easy to audit/translate later.
// ─────────────────────────────────────────────────────────────────────
const STRENGTH_COPY: Record<string, string> = {
  bpm:   "Sits inside the BPM range that performs best for your audience.",
  key:   "Tonally aligned with the keys your listeners gravitate to.",
  mood:  "Mood matches the emotional palette your audience already responds to.",
  tags:  "Style tags overlap with the descriptors your listeners follow.",
}

const WEAKNESS_COPY: Record<string, string> = {
  bpm:   "Tempo sits outside the band where your tracks usually land.",
  key:   "Key choice is unusual for your catalogue — may feel disconnected.",
  mood:  "Emotional tone diverges from the mood signature your audience expects.",
}

const IMPROVEMENT_COPY: Record<string, string> = {
  bpm:   "If you want broader reach, nudge the tempo closer to your typical range — or lean further out for deliberate contrast.",
  key:   "Consider an alternate key (or a brief modulation) to tie this track back to the rest of your work.",
  mood:  "Adding a contrasting section — brighter break, darker bridge — would broaden the emotional arc.",
}

const EXPLANATION_COPY: Record<string, string> = {
  bpm:   "Matches favorite BPM range.",
  key:   "Matches favorite key.",
  mood:  "Matches preferred mood.",
  tags:  "Matches preferred style tags.",
}

// ─────────────────────────────────────────────────────────────────────
// Fit score: light, transparent weighting over the same signals
// recommendations use. Capped at 1.0; floors at 0.0. We deliberately
// don't expose individual weights to creators.
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
  // Mismatches pull the score down, but gently — a single divergence
  // shouldn't tank an otherwise strong track.
  for (const sig of ctx.mismatched_signals) {
    if      (sig === "bpm")  score -= W_BPM  * 0.4
    else if (sig === "key")  score -= W_KEY  * 0.4
    else if (sig === "mood") score -= W_MOOD * 0.4
  }
  return Math.round(Math.max(0, Math.min(1, score)) * 100) / 100
}

function describeOverall(
  snap: AnalysisSnapshot,
  ctx: AnalysisContext,
  fit: number | null,
  hasProfile: boolean,
): string {
  if (!hasProfile || fit == null) {
    // Cold start: no taste profile to compare against — describe the
    // music identity instead of pretending to score against nothing.
    const bits: string[] = []
    if (snap.bpm != null)    bits.push(`${Math.round(snap.bpm)} BPM`)
    if (snap.key)            bits.push(`${snap.key}${snap.scale ? " " + snap.scale : ""}`)
    if (snap.mood?.length)   bits.push(snap.mood[0])
    if (snap.tempo_label)    bits.push(snap.tempo_label)
    return bits.length
      ? `Coherent identity: ${bits.join(", ")}. Not enough comparable listening signals yet to score owner-profile fit.`
      : "Track has been analysed — listening data will sharpen feedback as it grows."
  }
  if (fit >= 0.7)  return "Strong alignment with the owner's listening profile — this track lives in their core taste."
  if (fit >= 0.45) return "Solid fit with a few divergences from the owner's profile. A clear identity track for the catalogue."
  if (fit >= 0.2)  return "Partial fit — distinctive choices that diverge from the owner's typical profile."
  return "Significant divergence from the owner's listening profile. Best for deliberate exploration or new-direction releases."
}

function buildStrengths(ctx: AnalysisContext, hasProfile: boolean): string[] {
  if (!hasProfile) {
    // Without taste signals we can still call out musical clarity.
    const out: string[] = []
    if (ctx.snapshot.bpm != null && ctx.snapshot.tempo_label) {
      out.push(`Clear rhythmic identity (${Math.round(ctx.snapshot.bpm)} BPM, ${ctx.snapshot.tempo_label}).`)
    }
    if (ctx.snapshot.key && ctx.snapshot.mood?.length) {
      out.push(`Coherent tonal/emotional pairing — ${ctx.snapshot.key}${ctx.snapshot.scale ? " " + ctx.snapshot.scale : ""} with a ${ctx.snapshot.mood[0]} feel.`)
    }
    return out
  }
  return ctx.matched_signals
    .map((s) => STRENGTH_COPY[s])
    .filter((x): x is string => !!x)
}

function buildWeaknesses(ctx: AnalysisContext, hasProfile: boolean): string[] {
  if (!hasProfile) return []
  return ctx.mismatched_signals
    .map((s) => WEAKNESS_COPY[s])
    .filter((x): x is string => !!x)
}

function buildImprovements(ctx: AnalysisContext, hasProfile: boolean): string[] {
  if (!hasProfile) {
    return [
      "Once listening data accumulates, this feedback layer will surface targeted suggestions tied to how your audience responds.",
    ]
  }
  // Improvements key off the *mismatched* signals — that's where there's
  // headroom to shift the track toward (or deliberately away from) audience fit.
  const out = ctx.mismatched_signals
    .map((s) => IMPROVEMENT_COPY[s])
    .filter((x): x is string => !!x)
  // If the track is already a near-perfect fit, suggest contrast as the
  // creative move — guards against the "everything matches → no advice" case.
  if (out.length === 0 && ctx.matched_signals.length >= 3) {
    out.push("Track is highly aligned with your existing palette. If you want this release to *expand* your reach rather than reinforce, consider a contrasting element — alternate key, mood shift, or tempo variation.")
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
 * The reference taste profile is the one most relevant to the track's
 * audience signal. In v1 we use the **owning agent's** taste profile
 * when the track is agent-authored (their listening signals best
 * approximate audience response). When the track has no owning agent
 * (user-uploaded), we pass an empty profile and produce identity-only
 * feedback rather than scoring against unrelated signals.
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
      overall:   describeOverall(snap, ctx, fit, usableProfile),
    },
    strengths:    buildStrengths(ctx, usableProfile),
    weaknesses:   buildWeaknesses(ctx, usableProfile),
    improvements: buildImprovements(ctx, usableProfile),
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
