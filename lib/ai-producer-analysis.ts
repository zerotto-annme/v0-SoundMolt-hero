/**
 * AI Producer real-analysis helpers (Stage 7).
 *
 * Two responsibilities:
 *   1. Produce raw audio features from a hosted audio URL via the
 *      existing Essentia microservice (no DB persistence — the
 *      AI Producer review module is private and stores its own copy
 *      inside ai_producer_reviews.report_json.audio_features).
 *   2. Turn those features + the user's submission inputs into a
 *      producer-style report_json using OpenAI gpt-4o-mini.
 *
 * Hard rules:
 *   • Helpers MUST always resolve — they never throw. The caller
 *     route uses the structured result to decide status=ready vs
 *     status=failed without crashing the request.
 *   • The report_json shape MUST stay compatible with the existing
 *     /ai-producer/reviews/[id] page (sections.{mix, mastering,
 *     arrangement, sound_design, commercial_potential}, recommendations,
 *     daw_instructions, full_analysis, summary, overall_score).
 *   • SSRF guard (assertSafeAudioUrl) is reused from lib/essentia so
 *     the allowlist stays single-source-of-truth.
 */
import OpenAI from "openai"
import type { SupabaseClient } from "@supabase/supabase-js"
import { ESSENTIA_API_URL, assertSafeAudioUrl } from "./essentia"

const ESSENTIA_TIMEOUT_MS = 120_000
const OPENAI_TIMEOUT_MS   = 90_000
const OPENAI_MODEL        = "gpt-4o-mini"

// ─── Types ─────────────────────────────────────────────────────────────

export type EssentiaFeatures = Record<string, unknown>

export type EssentiaExtractResult =
  | { ok: true;  features: EssentiaFeatures; cached: boolean }
  | { ok: false; error: string; stage: "ssrf" | "fetch" | "analyze" | "config" }

export type ProducerReportInputs = {
  title:           string | null
  genre:           string | null
  daw:             string | null
  feedback_focus:  string | null
  comment:         string | null
  /** Track length in seconds (nullable — uploaded files may be unknown). */
  track_duration:  number | null
}

export type FixTaskCategory =
  | "mix"
  | "mastering"
  | "arrangement"
  | "sound_design"
  | "commercial"

export type FixTask = {
  number:          number
  task_title:      string
  time_range:      string
  category:        FixTaskCategory
  problem:         string
  why_it_matters:  string
  daw_steps:       string[]
  settings:        string[]
  expected_result: string
}

export type ExpectedResult = {
  before: string[]
  after:  string[]
}

export type FullAnalysisStructured = {
  executive_summary:     string
  detailed_analysis:     string
  advanced_improvements: string
}

export type ProducerReport = {
  version:         4
  generated_at:    string
  summary:         string
  overall_score:   number
  fix_tasks:       FixTask[]
  priority_fix:    string[]
  expected_result: ExpectedResult
  full_analysis:   FullAnalysisStructured
  audio_features:  EssentiaFeatures
}

export type GenerateReportResult =
  | { ok: true;  report: ProducerReport }
  | { ok: false; error: string; stage: "config" | "openai" | "parse" }

// ─── Cached features lookup ────────────────────────────────────────────

/**
 * Fetch the most recent Essentia results row for an existing track, if
 * any. Returns null when no analysis has run yet — caller should then
 * trigger a fresh extract via extractEssentiaFeatures().
 */
export async function loadCachedTrackFeatures(
  admin: SupabaseClient,
  trackId: string,
): Promise<EssentiaFeatures | null> {
  try {
    const { data, error } = await admin
      .from("track_analysis")
      .select("results")
      .eq("track_id", trackId)
      .eq("provider", "essentia")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) {
      console.warn("[ai-producer] cached features lookup failed:", error.message)
      return null
    }
    if (!data || !data.results || typeof data.results !== "object") return null
    return data.results as EssentiaFeatures
  } catch (err) {
    console.warn("[ai-producer] cached features lookup threw:", err)
    return null
  }
}

// ─── Essentia feature extraction (no DB write) ─────────────────────────

/**
 * One-shot Essentia call: fetch the hosted audio bytes, POST them to
 * the Essentia microservice, return the raw JSON. We deliberately do
 * NOT persist this into track_analysis here — the AI Producer module
 * is owner-private and may be invoked on uploaded files that have no
 * corresponding tracks row. The route saves a snapshot inside
 * report_json.audio_features instead.
 */
