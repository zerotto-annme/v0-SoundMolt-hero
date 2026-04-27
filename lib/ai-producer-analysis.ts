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

export type FixTask = {
  number:     number
  name:       string
  time_range: string
  problem:    string
  steps:      string[]
  result:     string
}

export type ExpectedResult = {
  before: string[]
  after:  string[]
}

export type ProducerReport = {
  version:         3
  generated_at:    string
  summary:         string
  overall_score:   number
  fix_tasks:       FixTask[]
  priority_fix:    string[]
  expected_result: ExpectedResult
  full_analysis:   string
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

// Stage 14 — fix_tasks: 5–8 actionable production tasks. Each task names
// the problem, lists DAW steps with concrete numbers, and states the
// audible result.
function normaliseFixTasks(v: unknown): FixTask[] {
  if (!Array.isArray(v)) return []
  const out: FixTask[] = []
  for (const item of v) {
    if (!item || typeof item !== "object") continue
    const o = item as Record<string, unknown>
    const name       = pickKey(o, "name", "title", "label")
    const time_range = pickKey(o, "time_range", "time", "timestamp", "range") || "whole-track"
    const problem    = pickKey(o, "problem", "issue", "diagnosis")
    const result     = pickKey(o, "result", "impact", "outcome", "benefit")
    const steps      = pickKeyArray(o, 12, "steps", "do", "actions", "instructions")
    if (!name && !problem && steps.length === 0) continue
    out.push({
      number: out.length + 1,
      name,
      time_range,
      problem,
      steps,
      result,
    })
    if (out.length >= 8) break
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

// Stage 14 — full_analysis is a SINGLE STRING (6–8 lines).
// Backward compat — fold a legacy structured Stage 13 object into a
// single string so old jsonb rows still render something useful.
function normaliseFullAnalysisString(v: unknown): string {
  if (typeof v === "string") return v.trim()
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>
    const parts: string[] = []
    for (const k of ["executive_summary", "detailed_analysis", "advanced_improvements", "summary", "analysis"]) {
      const x = o[k]
      if (typeof x === "string" && x.trim()) parts.push(x.trim())
    }
    return parts.join("\n\n")
  }
  return ""
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

  // Stage 14 — system prompt: verbatim from the new attached spec
  // (production-task FIX-the-track contract), followed by a short
  // technical ANCHORING trailer so the model grounds numbers in
  // Essentia data, adapts to the selected DAW, and emits VALID JSON
  // ONLY (no markdown, no fences).
  const systemPrompt =
`You are a professional music producer and mixing/mastering engineer.

Your task is NOT to analyze — your task is to FIX the track.

Output must be highly practical, actionable, and structured as production tasks.

DO NOT write long explanations.
DO NOT write generic feedback.
DO NOT repeat obvious things.
DO NOT use phrases like "this may help" or "consider".

You must give clear instructions that a producer can immediately apply inside a DAW (Cubase, Ableton, FL Studio).

---

OUTPUT STRUCTURE:

1. SUMMARY (max 3 sentences)

* What is wrong
* Why it kills the track
* What will fix it

---

2. FIX TASKS (MAIN SECTION — MOST IMPORTANT)

Create 5–8 TASKS максимум.

Each TASK must follow this format:

---

🔧 TASK [NUMBER] — [NAME] ([TIME RANGE or WHOLE TRACK])

Problem: [specific technical issue]

Do this:

* Step-by-step actions inside DAW
* Include exact values (Hz, dB, ms, ratios, LUFS)
* Include plugins/tools (EQ, Compressor, Limiter, Saturation, etc.)

Optional:

* MIDI changes (velocity, pattern, automation)
* Arrangement changes (add/remove elements)

Result: [what will change in sound]

---

STRICT RULES:

* Every task must be actionable
* Every task must include numbers/settings
* No vague language
* No theory explanations

---

3. PRIORITY FIX (TOP 3)

List only 3 most important fixes:

1. [action]
2. [action]
3. [action]

---

4. EXPECTED RESULT

Write BEFORE / AFTER:

Before:

* [problems]

After:

* [clear improvements]

---

5. FULL ANALYSIS (SHORT — max 6–8 lines)

Write like a professional producer conclusion.

Example style:
"Your track has a strong foundation, but the impact is limited by low-end masking and lack of loudness..."

No repetition from tasks.
No long explanations.

---

IMPORTANT:

* Always include time-based fixes (timestamps)
* Always include mixing + arrangement + mastering
* Always include at least:
  • 1 low-end fix
  • 1 energy/arrangement fix
  • 1 loudness/mastering fix

---

GOAL:

User must be able to:
open DAW → follow steps → improve track immediately

If instructions are not actionable → output is invalid.

---

ANCHORING (technical, do not violate):
- You are fixing a REAL track. The user prompt provides DERIVED AUDIO INSIGHTS, ARRANGEMENT LANDMARKS, and RAW ESSENTIA FEATURES. Every Hz / dB / LUFS / ms / mm:ss number you write MUST come from those blocks; do NOT invent values that are not present there.
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
      "name": string,
      "time_range": string,
      "problem": string,
      "steps": string[],
      "result": string
    }
  ],
  "priority_fix": [string, string, string],
  "expected_result": {
    "before": string[],
    "after":  string[]
  },
  "full_analysis": string
}

REMINDERS (enforced — re-read system prompt rules before writing):
- summary: max 3 sentences. Cover (1) what is wrong, (2) why it kills the track, (3) what will fix it.
- fix_tasks: 5–8 items. "number" is the 1-based index. "name" is a short label (e.g. "Tame low-end masking"). "time_range" is "mm:ss-mm:ss" (e.g. "0:45-1:00") OR the literal "whole-track". "problem" is one decisive sentence naming the technical issue. "steps" is a string[] of step-by-step DAW actions — each step MUST include exact values (Hz, dB, ms, ratios, LUFS) and prefer ${dawLb} stock plugin names where relevant. "result" is one decisive sentence describing what audibly changes.
- COVERAGE in fix_tasks: across the 5–8 items there MUST be at least one low-end fix, one energy/arrangement fix, and one loudness/mastering fix. Always include time-based fixes (concrete mm:ss anchors taken from the ARRANGEMENT LANDMARKS above).
- priority_fix: EXACTLY 3 short string actions, ordered by severity. These are the three things that actually break THIS track. They MUST mirror the most critical 3 fix_tasks (use the action wording, not just the name).
- expected_result.before: 3–6 short bullets describing concrete current problems (matched to fix_tasks).
- expected_result.after: 3–6 short bullets describing concrete improvements once the fix_tasks are applied.
- full_analysis: SINGLE STRING, 6–8 lines MAX, written like a professional producer conclusion. NO repetition from fix_tasks. NO long explanations. NO numbers. NO bullet symbols (write flowing prose with real \\n newlines).
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

  // Stage 14 — assemble the FIX-the-track report (v3). The contract is
  // strict: priority_fix MUST be exactly 3 strings and fix_tasks MUST be
  // 5–8 entries. The model is instructed to obey this, but we still
  // enforce both cardinalities here so a mis-behaving response cannot
  // produce a malformed jsonb row. Backward compat: legacy keys
  // priority_fixes (object[]) and full_analysis (object) are still
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
  // fix_tasks (their name, falling back to problem). Same dedupe rules.
  for (const t of fixTasksRaw) {
    if (priorityFixBuf.length >= 3) break
    pushPriority(t.name || t.problem || "", priorityFixBuf)
  }

  // 4) Still short → generic placeholders so the contract always holds.
  while (priorityFixBuf.length < 3) {
    priorityFixBuf.push(`Apply fix task ${priorityFixBuf.length + 1}`)
  }
  const priorityFix = priorityFixBuf.slice(0, 3)

  // 5) Pad fix_tasks to at least 5 (cap is already 8 inside the
  // normaliser). Seed each padded task from the matching priority_fix
  // entry so the padding is at least loosely tied to real findings.
  const fixTasks = fixTasksRaw.slice()
  while (fixTasks.length < 5) {
    const idx = fixTasks.length
    const seed = priorityFix[idx] ?? `Additional refinement pass #${idx + 1}`
    fixTasks.push({
      number:     idx + 1,
      name:       seed,
      time_range: "whole-track",
      problem:    seed,
      steps:      [],
      result:     "",
    })
  }
  // Renumber so `number` is always 1..N and contiguous.
  for (let i = 0; i < fixTasks.length; i++) fixTasks[i].number = i + 1

  const report: ProducerReport = {
    version:         3,
    generated_at:    new Date().toISOString(),
    summary:         typeof parsed.summary === "string" && parsed.summary.trim()
                       ? parsed.summary.trim()
                       : `Automated AI Producer fix plan for "${inputs.title ?? "Untitled"}".`,
    overall_score:   clamp01_100(parsed.overall_score, 70),
    fix_tasks:       fixTasks,
    priority_fix:    priorityFix,
    expected_result: normaliseExpectedResult(parsed.expected_result),
    full_analysis:   normaliseFullAnalysisString(parsed.full_analysis),
    audio_features:  features,
  }

  return { ok: true, report }
}
