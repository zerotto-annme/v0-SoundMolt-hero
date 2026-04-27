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

type SectionShape = {
  score: number
  text:  string
  notes: string[]
}

export type ProducerReport = {
  version:       1
  generated_at:  string
  summary:       string
  overall_score: number
  sections: {
    mix:                 SectionShape
    mastering:           SectionShape
    arrangement:         SectionShape
    sound_design:        SectionShape
    commercial_potential: SectionShape
  }
  recommendations: Array<
    string | { timestamp?: string | null; target?: string | null; text?: string | null }
  >
  daw_instructions: string[]
  full_analysis:    string
  references:       string[]
  audio_features:   EssentiaFeatures
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

function normaliseSection(raw: unknown, fallbackText: string): SectionShape {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  return {
    score: clamp01_100(r.score, 70),
    text:  typeof r.text === "string" && r.text.trim() ? r.text.trim() : fallbackText,
    notes: toStringArray(r.notes, 8),
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

function normaliseRecommendations(
  raw: unknown,
): ProducerReport["recommendations"] {
  if (!Array.isArray(raw)) return []
  const out: ProducerReport["recommendations"] = []
  for (const item of raw) {
    if (typeof item === "string" && item.trim()) {
      out.push(item.trim())
    } else if (item && typeof item === "object") {
      const r = item as Record<string, unknown>
      const ts     = typeof r.timestamp === "string" ? r.timestamp : null
      const target = typeof r.target    === "string" ? r.target    : null
      const text   = typeof r.text      === "string" ? r.text      : null
      if (ts || target || text) out.push({ timestamp: ts, target, text })
    }
    if (out.length >= 20) break
  }
  return out
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

  // Step 2 — system prompt (verbatim from Stage 8 spec).
  // Step 6 (tone) and the JSON-only output rule are appended as a
  // short trailer because the spec's Step 7 forbids breaking the
  // existing JSON contract; the trailer cannot be expressed inside
  // the verbatim block but is required by other steps in the spec.
  const systemPrompt =
    "You are a professional music producer and mixing/mastering engineer with 15+ years of experience.\n\n" +
    "You are analyzing a REAL track using audio features (BPM, key, energy, spectral balance, etc).\n\n" +
    "Your goal is NOT to give generic advice.\n\n" +
    "Your goal is to:\n" +
    "1. Identify specific weaknesses in THIS track\n" +
    "2. Explain WHY they happen (technical reasoning)\n" +
    "3. Give precise, actionable fixes\n" +
    "4. Adapt advice to the selected DAW (Cubase, FL Studio, Ableton, Logic)\n\n" +
    "Avoid generic phrases like:\n" +
    "- 'could be improved'\n" +
    "- 'consider enhancing'\n\n" +
    "Instead:\n" +
    "- Be direct\n" +
    "- Be specific\n" +
    "- Use numbers when possible (Hz, dB, LUFS, ms)\n\n" +
    "Always assume the user wants to APPLY changes immediately.\n\n" +
    "---\n" +
    "STRONG OPINIONS (Stage 9 step 1): You MUST identify the TOP 3 biggest problems in THIS track. " +
    "Do not describe everything — prioritize what actually breaks the track. Lead the recommendations with these three.\n\n" +
    "WHY IT FAILS (Stage 9 step 2 + step 3 + Stage 10 step 5): For every section, EVERY note MUST follow this exact format:\n" +
    "\"Problem: <what is wrong>. Why: <technical cause>. Impact: <what the listener feels>. Fix: <concrete action with Hz / mm:ss / dB / LUFS>. Result: <what will improve audibly>.\"\n" +
    "Example: \"Problem: low-end is muddy. Why: the kick (60 Hz) overlaps the bass (100 Hz) causing masking. Impact: the drop feels weak and lacks punch. Fix: high-pass the bass at 80 Hz and side-chain it -4 dB to the kick (10 ms attack, 120 ms release). Result: the low-end becomes cleaner and the kick gains punch.\"\n" +
    "Each section MUST contain at least 3 such notes; both Fix and Result are mandatory; Fix MUST reference Hz, time, or dB/LUFS.\n\n" +
    "DAW MODE (Stage 9 step 4 + Stage 10 step 4 + Stage 11 step 4) — VISUAL multi-line format, NO \" | \" separators. Every entry in daw_instructions MUST be a SINGLE STRING containing ACTUAL newline characters (\\n), structured EXACTLY like this:\n" +
    "[CHANNEL: <element>]\\nStep 1 — Open <Mixer / Track>\\nStep 2 — Select <channel>\\nStep 3 — Insert <plugin>\\nStep 4 — Set:\\n  <param>: <value>\\n  <param>: <value>\\n  <param>: <value>\n" +
    "Concrete example (the literal characters \"\\n\" represent newline characters in the JSON string):\n" +
    "\"[CHANNEL: Kick]\\nStep 1 — Open Mixer (F3)\\nStep 2 — Select Kick channel\\nStep 3 — Insert Compressor\\nStep 4 — Set:\\n  Attack: 10 ms\\n  Release: 120 ms\\n  Ratio: 4:1\"\n" +
    "Step 4 MUST be on its own line ending with a colon, with each (param, value) pair indented on its own line. No \" | \", no inlining.\n\n" +
    "ENERGY FLOW (Stage 9 step 5): analyze the energy curve of the track. " +
    "If the drop lacks impact, explain WHY (no buildup, too constant energy, weak transient, frequency masking, etc.). " +
    "Put this analysis inside sections.arrangement and reference it in full_analysis.\n\n" +
    "FORBIDDEN LANGUAGE (Stage 9 step 6 + Stage 10 step 3): the words \"could\", \"might\", and \"consider\" are BANNED in ALL output strings (summary, sections.*.text, sections.*.notes, recommendations, daw_instructions, full_analysis). " +
    "Use decisive, active diagnoses: \"this is causing\", \"this reduces\", \"this weakens the track\", \"this masks\", \"this kills the punch\", \"this must be fixed\".\n\n" +
    "MAIN DIAGNOSIS (Stage 10 step 1 + Stage 11 step 1) — VERDICT TONE. The summary field MUST start with the literal token \"MAIN ISSUE: \" followed by EXACTLY 2 short sentences:\n" +
    "  Sentence 1: a verdict that names the single core problem and the audible consequence (example: \"Your track loses impact because the low-end collapses into mud.\").\n" +
    "  Sentence 2: WHY the track feels weak — the technical cause behind that verdict (example: \"The kick and bass are masking each other, killing punch and clarity.\").\n" +
    "ONLY ONE main issue is allowed. NO third sentence. NO IF-YOU-FIX list inside summary anymore (the FIX-3 list now lives at the TOP of full_analysis — see FULL_ANALYSIS STRUCTURE below).\n\n" +
    "FULL_ANALYSIS STRUCTURE (Stage 11 step 2 + step 3) — full_analysis MUST start with two visual blocks, in this exact order, BEFORE the long-form narrative.\n" +
    "Block A (literal newlines between every line):\n" +
    "=== FIX THESE 3 THINGS FIRST ===\\n1. <biggest concrete fix with Hz / dB / ms / LUFS>\\n2. <second concrete fix>\\n3. <third concrete fix>\n" +
    "Then a blank line, then Block B (literal newlines):\n" +
    "=== EXPECTED BEFORE / AFTER ===\\nBefore:\\n- <symptom 1>\\n- <symptom 2>\\nAfter:\\n- <improvement 1>\\n- <improvement 2>\\n- <improvement 3>\n" +
    "Then a blank line, then the 300–600 word narrative (Stage 8) with explicit energy-flow analysis (Stage 9). Use real newline characters (\\n) in the JSON string.\n\n" +
    "WHY THIS MATTERS (Stage 11 step 5) — every section.text (mix, mastering, arrangement, sound_design, commercial_potential) MUST end with two newlines followed by the literal line \"Why this matters: <one short sentence about how this section's issues affect what the listener feels>\". Single line, no extra paragraphs.\n\n" +
    "ANTI-REPETITION (Stage 11 step 6) — each concrete diagnosed problem may appear in ONLY ONE place across the whole report. Pick the most relevant home (summary OR mix OR mastering OR arrangement OR sound_design OR commercial_potential) and keep the strongest, most actionable wording there. Do NOT restate the same issue verbatim in summary, mix, AND mastering — pick the strongest version, mention the issue only once, and let other sections reference different aspects.\n\n" +
    "NO GUESSING (Stage 10 step 6): if a piece of audio data is not present in the DERIVED AUDIO INSIGHTS or RAW ESSENTIA FEATURES blocks, do NOT invent it. " +
    "Skip the observation entirely rather than fabricate a number. Numeric anchors must come from the actual features, not guessed.\n\n" +
    "Tone (Stage 8 step 6 + Stage 10 step 3): confident, decisive, slightly critical, like a real producer talking to a peer — NOT a polite assistant. " +
    "Instead of 'this could be improved' say 'the low-end is muddy and masking clarity in the mix'.\n" +
    "Output (Stage 8 step 7): respond with VALID JSON ONLY matching the schema the user prompt specifies — no prose, no markdown, no code fences."

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

  // Steps 3, 4, 5 — force specificity, expose pseudo-sections, demand
  // DAW-specific concrete instructions.
  const userPrompt =
`Generate a producer-style review for the user's track in strict JSON.

CONTEXT (user-supplied):
- title: ${inputs.title ?? "Untitled"}
- genre: ${inputs.genre ?? "unspecified"}
- daw: ${dawLb}
- feedback_focus: ${focus}
- track_duration_seconds: ${insights.duration_seconds ?? inputs.track_duration ?? "unknown"}
- user_comment: ${inputs.comment ?? "(none)"}

DERIVED AUDIO INSIGHTS (ground truth — quote these in your analysis):
${insightBlock}

${sectionsHeader}
${sectionLines}

RAW ESSENTIA FEATURES (for deeper inspection if you need them):
${rawFeaturesJson}

IMPORTANT:
Do NOT give generic mixing advice.

Every recommendation must:
- reference a frequency (Hz)
- or timing (seconds / mm:ss)
- or level (dB / LUFS)
- or exact DAW action

Bad example:
'boost the highs'

Good example:
'boost around 10 kHz by +3 dB using a high shelf EQ'

Bad example:
'improve arrangement'

Good example:
'add a breakdown at 1:30 to reduce listener fatigue before the drop'

WEIGHTING — adapt depth per feedback_focus="${focus}":
- mastering   → loudness, dynamics, limiting, tonal balance, LUFS targets
- mixing      → balance, EQ, compression, stereo image, headroom
- arrangement → structure, intro/build/drop/outro, energy curve
- vocals / bass / drums / melody → prioritise that element specifically
- overall     → balanced full review

DAW INSTRUCTIONS (for ${dawLb}) — VISUAL multi-line format. Every entry in "daw_instructions" MUST be a SINGLE STRING containing real newline characters (\\n in the JSON), structured EXACTLY:
[CHANNEL: <element>]\\nStep 1 — Open <Mixer / Track>\\nStep 2 — Select <channel>\\nStep 3 — Insert <plugin — prefer ${dawLb} stock plugins>\\nStep 4 — Set:\\n  <param>: <value>\\n  <param>: <value>\\n  <param>: <value>
Concrete example for ${dawLb}:
"[CHANNEL: Kick]\\nStep 1 — Open Mixer (F3)\\nStep 2 — Select Kick channel\\nStep 3 — Insert Compressor\\nStep 4 — Set:\\n  Attack: 10 ms\\n  Release: 120 ms\\n  Ratio: 4:1"
NO " | " separators, NO inlining. Step 4 MUST end with a colon and each (param: value) pair MUST be on its own indented line. Generate 4–8 such entries.

SECTIONS — each of mix / mastering / arrangement / sound_design / commercial_potential MUST contain at least 3 (max 6) "notes" entries. EVERY note MUST follow this exact 5-part format string:
"Problem: <what is wrong>. Why: <technical cause>. Impact: <listener experience>. Fix: <action with Hz / mm:ss / dB / LUFS>. Result: <what will improve audibly>."
Both "Fix:" and "Result:" are mandatory; "Fix:" MUST reference a frequency, time, or level.

EVERY section.text (mix, mastering, arrangement, sound_design, commercial_potential) MUST end with two newlines (\\n\\n) followed by the literal line "Why this matters: <one short sentence about how this section's issues affect what the listener feels>". Single line, no extra paragraphs after it.

ANTI-REPETITION — each concrete diagnosed problem may appear in ONLY ONE place across the whole report. Pick the most relevant home (summary OR mix OR mastering OR arrangement OR sound_design OR commercial_potential), keep the strongest, most actionable wording there, and do NOT restate the same issue verbatim elsewhere.

ARRANGEMENT section MUST include an explicit ENERGY FLOW analysis: describe the energy curve across intro/build/drop/outro. If the drop lacks impact, name the technical reason (no buildup, constant energy, weak transient, frequency masking, sub-bass not landing on the down-beat, etc.).

TOP 3 PROBLEMS — the FIRST 3 entries of "recommendations" MUST be the three biggest issues breaking THIS track, ranked by severity. Use the object form:
{"timestamp":"mm:ss or 'whole-track'","target":"<bus / element>","text":"<concrete fix with Hz / dB / time>"}
After those, include 2–7 more recommendations (any form). Total 5–10.

FORBIDDEN WORDS in EVERY output string: "could", "might", "consider". Replace with decisive active phrasing: "this is causing", "this reduces", "this weakens the track", "this masks", "this kills the punch", "this must be fixed".

NO GUESSING — if a piece of audio data is not present in the DERIVED AUDIO INSIGHTS or RAW ESSENTIA FEATURES blocks above, do NOT invent a number. Skip that observation rather than fabricate.

"summary" — VERDICT TONE. MUST start with the literal token "MAIN ISSUE: " followed by EXACTLY 2 short sentences:
  Sentence 1 = verdict naming the single core problem and the audible consequence (e.g. "Your track loses impact because the low-end collapses into mud.").
  Sentence 2 = WHY the track feels weak — the technical cause behind that verdict (e.g. "The kick and bass are masking each other, killing punch and clarity.").
Only ONE main issue. NO third sentence. NO "IF YOU FIX ONLY 3 THINGS" list inside summary — that list now lives at the TOP of full_analysis (see below).

"overall_score" — integer 0–100 grounded in the derived insights.

"full_analysis" — single string with real newline characters (\\n). MUST start with these two visual blocks, in this exact order, BEFORE the long-form narrative:
=== FIX THESE 3 THINGS FIRST ===\\n1. <biggest concrete fix with Hz / dB / ms / LUFS>\\n2. <second concrete fix>\\n3. <third concrete fix>\\n\\n=== EXPECTED BEFORE / AFTER ===\\nBefore:\\n- <symptom 1>\\n- <symptom 2>\\nAfter:\\n- <improvement 1>\\n- <improvement 2>\\n- <improvement 3>\\n\\n
Then the 300–600 word narrative specific to THIS track (not the genre), covering the energy flow analysis explicitly.

"references" — 0–6 short reference tracks/plugins/articles relevant to the suggested fixes.

Return ONLY this JSON shape — no extra keys, no markdown, no code fences:
{
  "summary": string,
  "overall_score": number,
  "sections": {
    "mix":                  { "score": number, "text": string, "notes": string[] },
    "mastering":            { "score": number, "text": string, "notes": string[] },
    "arrangement":          { "score": number, "text": string, "notes": string[] },
    "sound_design":         { "score": number, "text": string, "notes": string[] },
    "commercial_potential": { "score": number, "text": string, "notes": string[] }
  },
  "recommendations": Array<string | {"timestamp": string, "target": string, "text": string}>,
  "daw_instructions": string[],
  "full_analysis": string,
  "references": string[]
}`

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

  const sectionsRaw = (parsed.sections && typeof parsed.sections === "object"
    ? parsed.sections
    : {}) as Record<string, unknown>

  const report: ProducerReport = {
    version:       1,
    generated_at:  new Date().toISOString(),
    summary:       typeof parsed.summary === "string" && parsed.summary.trim()
                     ? parsed.summary.trim()
                     : `Automated AI Producer review for "${inputs.title ?? "Untitled"}".`,
    overall_score: clamp01_100(parsed.overall_score, 70),
    sections: {
      mix:                  normaliseSection(sectionsRaw.mix,                  "Mix balance review."),
      mastering:            normaliseSection(sectionsRaw.mastering,            "Mastering review."),
      arrangement:          normaliseSection(sectionsRaw.arrangement,          "Arrangement review."),
      sound_design:         normaliseSection(sectionsRaw.sound_design,         "Sound design review."),
      commercial_potential: normaliseSection(sectionsRaw.commercial_potential, "Commercial potential review."),
    },
    recommendations:  normaliseRecommendations(parsed.recommendations),
    daw_instructions: toStringArray(parsed.daw_instructions, 12),
    full_analysis:    typeof parsed.full_analysis === "string" ? parsed.full_analysis.trim() : "",
    references:       toStringArray(parsed.references, 6),
    audio_features:   features,
  }

  return { ok: true, report }
}