export async function extractEssentiaFeatures(
  audioUrl: string,
): Promise<EssentiaExtractResult> {
  if (!audioUrl) {
    return { ok: false, error: "audio_url missing", stage: "config" }
  }

  const safe = assertSafeAudioUrl(audioUrl)
  if (!safe.ok) {
    return { ok: false, error: safe.reason, stage: "ssrf" }
  }

  // 1) Fetch the audio bytes.
  let audioBlob: Blob
  let filename = "audio"
  try {
    const ctl = new AbortController()
    const tm  = setTimeout(() => ctl.abort(), ESSENTIA_TIMEOUT_MS)
    const r   = await fetch(audioUrl, { signal: ctl.signal })
    clearTimeout(tm)
    if (!r.ok) {
      return { ok: false, error: `audio fetch ${r.status}`, stage: "fetch" }
    }
    audioBlob = await r.blob()
    try {
      const u    = new URL(audioUrl)
      const last = u.pathname.split("/").pop()
      if (last) filename = decodeURIComponent(last)
    } catch { /* keep default */ }
  } catch (err) {
    return {
      ok: false,
      error: `audio fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      stage: "fetch",
    }
  }

  // 2) POST to {ESSENTIA_API_URL}/analyze.
  try {
    const fd = new FormData()
    fd.append("file", audioBlob, filename)

    const ctl = new AbortController()
    const tm  = setTimeout(() => ctl.abort(), ESSENTIA_TIMEOUT_MS)
    const r   = await fetch(`${ESSENTIA_API_URL.replace(/\/$/, "")}/analyze`, {
      method: "POST",
      body:   fd,
      signal: ctl.signal,
    })
    clearTimeout(tm)
    if (!r.ok) {
      const text = await r.text().catch(() => "")
      return {
        ok: false,
        error: `essentia ${r.status}: ${text.slice(0, 200)}`,
        stage: "analyze",
      }
    }
    const json = await r.json().catch(() => null)
    if (!json || typeof json !== "object" || Array.isArray(json)) {
      return { ok: false, error: "essentia returned non-object JSON", stage: "analyze" }
    }
    return { ok: true, features: json as EssentiaFeatures, cached: false }
  } catch (err) {
    return {
      ok: false,
      error: `essentia call failed: ${err instanceof Error ? err.message : String(err)}`,
      stage: "analyze",
    }
  }
}

// ─── OpenAI report generation ──────────────────────────────────────────

const DAW_LABELS: Record<string, string> = {
  cubase:    "Cubase",
  fl_studio: "FL Studio",
  ableton:   "Ableton Live",
  logic:     "Logic Pro",
  other:     "a generic DAW",
}

function dawLabelFor(id: string | null): string {
  if (!id) return "a generic DAW"
  return DAW_LABELS[id] ?? id
}

function clamp01_100(n: unknown, fallback: number): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return fallback
  return Math.max(0, Math.min(100, Math.round(n)))
}

function toStringArray(v: unknown, max = 10): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const item of v) {
    if (typeof item === "string" && item.trim()) out.push(item.trim())
    if (out.length >= max) break
  }
  return out
}

function pickKey(o: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = o[k]
    if (typeof v === "string" && v.trim()) return v.trim()
  }
  return ""
}

function pickKeyArray(o: Record<string, unknown>, max: number, ...keys: string[]): string[] {
  for (const k of keys) {
    const v = o[k]
    if (Array.isArray(v)) return toStringArray(v, max)
  }
  return []
}

// Stage 14b — fix_tasks: 6–10 actionable production tasks with rich
// per-task metadata (category, why_it_matters, settings block). The
// model is instructed to honour this shape; the normaliser also accepts
// the older v3 keys (name/steps/result) so already-stored rows survive.
const FIX_TASK_CATEGORIES: ReadonlySet<FixTaskCategory> = new Set([
  "mix",
  "mastering",
  "arrangement",
  "sound_design",
  "commercial",
])

function pickCategory(o: Record<string, unknown>): FixTaskCategory | "" {
  const raw = pickKey(o, "category", "kind", "section", "area").toLowerCase().replace(/[\s-]+/g, "_")
  if (!raw) return ""
  if (FIX_TASK_CATEGORIES.has(raw as FixTaskCategory)) return raw as FixTaskCategory
  // Common alias mapping for tolerant parsing.
  const aliases: Record<string, FixTaskCategory> = {
    sounddesign:  "sound_design",
    sound:        "sound_design",
    design:       "sound_design",
    master:       "mastering",
    mixing:       "mix",
    arr:          "arrangement",
    structure:    "arrangement",
    energy:       "arrangement",
    market:       "commercial",
    release:      "commercial",
  }
  return aliases[raw] ?? ""
}

function defaultCategoryFor(idx: number): FixTaskCategory {
  // Stable rotation so padded tasks cover the spec's required surface
  // (mix + arrangement + mastering at minimum).
  const cycle: FixTaskCategory[] = ["mix", "arrangement", "mastering", "sound_design", "commercial"]
  return cycle[idx % cycle.length]!
}

function normaliseFixTasks(v: unknown): FixTask[] {
  if (!Array.isArray(v)) return []
  const out: FixTask[] = []
  for (const item of v) {
    if (!item || typeof item !== "object") continue
    const o = item as Record<string, unknown>
    const task_title      = pickKey(o, "task_title", "name", "title", "label")
    const time_range      = pickKey(o, "time_range", "time", "timestamp", "range")
    const category        = pickCategory(o) || defaultCategoryFor(out.length)
    const problem         = pickKey(o, "problem", "issue", "diagnosis")
    const why_it_matters  = pickKey(o, "why_it_matters", "why", "rationale", "impact_reason")
    const expected_result = pickKey(o, "expected_result", "result", "impact", "outcome", "benefit")
    const daw_steps       = pickKeyArray(o, 16, "daw_steps", "steps", "do", "actions", "instructions")
    const settings        = pickKeyArray(o, 16, "settings", "values", "params", "parameters")
    if (!task_title && !problem && daw_steps.length === 0) continue
    out.push({
      number:          out.length + 1,
      task_title,
      time_range,
      category,
      problem,
      why_it_matters,
      daw_steps,
      settings,
      expected_result,
    })
    if (out.length >= 10) break
  }
  return out
}

// Stage 14 — expected_result: { before:string[], after:string[] }.
function normaliseExpectedResult(v: unknown): ExpectedResult {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>
    return {
      before: toStringArray(o.before, 8),
      after:  toStringArray(o.after,  8),
    }
  }
  return { before: [], after: [] }
}

// Stage 14b — full_analysis is a STRUCTURED OBJECT with three sections
// (executive_summary / detailed_analysis / advanced_improvements). For
// already-stored rows where the value is a single string (v3) or other
// loose shapes, fold them into the executive_summary slot so something
// meaningful still renders.
function normaliseFullAnalysisStructured(v: unknown): FullAnalysisStructured {
  if (typeof v === "string") {
    return { executive_summary: v.trim(), detailed_analysis: "", advanced_improvements: "" }
  }
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>
    return {
      executive_summary:     pickKey(o, "executive_summary", "summary", "overview", "tl_dr"),
      detailed_analysis:     pickKey(o, "detailed_analysis", "analysis", "details", "body"),
      advanced_improvements: pickKey(o, "advanced_improvements", "advanced", "next_steps", "improvements"),
    }
  }
  return { executive_summary: "", detailed_analysis: "", advanced_improvements: "" }
}

// Stage 14b — synthesise a plausible time_range for a padded task when
// neither the model nor the user provided one. We anchor to four
// canonical sections (intro / buildup / drop / outro) and compute mm:ss
// boundaries from the known track duration when possible, otherwise we
// fall back to representative defaults that read sensibly in the UI.
function fmtMmSs(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, "0")}`
}

// Stage 14b — per-category engineering defaults. Used (a) to enrich a
// model task that omitted v4 fields and (b) to pad the report up to
// the 6-task floor. These are STANDARD engineering settings, not
// track-specific measurements, so injecting them never fabricates a
// track-specific number (LUFS / BPM / dominant freq still come from
// the model + Essentia data).
type CategoryDefaults = {
  why_it_matters:  string
  daw_steps:       (daw: string) => string[]
  settings:        string[]
  expected_result: string
  fallback_title:  string
}

const CATEGORY_DEFAULTS: Record<FixTaskCategory, CategoryDefaults> = {
  mix: {
    fallback_title: "Tighten low-end conflict",
    why_it_matters:
      "Kick and bass fighting in the sub-band masks both elements, crushes headroom, and makes the drop lose punch on club and laptop systems.",
    daw_steps: (daw) => [
      `Open the Mixer → select Bass channel → insert ${daw} EQ → enable HPF at 30 Hz`,
      `On the Kick channel insert ${daw} EQ → notch the bass fundamental around 60 Hz`,
      `Insert ${daw} Compressor on the Bass with sidechain input from the Kick`,
    ],
    settings: [
      "HPF: 30 Hz",
      "Notch: -3 dB at 60 Hz",
      "Sidechain GR: -4 dB",
      "Attack: 5 ms",
      "Release: 120 ms",
    ],
    expected_result:
      "The kick punches through cleanly while the bass sits underneath without smearing the sub.",
  },
  mastering: {
    fallback_title: "Master for streaming loudness",
    why_it_matters:
      "Low loudness and uncontrolled peaks let competing tracks drown this one out in playlists and reduce perceived punch on streaming.",
    daw_steps: (daw) => [
      `Insert ${daw} Limiter on the Master channel`,
      `Add a master EQ before the limiter with a gentle high-shelf to balance brightness`,
      `Set the output ceiling and target loudness for streaming delivery`,
    ],
    settings: [
      "LUFS target: -8",
      "Ceiling: -0.3 dB",
      "Lookahead: 5 ms",
      "High shelf: +1 dB at 10 kHz",
    ],
    expected_result:
      "The track competes in loudness with reference releases without audible pumping or distortion.",
  },
  arrangement: {
    fallback_title: "Sharpen the energy curve",
    why_it_matters:
      "A flat energy curve kills listener attention — without contrast between intro, buildup, drop and outro the track fails to land emotionally.",
    daw_steps: (daw) => [
      `Open the ${daw} Arrangement view → identify intro, buildup, drop and outro`,
      `Cut or mute extra elements during the intro to create contrast`,
      `Add a riser / sweep into the buildup and a drop hit at the section change`,
      `Automate filter cutoff and reverb send for transition energy`,
    ],
    settings: [
      "Intro length: 16 bars",
      "Buildup length: 8 bars",
      "Filter sweep: 200 Hz → 12 kHz over 8 bars",
      "Reverb send: -12 dB → 0 dB into drop",
    ],
    expected_result:
      "The arrangement breathes — listeners feel the buildup and the drop hits with clear contrast.",
  },
  sound_design: {
    fallback_title: "Carve a stronger signature sound",
    why_it_matters:
      "Stock or muddy synth sounds make the track feel generic and prevent it from carving its own sonic identity in the genre.",
    daw_steps: (daw) => [
      `Insert ${daw} Saturator on the lead channel for harmonic warmth`,
      `Add a stereo widener or chorus to the pad bus to broaden the image`,
      `Layer a sub-bass sine wave one octave below the main bass`,
    ],
    settings: [
      "Saturation drive: +6 dB",
      "Stereo width: 130%",
      "Sub layer level: -12 dB",
      "Chorus rate: 0.4 Hz",
    ],
    expected_result:
      "The lead has more character and the low-end gains a fuller, more cinematic body.",
  },
  commercial: {
    fallback_title: "Land the hook in the first 30 seconds",
    why_it_matters:
      "Without a clear commercial hook (memorable melody, vocal chop, signature lead) the track struggles in playlists and DJ sets where the first 30 seconds decide retention.",
    daw_steps: (daw) => [
      `Open ${daw} → place the strongest melodic moment within the first 30 seconds`,
      `Print a short vocal chop or signature lead on a dedicated bus`,
      `Add a short ear-catching transition right before the drop`,
    ],
    settings: [
      "Hook position: 0:15-0:30",
      "Vocal chop: -6 dB under the lead",
      "Transition impact: +3 dB punch",
    ],
    expected_result:
      "The first 30 seconds give the listener a clear hook and the drop carries an identifiable signature element.",
  },
}

function enrichFixTask(
  t: FixTask,
  idx: number,
  dawLb: string,
  durationSec: number | null,
): FixTask {
  const defs = CATEGORY_DEFAULTS[t.category]
  return {
    ...t,
    task_title:      t.task_title || defs.fallback_title,
    time_range:      t.time_range || estimateTimeRange(idx, durationSec),
    problem:         t.problem || defs.fallback_title,
    why_it_matters:  t.why_it_matters || defs.why_it_matters,
    daw_steps:       t.daw_steps.length > 0 ? t.daw_steps : defs.daw_steps(dawLb),
    settings:        t.settings.length  > 0 ? t.settings  : defs.settings,
    expected_result: t.expected_result || defs.expected_result,
  }
}

function estimateTimeRange(idx: number, durationSec: number | null): string {
  const labels = ["intro", "buildup", "drop", "outro"] as const
  const label = labels[idx % labels.length]!
  if (!durationSec || !Number.isFinite(durationSec) || durationSec <= 0) {
    switch (label) {
      case "intro":   return "0:00-0:30"
      case "buildup": return "0:30-1:00"
      case "drop":    return "1:00-2:00"
      case "outro":   return "last 0:30"
    }
  }
  const d = durationSec
  switch (label) {
    case "intro":   return `0:00-${fmtMmSs(Math.min(30, d * 0.15))}`
    case "buildup": return `${fmtMmSs(d * 0.15)}-${fmtMmSs(d * 0.4)}`
    case "drop":    return `${fmtMmSs(d * 0.4)}-${fmtMmSs(d * 0.8)}`
    case "outro":   return `${fmtMmSs(Math.max(0, d - 30))}-${fmtMmSs(d)}`
  }
}

// ─── Derived audio insights (Stage 8 quality upgrade) ─────────────────
//
// Essentia's raw output is deeply nested and field-naming varies a bit
// across versions ("rhythm.bpm" vs "bpm" etc). We probe the most common
// shapes and surface a flat, well-typed insight object that the LLM
// prompt can quote verbatim. Anything we cannot find is omitted (NOT
// stubbed with "unknown") so the LLM does not hallucinate around it.

export type DerivedAudioInsights = {
  bpm?:                number
  key?:                string
  scale?:              string
  energy?:             number
  loudness_lufs?:      number
  spectral_centroid?:  number
  danceability?:       number
  duration_seconds?:   number
}

function pickNumber(...candidates: unknown[]): number | undefined {
  for (const c of candidates) {
    if (typeof c === "number" && Number.isFinite(c)) return c
    if (typeof c === "string") {
      const n = Number(c)
      if (Number.isFinite(n)) return n
    }
  }
  return undefined
}

function pickString(...candidates: unknown[]): string | undefined {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim()
  }
  return undefined
}

function get(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== "object") return undefined
  const parts = path.split(".")
  let cur: any = obj
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined
    cur = cur[p]
  }
  return cur
}

export function deriveAudioInsights(
  features: EssentiaFeatures,
  fallbackDuration: number | null,
): DerivedAudioInsights {
  const f = features as Record<string, unknown>
  const insights: DerivedAudioInsights = {}

  const bpm = pickNumber(get(f, "rhythm.bpm"), get(f, "bpm"), get(f, "tempo"))
  if (bpm) insights.bpm = Math.round(bpm * 10) / 10

  const key   = pickString(get(f, "tonal.key_key"), get(f, "key.key"), get(f, "key"))
  const scale = pickString(get(f, "tonal.key_scale"), get(f, "key.scale"), get(f, "scale"))
  if (key)   insights.key   = key
  if (scale) insights.scale = scale

  const energy = pickNumber(
    get(f, "lowlevel.average_loudness"),
    get(f, "energy"),
    get(f, "lowlevel.dynamic_complexity"),
  )
  if (energy !== undefined) insights.energy = Math.round(energy * 1000) / 1000

  const lufs = pickNumber(
    get(f, "loudness.integrated_loudness"),
    get(f, "loudness_ebu128.integrated_loudness"),
    get(f, "loudness_lufs"),
    get(f, "lufs"),
  )
  if (lufs !== undefined) insights.loudness_lufs = Math.round(lufs * 10) / 10

  const sc = pickNumber(
    get(f, "lowlevel.spectral_centroid.mean"),
    get(f, "spectral_centroid"),
    get(f, "lowlevel.spectral_centroid"),
  )
  if (sc !== undefined) insights.spectral_centroid = Math.round(sc)

  const dance = pickNumber(
    get(f, "rhythm.danceability"),
    get(f, "danceability"),
    get(f, "highlevel.danceability.value"),
  )
  if (dance !== undefined) insights.danceability = Math.round(dance * 1000) / 1000

  const dur = pickNumber(
    get(f, "metadata.audio_properties.length"),
    get(f, "duration"),
    get(f, "length"),
    fallbackDuration,
  )
  if (dur !== undefined) insights.duration_seconds = Math.round(dur)

  return insights
}

function fmtTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00"
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, "0")}`
}

export type SimulatedSection = {
  name:  "intro" | "build" | "drop" | "outro"
  start: string  // mm:ss
  end:   string  // mm:ss
}

/**
 * When Essentia does not return real segmentation, generate plausible
 * arrangement landmarks from the duration so the LLM has anchor points
 * for timestamped recommendations (Stage 8 spec, step 4).
 */
export function simulateSections(durationSeconds: number | null | undefined): SimulatedSection[] {
  const d = typeof durationSeconds === "number" && durationSeconds > 0 ? durationSeconds : 0
  if (d <= 0) return []
  return [
    { name: "intro", start: fmtTime(0),         end: fmtTime(d * 0.20) },
    { name: "build", start: fmtTime(d * 0.20),  end: fmtTime(d * 0.50) },
    { name: "drop",  start: fmtTime(d * 0.50),  end: fmtTime(d * 0.80) },
    { name: "outro", start: fmtTime(d * 0.80),  end: fmtTime(d) },
  ]
}

export type ReportSection = {
  name:  string
  start: string  // mm:ss
  end:   string  // mm:ss
  source: "essentia" | "simulated"
}

/**
 * Try to extract real arrangement segmentation from Essentia output
 * (field naming varies by version: `segments`, `sections`,
 * `structure.segments`, `structure.sections`, …). Returns an empty
 * array when no real segmentation is present so the caller can fall
 * back to simulateSections().
 */
function extractRealSections(features: EssentiaFeatures): ReportSection[] {
  const f = features as Record<string, unknown>
  const candidates: unknown[] = [
    get(f, "segments"),
    get(f, "sections"),
    get(f, "structure.segments"),
    get(f, "structure.sections"),
    get(f, "highlevel.segments"),
    get(f, "rhythm.segments"),
  ]
  for (const cand of candidates) {
    if (!Array.isArray(cand) || cand.length === 0) continue
    const out: ReportSection[] = []
    for (const seg of cand) {
      if (!seg || typeof seg !== "object") continue
      const s = seg as Record<string, unknown>
      const start = pickNumber(s.start, s.from, s.begin, s.t0, s.startTime, s.start_time)
      const end   = pickNumber(s.end,   s.to,   s.finish, s.t1, s.endTime,   s.end_time)
      if (start === undefined || end === undefined || end <= start) continue
      const name = pickString(s.label, s.name, s.type, s.kind) ?? `segment ${out.length + 1}`
      out.push({ name, start: fmtTime(start), end: fmtTime(end), source: "essentia" })
      if (out.length >= 12) break
    }
    if (out.length > 0) return out
  }
  return []
}

/**
 * Resolve arrangement landmarks for the LLM prompt: prefer real
 * Essentia segmentation when present, otherwise fall back to
 * duration-based simulation.
 */
export function resolveSections(
  features: EssentiaFeatures,
  durationSeconds: number | null | undefined,
): ReportSection[] {
  const real = extractRealSections(features)
  if (real.length > 0) return real
  return simulateSections(durationSeconds).map(s => ({ ...s, source: "simulated" as const }))
}

/**
 * Build the LLM system + user prompt and ask gpt-4o-mini for a report.
 * The model is asked to return strict JSON; we then normalise the
 * shape before storing so the frontend never sees a malformed payload.
 */
export async function generateProducerReport(
  features: EssentiaFeatures,
  inputs:   ProducerReportInputs,
): Promise<GenerateReportResult> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return { ok: false, error: "OPENAI_API_KEY missing", stage: "config" }
  }

  const focus = (inputs.feedback_focus || "overall quality").toLowerCase()
  const dawId = inputs.daw ? inputs.daw.toLowerCase() : null
  const dawLb = dawLabelFor(dawId)

  // Step 1 — derived audio insights + resolved arrangement landmarks
  // (real Essentia segmentation when available, simulated otherwise).
  const insights = deriveAudioInsights(features, inputs.track_duration)
  const sections = resolveSections(features, insights.duration_seconds ?? inputs.track_duration ?? null)
  const sectionsAreReal = sections.length > 0 && sections[0]!.source === "essentia"

  // Stage 14b — system prompt: deep producer FIX plan with rich
  // per-task metadata (category, why_it_matters, settings) and a
  // structured 3-section full analysis. Followed by an ANCHORING
  // trailer that grounds numbers in Essentia data, pins the selected
  // DAW, and enforces JSON-only output.
  const systemPrompt =
`You are a professional music producer and mixing/mastering engineer.

Your task is NOT to analyze — your task is to FIX the track.

Output must be highly practical, actionable, and structured as production tasks.

DO NOT write long explanations.
DO NOT write generic feedback.
DO NOT repeat obvious things.
DO NOT use phrases like "this may help" or "consider".
DO NOT generate vague task names like "Improve energy dynamics".

You must give clear instructions that a producer can immediately apply inside a DAW (Cubase, Ableton, FL Studio, Logic).

---

OUTPUT STRUCTURE:

1. SUMMARY (max 3 sentences)
* What is wrong
* Why it kills the track
* What will fix it

2. FIX TASKS (MAIN SECTION — 6 to 10 items)

Each TASK MUST include ALL of these fields:

* task_title       — short concrete label (e.g. "Clean kick/bass conflict", NOT "Improve dynamics")
* time_range       — real timestamp "mm:ss-mm:ss" (e.g. "00:00-0:30") OR a section name
                     "intro 0:00-0:30" / "buildup 0:30-1:00" / "drop 1:00-2:00" / "outro last 0:30".
                     Use ARRANGEMENT LANDMARKS from the user prompt whenever possible.
                     "whole-track" is allowed but MUST NOT be used for more than half the tasks.
* category         — exactly one of: "mix" | "mastering" | "arrangement" | "sound_design" | "commercial"
* problem          — one decisive sentence naming the specific technical issue
* why_it_matters   — one sentence explaining the audible/commercial impact
* daw_steps        — string[] of step-by-step DAW actions. Each step MUST name the exact channel,
                     exact plugin, and exact action (e.g. "Open Mixer (F3) → select Bass channel →
                     insert ${dawLb} Frequency EQ → enable HPF at 80 Hz").
* settings         — string[] of "Param: value" lines with concrete numbers
                     (e.g. "HPF: 80 Hz", "Sidechain GR: -4 dB", "Attack: 10 ms",
                     "Release: 120 ms", "LUFS target: -8", "Ceiling: -0.3 dB").
                     Minimum 2 settings per task.
* expected_result  — one decisive sentence describing what audibly changes after the fix.

COVERAGE RULES (across the 6–10 tasks):
* MUST contain at least one task with category="mix" addressing the low-end (kick / bass / sub).
* MUST contain at least one task with category="arrangement" addressing energy curve / structure.
* MUST contain at least one task with category="mastering" addressing loudness / LUFS / ceiling.
* AT LEAST 3 tasks MUST use real timestamps (intro / buildup / drop / outro), not "whole-track".

3. PRIORITY FIX (TOP 3)

EXACTLY 3 short string actions, ordered by severity. Each entry MUST contain:
1) the exact action, 2) the exact setting/value, 3) the expected sound result.

Bad:  "Increase loudness with limiting"
Good: "Set master limiter to -8 LUFS / -0.3 dB ceiling so the track competes in techno playlists"

These three MUST mirror the 3 most critical fix_tasks.

4. EXPECTED RESULT

Write BEFORE / AFTER, 3–6 short bullets each — concrete current problems vs concrete improvements
once the fix_tasks are applied.

5. FULL ANALYSIS (STRUCTURED — three sections, NOT a single paragraph)

* executive_summary     — 2–3 sentences. The producer-level verdict on the track.
* detailed_analysis     — 4–8 sentences. Real diagnosis of mix, arrangement, sound design, and
                          mastering. Reference numbers from the DERIVED AUDIO INSIGHTS where useful.
                          NO bullet symbols — flowing prose with real \\n newlines between paragraphs.
* advanced_improvements — 3–6 sentences. Next-level upgrades a senior producer would suggest beyond
                          the immediate fix_tasks (sound design, arrangement, commercial positioning).

NO copy-paste repetition from the fix_tasks. NO restating settings. The full_analysis is the
producer-level commentary that complements the actionable tasks.

---

STRICT RULES:

* Every task must be actionable.
* Every task must include numbers / settings.
* No vague language.
* No theory explanations.

---

GOAL:

User must be able to: open DAW → follow steps → improve track immediately.

If instructions are not actionable → output is invalid.

---

ANCHORING (technical, do not violate):
- You are fixing a REAL track. The user prompt provides DERIVED AUDIO INSIGHTS, ARRANGEMENT LANDMARKS, and RAW ESSENTIA FEATURES.
- Track-specific MEASUREMENTS (this track's LUFS reading, BPM, key, duration, dominant frequency, segment timestamps) MUST come from those blocks. Do NOT invent track-specific measurements that are not present.
- Standard ENGINEERING SETTINGS that any producer would reach for (HPF cut-off ranges, EQ Q values, compressor attack/release in ms, sidechain GR depth, limiter ceiling, LUFS targets for a genre) ARE allowed even when not explicitly present in the data, as long as they are reasonable for the genre and the diagnosed problem. Concrete numbers in fix_tasks settings are REQUIRED.
- Adapt advice to the selected DAW (Cubase, FL Studio, Ableton, Logic) — use stock plugin names of ${dawLb} where relevant.
- Output VALID JSON ONLY — no prose, no markdown, no code fences, no extra keys. Match exactly the schema the user prompt specifies.`

  // Compact, human-readable insight block (only fields that were
  // actually derived — missing values are simply not listed so the
  // model does not invent them).
  const insightLines: string[] = []
  if (insights.bpm !== undefined)               insightLines.push(`- bpm: ${insights.bpm}`)
  if (insights.key)                             insightLines.push(`- key: ${insights.key}${insights.scale ? " " + insights.scale : ""}`)
  if (insights.energy !== undefined)            insightLines.push(`- energy: ${insights.energy}`)
  if (insights.loudness_lufs !== undefined)     insightLines.push(`- loudness_lufs: ${insights.loudness_lufs}`)
  if (insights.spectral_centroid !== undefined) insightLines.push(`- spectral_centroid: ${insights.spectral_centroid} Hz`)
  if (insights.danceability !== undefined)      insightLines.push(`- danceability: ${insights.danceability}`)
  if (insights.duration_seconds !== undefined)  insightLines.push(`- duration_seconds: ${insights.duration_seconds}`)
  const insightBlock = insightLines.length ? insightLines.join("\n") : "(no derived insights available)"

  const sectionsHeader = sectionsAreReal
    ? "ARRANGEMENT LANDMARKS (real Essentia segmentation — use these mm:ss anchors when giving timestamped advice):"
    : "ARRANGEMENT LANDMARKS (simulated from duration — use these mm:ss anchors when giving timestamped advice):"
  const sectionLines = sections.length
    ? sections.map(s => `- ${s.name}: ${s.start} – ${s.end}`).join("\n")
    : "(unknown — duration not available)"

  // Stringify the full feature blob defensively — some essentia
  // payloads contain BigInt / circular structures we cannot serialise.
  let rawFeaturesJson = ""
  try {
    rawFeaturesJson = JSON.stringify(features).slice(0, 8000)
  } catch {
    rawFeaturesJson = "{}"
  }

  // Stage 14 — user prompt: feeds CONTEXT, DERIVED AUDIO INSIGHTS,
  // ARRANGEMENT LANDMARKS, RAW ESSENTIA FEATURES, focus weighting, and
  // the strict FIX-the-track JSON schema (summary, fix_tasks[5–8],
  // priority_fix[3], expected_result{before,after}, full_analysis:string).
  const userPrompt =
`Generate a producer-style FIX plan for the user's track in strict JSON.

CONTEXT (user-supplied):
- title: ${inputs.title ?? "Untitled"}
- genre: ${inputs.genre ?? "unspecified"}
- daw: ${dawLb}
- feedback_focus: ${focus}
- track_duration_seconds: ${insights.duration_seconds ?? inputs.track_duration ?? "unknown"}
- user_comment: ${inputs.comment ?? "(none)"}

DERIVED AUDIO INSIGHTS (ground truth — quote these; do NOT invent numbers that are not here or in the raw features below):
${insightBlock}

${sectionsHeader}
${sectionLines}

RAW ESSENTIA FEATURES (for deeper inspection if you need them):
${rawFeaturesJson}

WEIGHTING — bias the FIX TASKS per feedback_focus="${focus}":
- mastering   → loudness, dynamics, limiting, tonal balance, LUFS targets
- mixing      → balance, EQ, compression, stereo image, headroom
- arrangement → structure, intro/build/drop/outro, energy curve
- vocals / bass / drums / melody → prioritise that element specifically
- overall     → balanced full FIX plan

Return ONLY this JSON shape — no extra keys, no markdown, no code fences:
{
  "summary": string,
  "overall_score": number,
  "fix_tasks": [
    {
      "number": number,
      "task_title": string,
      "time_range": string,
      "category": "mix" | "mastering" | "arrangement" | "sound_design" | "commercial",
      "problem": string,
      "why_it_matters": string,
      "daw_steps": string[],
      "settings": string[],
      "expected_result": string
    }
  ],
  "priority_fix": [string, string, string],
  "expected_result": {
    "before": string[],
    "after":  string[]
  },
  "full_analysis": {
    "executive_summary":     string,
    "detailed_analysis":     string,
    "advanced_improvements": string
  }
}

REMINDERS (enforced — re-read system prompt rules before writing):
- summary: max 3 sentences. Cover (1) what is wrong, (2) why it kills the track, (3) what will fix it.
- fix_tasks: 6–10 items. Every field above is REQUIRED. "task_title" is a concrete short label (e.g. "Clean kick/bass conflict"), NOT a generic verb (forbidden: "Improve …", "Enhance …"). "time_range" is "mm:ss-mm:ss" using the ARRANGEMENT LANDMARKS above (e.g. "0:45-1:00") OR a section name like "intro 0:00-0:30" / "buildup 0:30-1:00" / "drop 1:00-2:00" / "outro last 0:30". "whole-track" is allowed but at most for HALF the tasks — at least 3 tasks MUST anchor to a real time range. "category" is exactly one of: mix, mastering, arrangement, sound_design, commercial. "problem" is one decisive sentence naming the technical issue. "why_it_matters" is one sentence on the audible/commercial impact. "daw_steps" is a string[] of imperative DAW actions; each step names the exact channel + exact ${dawLb} plugin + exact action. "settings" is a string[] of "Param: value" lines with concrete numbers (Hz, dB, ms, ratios, LUFS) — minimum 2 per task. "expected_result" is one decisive sentence describing the audible change.
- COVERAGE in fix_tasks: at least one task with category="mix" addressing the low-end (kick / bass / sub), at least one with category="arrangement" addressing energy curve / structure, at least one with category="mastering" addressing loudness / LUFS / ceiling.
- priority_fix: EXACTLY 3 short string actions, ordered by severity. Each entry MUST contain (a) the exact action, (b) the exact setting/value, (c) the expected sound result. They MUST mirror the most critical 3 fix_tasks. Bad: "Increase loudness with limiting". Good: "Set master limiter to -8 LUFS / -0.3 dB ceiling so the track competes in techno playlists".
- expected_result.before: 3–6 short bullets describing concrete current problems (matched to fix_tasks).
- expected_result.after: 3–6 short bullets describing concrete improvements once the fix_tasks are applied.
- full_analysis: STRUCTURED OBJECT (NOT a single string).
  • executive_summary: 2–3 sentences — producer-level verdict on the track.
  • detailed_analysis: 4–8 sentences of flowing prose (use \\n newlines between paragraphs, NO bullet symbols). Reference numbers from DERIVED AUDIO INSIGHTS where useful. Diagnose mix, arrangement, sound design, mastering.
  • advanced_improvements: 3–6 sentences of next-level upgrades a senior producer would suggest BEYOND the fix_tasks (sound design, arrangement choices, commercial positioning).
  No copy-paste repetition from fix_tasks. No restating the settings.
- FORBIDDEN PHRASING in every string: "could", "might", "consider", "this may help". Replace with decisive active phrasing: "this is causing", "this reduces", "this kills the punch", "this must be fixed".
- NO GUESSING — if a piece of audio data is not present in the DERIVED AUDIO INSIGHTS or RAW ESSENTIA FEATURES blocks above, do NOT invent a number. Skip the observation rather than fabricate.
- If instructions are not actionable, the output is invalid.`

  let raw: string
  try {
    const client = new OpenAI({ apiKey, timeout: OPENAI_TIMEOUT_MS })
    const resp = await client.chat.completions.create({
      model:           OPENAI_MODEL,
      temperature:     0.7,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt   },
      ],
    })
    const choice = resp.choices?.[0]?.message?.content
    if (!choice || typeof choice !== "string") {
      return { ok: false, error: "openai returned empty content", stage: "openai" }
    }
    raw = choice
  } catch (err) {
    return {
      ok: false,
      error: `openai call failed: ${err instanceof Error ? err.message : String(err)}`,
      stage: "openai",
    }
  }

  let parsed: Record<string, unknown>
  try {
    const json = JSON.parse(raw)
    if (!json || typeof json !== "object" || Array.isArray(json)) {
      return { ok: false, error: "openai returned non-object JSON", stage: "parse" }
    }
    parsed = json as Record<string, unknown>
  } catch (err) {
    return {
      ok: false,
      error: `openai response not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      stage: "parse",
    }
  }

  // Stage 14b — assemble the FIX-the-track report (v4). The contract is
  // strict: priority_fix MUST be exactly 3 strings and fix_tasks MUST be
  // 6–10 entries with rich per-task metadata (category, why_it_matters,
  // settings). The model is instructed to obey this, but we still
  // enforce both cardinalities here so a mis-behaving response cannot
  // produce a malformed jsonb row. Backward compat: legacy v2 keys
  // (priority_fixes:object[], full_analysis:object) and v3 keys
  // (name/steps/result on fix_tasks, full_analysis:string) are all
  // accepted from already-stored rows and from older model output.
  const fixTasksRaw = normaliseFixTasks(parsed.fix_tasks)

  // Helper: append a candidate string into priorityFix, trimmed and
  // case-insensitively deduplicated, until the cap of 3 is reached.
  const pushPriority = (raw: unknown, bucket: string[]): void => {
    if (typeof raw !== "string") return
    const s = raw.trim()
    if (!s || bucket.length >= 3) return
    const key = s.toLowerCase()
    if (bucket.some((existing) => existing.toLowerCase() === key)) return
    bucket.push(s)
  }

  // 1) priority_fix from the model (deduplicated as we go).
  const priorityFixBuf: string[] = []
  if (Array.isArray(parsed.priority_fix)) {
    for (const item of parsed.priority_fix) {
      pushPriority(item, priorityFixBuf)
      if (priorityFixBuf.length >= 3) break
    }
  }

  // 2) BC fallback: legacy v2 priority_fixes (object[] with action/title).
  // Runs whenever we still have < 3 entries so we can fill on top of a
  // partial model response, not only when the model returned nothing.
  if (priorityFixBuf.length < 3 && Array.isArray(parsed.priority_fixes)) {
    for (const item of parsed.priority_fixes as unknown[]) {
      if (item && typeof item === "object") {
        const o = item as Record<string, unknown>
        const s = pickKey(o, "action", "fix", "text", "title")
        if (s) pushPriority(s, priorityFixBuf)
      } else {
        pushPriority(item, priorityFixBuf)
      }
      if (priorityFixBuf.length >= 3) break
    }
  }

  // 3) Pad priority_fix to exactly 3 by mirroring the most critical
  // fix_tasks (their title, falling back to problem). Same dedupe rules.
  for (const t of fixTasksRaw) {
    if (priorityFixBuf.length >= 3) break
    pushPriority(t.task_title || t.problem || "", priorityFixBuf)
  }

  // 4) Still short → generic placeholders so the contract always holds.
  while (priorityFixBuf.length < 3) {
    priorityFixBuf.push(`Apply fix task ${priorityFixBuf.length + 1}`)
  }
  const priorityFix = priorityFixBuf.slice(0, 3)

  // 5) Pad fix_tasks to at least 6 (cap is 10 inside the normaliser),
  // PRIORITISING any of the required categories (mix / arrangement /
  // mastering) the model didn't already cover. After padding, if a
  // required category is still missing we swap the LAST non-required
  // task's category instead of growing the list past 6.
  const REQUIRED_CATEGORIES: FixTaskCategory[] = ["mix", "arrangement", "mastering"]
  const fixTasks = fixTasksRaw.slice()
  const durationForPad = insights.duration_seconds ?? inputs.track_duration ?? null

  let presentCats = new Set<FixTaskCategory>(fixTasks.map((t) => t.category))
  let missingRequired = REQUIRED_CATEGORIES.filter((c) => !presentCats.has(c))
  while (fixTasks.length < 6) {
    const idx = fixTasks.length
    const cat = missingRequired.shift() ?? defaultCategoryFor(idx)
    fixTasks.push({
      number:          idx + 1,
      task_title:      "",
      time_range:      "",
      category:        cat,
      problem:         "",
      why_it_matters:  "",
      daw_steps:       [],
      settings:        [],
      expected_result: "",
    })
    presentCats.add(cat)
  }

  // Coverage repair: model returned >=6 tasks but missed a required
  // category. Resolve in three escalating steps so coverage is GUARANTEED
  // regardless of model output shape:
  //   (a) swap the highest-index NON-required task's category;
  //   (b) if all tasks are already required, swap the highest-index
  //       task from the most-overrepresented required category;
  //   (c) if list length < 10, append a fresh task with the missing
  //       category. Cleared v4 fields are re-derived by enrichFixTask.
  const blankSlot = (cat: FixTaskCategory, idx: number): FixTask => ({
    number:          idx + 1,
    task_title:      "",
    time_range:      "",
    category:        cat,
    problem:         "",
    why_it_matters:  "",
    daw_steps:       [],
    settings:        [],
    expected_result: "",
  })

  presentCats = new Set<FixTaskCategory>(fixTasks.map((t) => t.category))
  for (const c of REQUIRED_CATEGORIES) {
    if (presentCats.has(c)) continue
    let swapped = false
    // (a) swap a non-required task
    for (let i = fixTasks.length - 1; i >= 0 && !swapped; i--) {
      const cur = fixTasks[i]!
      if (REQUIRED_CATEGORIES.includes(cur.category)) continue
      fixTasks[i] = { ...blankSlot(c, i), problem: cur.problem }
      swapped = true
    }
    // (b) all tasks already required → take from the most over-represented
    if (!swapped) {
      const counts: Partial<Record<FixTaskCategory, number>> = {}
      for (const t of fixTasks) counts[t.category] = (counts[t.category] ?? 0) + 1
      let donor: FixTaskCategory | null = null
      let donorCount = 1
      for (const k of Object.keys(counts) as FixTaskCategory[]) {
        const n = counts[k] ?? 0
        if (n > donorCount) { donor = k; donorCount = n }
      }
      if (donor) {
        for (let i = fixTasks.length - 1; i >= 0 && !swapped; i--) {
          if (fixTasks[i]!.category !== donor) continue
          const cur = fixTasks[i]!
          fixTasks[i] = { ...blankSlot(c, i), problem: cur.problem }
          swapped = true
        }
      }
    }
    // (c) still no slot (e.g. exactly one task per required cat) → append
    if (!swapped && fixTasks.length < 10) {
      fixTasks.push(blankSlot(c, fixTasks.length))
      swapped = true
    }
    if (swapped) presentCats.add(c)
  }

  // Enrichment: fill in any empty v4 field on every task with the
  // category-default engineering preset. This guarantees that even
  // shallow model output (or padded slots) renders deeply in the UI
  // with concrete steps, settings and an expected sonic outcome.
  for (let i = 0; i < fixTasks.length; i++) {
    fixTasks[i] = enrichFixTask(fixTasks[i]!, i, dawLb, durationForPad)
  }

  // Timestamp repair: the spec requires at least 3 tasks anchored to a
  // real time range. If too many came back as "whole-track" / empty,
  // promote the earliest such tasks to estimated section ranges.
  const isRealTimeRange = (s: string): boolean =>
    !!s && !/^whole[-\s]?track$/i.test(s.trim())
  const realCount = (): number => fixTasks.filter((t) => isRealTimeRange(t.time_range)).length
  for (let i = 0; i < fixTasks.length && realCount() < 3; i++) {
    if (!isRealTimeRange(fixTasks[i]!.time_range)) {
      fixTasks[i] = { ...fixTasks[i]!, time_range: estimateTimeRange(i, durationForPad) }
    }
  }

  // Renumber so `number` is always 1..N and contiguous.
  for (let i = 0; i < fixTasks.length; i++) fixTasks[i]!.number = i + 1

  // 6) Backward compat for full_analysis: prefer the v4 structured
  // object; gracefully fold a v3 string or v2 legacy object into the
  // new shape without losing content.
  const fullAnalysis = normaliseFullAnalysisStructured(parsed.full_analysis)

  const report: ProducerReport = {
    version:         4,
    generated_at:    new Date().toISOString(),
    summary:         typeof parsed.summary === "string" && parsed.summary.trim()
                       ? parsed.summary.trim()
                       : `Automated AI Producer fix plan for "${inputs.title ?? "Untitled"}".`,
    overall_score:   clamp01_100(parsed.overall_score, 70),
    fix_tasks:       fixTasks,
    priority_fix:    priorityFix,
    expected_result: normaliseExpectedResult(parsed.expected_result),
    full_analysis:   fullAnalysis,
    audio_features:  features,
  }

  return { ok: true, report }
}
