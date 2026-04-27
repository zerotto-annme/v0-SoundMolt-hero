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

export type GenreSource = "auto" | "manual"

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
  /** "auto" when the form left genre on Auto, "manual" otherwise. */
  genre_source:     GenreSource
  /** Genre auto-detected from the audio features (always set when possible). */
  detected_genre:   string | null
  /** Genre actually used to drive the genre-brain rules in the prompt. */
  final_genre_used: string | null
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

function dawExampleFor(id: string | null): string {
  switch (id) {
    case "cubase":
      return "\"[1]\\nFIXING: track loudness sits below the genre target — needs a mastering limiter on the Stereo Out\\nCHANNEL: Stereo Out\\nGO TO:\\n1. Press F3 in Cubase to open the MixConsole.\\n2. Locate the Stereo Out channel strip on the right side of the MixConsole.\\n3. Open the Inserts rack on the left side of that channel strip.\\nFIND:\\n- Stereo Out is the right-most channel — every other track routes into it.\\n- If the channel name is hidden, hover the header until the tooltip reads \\\"Stereo Out\\\".\\n- If you renamed the master bus, solo any track to confirm the channel its signal flows into.\\nCLICK:\\n1. Click the empty Insert Slot 1 box on the Stereo Out channel.\\n2. The Cubase plugin browser opens.\\n3. Navigate to: Dynamics → Limiter.\\n4. Click \\\"Limiter\\\" — the Limiter window opens automatically.\\nSET:\\n  Output (Ceiling): -1.0 dB\\n  Release: 50 ms (range: 30–80 ms)\\n  Input gain: increase until integrated loudness reaches the genre target from GENRE BRAIN above\\nA/B CHECK:\\n1. Click the Limiter's bypass LED on the Stereo Out Insert Slot 1 to toggle it ON / OFF.\\n2. Play the loudest chorus / drop with the Limiter ON, then bypassed.\\n3. Focus on transient impact and peak control — confirm the Limiter is shaping peaks without flattening the punch.\\nMETER CHECK:\\n- Insert SuperVision on the Stereo Out (Insert Slot 2). Add the Loudness module → Integrated LUFS within ±0.5 of the genre target from GENRE BRAIN above.\\n- Add the Spectrum module inside SuperVision → confirm no concentrated band of clipped energy above the ceiling.\\n- Stereo Out channel meter (Peak dBFS) → never crosses -1.0 dBFS during the loudest section.\\n- Limiter Gain-Reduction meter → no more than 3 dB pull on the loudest peaks.\nSTOP WHEN:\n- integrated LUFS reading sits within ±0.5 of the genre target AND the limiter Gain-Reduction meter pulls 3 dB or less on every peak.\nWARNING:\n- if Input gain pushes the limiter past the genre target by 1 dB or more the master loses dynamics and the track sounds squashed; reduce Input gain by 1–2 dB and re-check.\nIF NOT AVAILABLE:\\n→ Use any other Cubase stock brickwall limiter: Maximizer or Brickwall Limiter.\\n→ Match the same Ceiling, Release and target loudness values.\\nRESULT: the track sits at the correct competitive loudness for its genre while peaks are controlled and the original mix character stays intact.\""
    case "ableton":
      return "\"[1]\\nFIXING: track loudness sits below the genre target — needs a mastering limiter on the Master track\\nCHANNEL: Master track\\nGO TO:\\n1. Press Tab in Ableton Live to switch to Session view.\\n2. Click the Master track — it is the right-most channel in the Mixer section.\\n3. The Device chain opens at the bottom of the screen.\\nFIND:\\n- The Master track is always the right-most channel and is labelled \\\"Master\\\" by default.\\n- If your Master is renamed, look for the channel every other track routes into (their \\\"Audio To\\\" reads \\\"Master\\\").\\n- Solo any track to confirm signal flows into the channel you selected.\\nCLICK:\\n1. Open the Browser with Cmd/Ctrl+Alt+B.\\n2. Navigate to: Audio Effects → Dynamics → Limiter.\\n3. Drag \\\"Limiter\\\" onto the Master track's Device chain (drop it into the empty area at the bottom).\\n4. The Limiter device appears at the end of the Master chain.\\nSET:\\n  Ceiling: -1.0 dB\\n  Release: 50 ms (range: 30–80 ms)\\n  Gain: increase until integrated loudness reaches the genre target from GENRE BRAIN above\\nA/B CHECK:\\n1. Click the Limiter device on/off LED on the Master track to toggle bypass.\\n2. Play the loudest chorus / drop with the Limiter ON, then bypassed.\\n3. Focus on transient impact and peak control — confirm the Limiter shapes peaks without flattening punch.\\nMETER CHECK:\\n- Master peak meter on the Master track → never lights the red clip indicator.\\n- Limiter Gain-Reduction (GR) display → no more than 3 dB pull on the loudest peaks.\\n- Drag the stock \\\"Spectrum\\\" device onto the Master → confirm no concentrated band of clipped energy above the ceiling.\\n- Drag the stock \\\"Utility\\\" device onto the Master after the Limiter and read the Master peak / RMS → within ±0.5 dB of the genre target from GENRE BRAIN above.\nSTOP WHEN:\n- integrated LUFS reading sits within ±0.5 of the genre target AND the limiter Gain-Reduction meter pulls 3 dB or less on every peak.\nWARNING:\n- if Input gain pushes the limiter past the genre target by 1 dB or more the master loses dynamics and the track sounds squashed; reduce Input gain by 1–2 dB and re-check.\nIF NOT AVAILABLE:\\n→ Use any other Ableton stock limiter: \\\"Glue Compressor\\\" with the soft-clip toggle on, or \\\"Drum Buss\\\" for additional clipping.\\n→ Match the same Ceiling, Release and target loudness values.\\nRESULT: the track sits at the correct competitive loudness for its genre while peaks are controlled and the original mix character stays intact.\""
    case "fl_studio":
      return "\"[1]\\nFIXING: track loudness sits below the genre target — needs a mastering limiter on the Master insert\\nCHANNEL: Master insert track\\nGO TO:\\n1. Press F9 in FL Studio to open the Mixer.\\n2. Click the Master insert track — it is the slot at the far left of the Mixer.\\n3. Look at the Effect slots panel on the right-hand side of the Mixer.\\nFIND:\\n- The Master is always the left-most slot in the Mixer and is labelled \\\"Master\\\".\\n- If you cannot see it, scroll the Mixer all the way to the left.\\n- Solo any insert track to confirm its signal flows into the Master.\\nCLICK:\\n1. Click the empty Effect slot 1 on the right-hand panel.\\n2. The plugin selector opens.\\n3. Navigate to: Select → Effects → Fruity Limiter.\\n4. Click \\\"Fruity Limiter\\\" — the Limiter window opens automatically.\\nSET:\\n  Ceiling: -1.0 dB\\n  Release: 50 ms (range: 30–80 ms)\\n  Gain: increase until integrated loudness reaches the genre target from GENRE BRAIN above\\nA/B CHECK:\\n1. Click the green LED next to Fruity Limiter in the Master Effect slot to toggle bypass.\\n2. Play the loudest chorus / drop with the Limiter ON, then bypassed.\\n3. Focus on transient impact and peak control — confirm the Limiter shapes peaks without flattening punch.\\nMETER CHECK:\\n- Master meter in the Mixer → never crosses -1.0 dBFS.\\n- Fruity Limiter Gain-Reduction (GR) display → no more than 3 dB pull on the loudest peaks.\\n- Insert Wave Candy on the Master in Effect slot 2 → set mode to \\\"Loudness Meter\\\" → Integrated LUFS within ±0.5 of the genre target from GENRE BRAIN above.\\n- Switch a second Wave Candy instance to Spectrum mode → confirm no concentrated band of clipped energy above the ceiling.\nSTOP WHEN:\n- integrated LUFS reading sits within ±0.5 of the genre target AND the limiter Gain-Reduction meter pulls 3 dB or less on every peak.\nWARNING:\n- if Input gain pushes the limiter past the genre target by 1 dB or more the master loses dynamics and the track sounds squashed; reduce Input gain by 1–2 dB and re-check.\nIF NOT AVAILABLE:\\n→ Use any FL Studio stock brickwall limiter: Soundgoodizer (mode A or B) or Maximus.\\n→ Match the same Ceiling, Release and target loudness values.\\nRESULT: the track sits at the correct competitive loudness for its genre while peaks are controlled and the original mix character stays intact.\""
    case "logic":
      return "\"[1]\\nFIXING: track loudness sits below the genre target — needs a mastering limiter on the Stereo Out\\nCHANNEL: Stereo Out\\nGO TO:\\n1. Press X in Logic Pro to open the Mixer.\\n2. Locate the Stereo Out channel strip on the right side of the Mixer.\\n3. Find the Audio FX section in the middle of that channel strip.\\nFIND:\\n- Stereo Out is the right-most channel and is labelled \\\"Stereo Out\\\" by default.\\n- If you renamed it, look for the channel every other track routes into (their \\\"Output\\\" reads \\\"Stereo Out\\\").\\n- Solo any track to confirm its signal flows into the channel you selected.\\nCLICK:\\n1. Click an empty Audio FX slot on the Stereo Out channel strip.\\n2. The plugin menu opens.\\n3. Navigate to: Dynamics → Adaptive Limiter (Logic stock).\\n4. Click \\\"Adaptive Limiter\\\" — the plugin window opens automatically.\\nSET:\\n  Output Ceiling: -1.0 dB\\n  Release: 50 ms (range: 30–80 ms)\\n  Input gain: increase until integrated loudness reaches the genre target from GENRE BRAIN above\\nA/B CHECK:\\n1. Click the on/off LED next to Adaptive Limiter on the Stereo Out Audio FX slot to toggle bypass.\\n2. Play the loudest chorus / drop with the Adaptive Limiter ON, then bypassed.\\n3. Focus on transient impact and peak control — confirm the Adaptive Limiter shapes peaks without flattening punch.\\nMETER CHECK:\\n- Stereo Out peak meter → never crosses -1.0 dBFS.\\n- Adaptive Limiter Gain-Reduction (GR) display → no more than 3 dB pull on the loudest peaks.\\n- Insert the stock \\\"Loudness Meter\\\" on the Stereo Out (next Audio FX slot) → Integrated LUFS within ±0.5 of the genre target from GENRE BRAIN above.\\n- Insert the stock \\\"MultiMeter\\\" on the Stereo Out → confirm spectrum balance with no concentrated clipped band above the ceiling.\nSTOP WHEN:\n- integrated LUFS reading sits within ±0.5 of the genre target AND the limiter Gain-Reduction meter pulls 3 dB or less on every peak.\nWARNING:\n- if Input gain pushes the limiter past the genre target by 1 dB or more the master loses dynamics and the track sounds squashed; reduce Input gain by 1–2 dB and re-check.\nIF NOT AVAILABLE:\\n→ Use any other Logic stock brickwall limiter: \\\"Limiter\\\" or \\\"Mastering Assistant\\\" auto-loudness mode.\\n→ Match the same Ceiling, Release and target loudness values.\\nRESULT: the track sits at the correct competitive loudness for its genre while peaks are controlled and the original mix character stays intact.\""
    default:
      return "\"[1]\\nFIXING: track loudness sits below the genre target — needs a mastering limiter on the master output\\nCHANNEL: Master\\nGO TO:\\n1. Open the main mixer / channel-strip view of the DAW.\\n2. Select the master / stereo output channel.\\n3. Open the insert / audio-effect slots on that channel.\\nFIND:\\n- The master is the channel every other track routes into.\\n- Solo any track to confirm its signal flows into the channel you selected.\\nCLICK:\\n1. Click an empty insert slot.\\n2. The plugin browser opens.\\n3. Choose a stock brickwall limiter from the dynamics category.\\n4. The plugin window opens automatically.\\nSET:\\n  Ceiling: -1.0 dB\\n  Release: 50 ms (range: 30–80 ms)\\n  Input gain: increase until integrated loudness reaches the genre target from GENRE BRAIN above\\nA/B CHECK:\\n1. Click the limiter's bypass switch (slot on/off LED) on the master channel to toggle it.\\n2. Play the loudest chorus / drop with the limiter ON, then bypassed.\\n3. Focus on transient impact and peak control — confirm the limiter shapes peaks without flattening punch.\\nMETER CHECK:\\n- Master peak meter → never crosses -1.0 dBFS.\\n- Limiter Gain-Reduction (GR) display → no more than 3 dB pull on the loudest peaks.\\n- Insert the DAW's stock loudness meter on the master (or use the built-in peak / RMS reference if no LUFS module is available) → integrated LUFS within ±0.5 dB of the genre target from GENRE BRAIN above.\\n- Insert the DAW's stock spectrum analyzer on the master → confirm no concentrated band of clipped energy above the ceiling.\nSTOP WHEN:\n- integrated LUFS reading sits within ±0.5 of the genre target AND the limiter Gain-Reduction meter pulls 3 dB or less on every peak.\nWARNING:\n- if Input gain pushes the limiter past the genre target by 1 dB or more the master loses dynamics and the track sounds squashed; reduce Input gain by 1–2 dB and re-check.\nIF NOT AVAILABLE:\\n→ Use any other stock brickwall limiter from the same DAW.\\n→ Match the same Ceiling, Release and target loudness values.\\nRESULT: the track sits at the correct competitive loudness for its genre while peaks are controlled and the original mix character stays intact.\""
  }
}

function dawVocabFor(id: string | null): string {
  switch (id) {
    case "cubase":
      return [
        "MIXER WINDOW: \"MixConsole\" (open with F3)",
        "MASTER BUS NAME: \"Stereo Out\"",
        "INSERT SLOTS: \"Inserts rack\" on the channel strip (left side)",
        "OPEN CHANNEL SETTINGS: press \"e\" on the selected channel",
        "STOCK EQ: \"Frequency\" / \"Frequency 2\" / \"StudioEQ\"",
        "STOCK COMPRESSOR: \"Compressor\" (also \"VintageCompressor\", \"TubeCompressor\")",
        "STOCK MULTIBAND: \"MultibandCompressor\"",
        "STOCK LIMITER: \"Limiter\" / \"Maximizer\" / \"Brickwall Limiter\"",
        "STOCK SATURATION: \"Magneto II\" / \"DaTube\"",
        "STOCK REVERB: \"REVerence\" / \"RoomWorks\"",
        "STOCK DELAY: \"PingPongDelay\" / \"MonoDelay\"",
        "STOCK STEREO TOOL: \"StereoEnhancer\"",
        "SENDS: \"Sends\" rack on the channel strip → route to an FX channel",
        "AUTOMATION: \"Automation lane\" under the track in the Project window (R = read, W = write)",
        "ARRANGEMENT VIEW: \"Project window\"",
        "USE THESE EXACT TERMS in every GO TO / CLICK step",
      ].join("\n")
    case "ableton":
      return [
        "MIXER VIEW: Mixer section of Session view (Tab to switch views)",
        "MASTER BUS NAME: \"Master\" track (right-most channel in Session view)",
        "INSERT POINT: drag a device from the Browser into the Device chain at the bottom of the selected track",
        "STOCK EQ: \"EQ Eight\" (or \"EQ Three\" for DJ-style cuts)",
        "STOCK COMPRESSOR: \"Compressor\"",
        "STOCK GLUE: \"Glue Compressor\"",
        "STOCK MULTIBAND: \"Multiband Dynamics\"",
        "STOCK LIMITER: \"Limiter\"",
        "STOCK SATURATION: \"Saturator\" / \"Drum Buss\"",
        "STOCK REVERB: \"Reverb\" / \"Hybrid Reverb\"",
        "STOCK DELAY: \"Delay\" / \"Echo\"",
        "STOCK STEREO TOOL: \"Utility\" (Width parameter)",
        "SENDS: A/B/C return tracks (View → Returns) — turn the Send knob on the source track",
        "AUTOMATION: \"Automation envelope\" (toggle with A in Arrangement view)",
        "ARRANGEMENT VIEWS: \"Session view\" / \"Arrangement view\" (Tab to swap)",
        "USE THESE EXACT TERMS in every GO TO / CLICK step",
      ].join("\n")
    case "fl_studio":
      return [
        "MIXER WINDOW: \"Mixer\" (open with F9)",
        "MASTER BUS NAME: \"Master\" insert track (slot at the far left of the Mixer)",
        "INSERT SLOTS: \"Effect slots\" on the right-hand panel of the selected mixer track (slots 1–10)",
        "STOCK EQ: \"Fruity Parametric EQ 2\"",
        "STOCK COMPRESSOR: \"Fruity Compressor\" / \"Fruity Multiband Compressor\"",
        "STOCK LIMITER: \"Fruity Limiter\" (also handles compression, sat, and limiting) / \"Maximus\" (multiband mastering limiter) / \"Soundgoodizer\" (modes A / B / C / D — fast brickwall + saturation)",
        "STOCK SATURATION: \"Fruity Soft Clipper\" / \"Fruity Waveshaper\" / \"Fruity Fast Dist\"",
        "STOCK REVERB: \"Fruity Reeverb 2\" / \"Fruity Convolver\"",
        "STOCK DELAY: \"Fruity Delay 3\"",
        "STOCK STEREO TOOL: \"Fruity Stereo Shaper\"",
        "SENDS: route the source mixer track to another via the small arrow at the bottom of the destination channel",
        "AUTOMATION: \"Automation clip\" (right-click any knob → \"Create automation clip\"), shown in the Playlist",
        "MAIN VIEWS: \"Channel rack\" (F6) / \"Playlist\" (F5) / \"Mixer\" (F9)",
        "USE THESE EXACT TERMS in every GO TO / CLICK step",
      ].join("\n")
    case "logic":
      return [
        "MIXER WINDOW: \"Mixer\" (open with X)",
        "MASTER BUS NAME: \"Stereo Out\" channel strip (right side of the Mixer)",
        "INSERT SLOTS: \"Audio FX\" plugin slots on the channel strip",
        "STOCK EQ: \"Channel EQ\" (or \"Linear Phase EQ\" for mastering)",
        "STOCK COMPRESSOR: \"Compressor\" (modes: Platinum / VCA / FET / Studio FET / Classic VCA / Vintage VCA / Vintage FET / Vintage Opto)",
        "STOCK MULTIBAND: \"Multipressor\"",
        "STOCK LIMITER: \"Limiter\" / \"Adaptive Limiter\" / \"Mastering Assistant\" (Logic Pro 11+ stock auto-loudness limiter / mastering chain)",
        "STOCK SATURATION: \"Phat FX\" / \"Overdrive\" / \"Tape\" plugin",
        "STOCK REVERB: \"ChromaVerb\" / \"Space Designer\"",
        "STOCK DELAY: \"Stereo Delay\" / \"Tape Delay\"",
        "STOCK STEREO TOOL: \"Stereo Spread\" / \"Direction Mixer\"",
        "SENDS: \"Sends\" slot on the channel strip → select a Bus number",
        "AUTOMATION: \"Automation lane\" (toggle with A in the Tracks area)",
        "ARRANGEMENT VIEW: \"Tracks area\" (main timeline)",
        "USE THESE EXACT TERMS in every GO TO / CLICK step",
      ].join("\n")
    default:
      return [
        "MIXER WINDOW: the main mixer / channel-strip view of the DAW",
        "MASTER BUS NAME: the master / stereo output channel",
        "INSERT SLOTS: the insert / audio-effect plugin slots on the channel strip",
        "STOCK EQ: a generic stock parametric EQ",
        "STOCK COMPRESSOR: a generic stock compressor",
        "STOCK LIMITER: a generic stock brickwall limiter",
        "STOCK SATURATION: a generic stock saturation / tape plugin",
        "STOCK REVERB: a generic stock reverb",
        "STOCK DELAY: a generic stock delay",
        "SENDS: send / bus routing on the channel strip",
        "AUTOMATION: automation lane on the track in the arrangement view",
        "Use generic but precise channel-strip / mixer language since the DAW is unknown.",
      ].join("\n")
  }
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

// ─── Genre auto-detection + Genre Brain rules ──────────────────────────
//
// When the AI Producer form leaves "Genre" on Auto we run a deterministic
// detector against the Essentia features (high-level classifier first,
// BPM/danceability heuristic as fallback) so the LLM always receives a
// concrete genre label. The detected label drives a small "Genre Brain"
// rule block that focuses the analysis on what actually matters for that
// style of music (kick/sub for techno, transient/808 for trap, etc).

const GENRE_BRAIN_RULES: Record<string, string> = {
  techno:
    "GENRE BRAIN — TECHNO: focus the analysis on kick/sub fundamentals, club impact, and groove tension.\n" +
    "- Kick at 50–60 Hz must be tight, mono, and dominate the low-end punch.\n" +
    "- Sidechain bass to kick using the SIDECHAIN EXECUTION RULE (STRICT) parameters (2–4 dB GR, 5–15 ms attack, 80–150 ms release, ratio 3:1–5:1) so the kick breathes.\n" +
    "- Loudness target -8 to -9 LUFS integrated, true-peak ceiling -1 dB.\n" +
    "- Buildup and drop tension are essential: comment on filter sweeps, risers, snare rolls, kick drops, and energy curve at the breakdown.\n" +
    "- Avoid suggesting warm/lo-fi processing or excessive high-end softening; techno should feel hard and forward.",
  house:
    "GENRE BRAIN — HOUSE: focus on groove, swing, and the kick/bass pocket.\n" +
    "- 4-on-the-floor kick at 50–65 Hz; bass tucked between 80–200 Hz with sidechain set per the SIDECHAIN EXECUTION RULE (STRICT) parameters (2–4 dB GR, 5–15 ms attack, 80–150 ms release, ratio 3:1–5:1).\n" +
    "- Percussion movement: hats, shakers, claps must add stereo motion (panning + short delays) without crowding the centre.\n" +
    "- Loudness target -8 to -9 LUFS integrated, true-peak ceiling -1 dB (matches the Electronic bucket of the LOUDNESS TARGET RULE).\n" +
    "- Stereo rhythm and groove glue are more important than maximum loudness — comment on swing, ghost notes, and percussion layering.",
  trap:
    "GENRE BRAIN — TRAP: focus on 808, kick separation, vocal space, and transient punch.\n" +
    "- 808 sub fundamental 30–55 Hz, distorted layer 100–250 Hz for translation on small speakers.\n" +
    "- Kick must occupy a different frequency window from the 808 (kick 60–80 Hz click + 2–4 kHz transient) so they do not mask.\n" +
    "- Vocal space: HPF the music bus 250–300 Hz under the lead vocal, light de-essing 6–8 kHz.\n" +
    "- Transient punch: short attack on snare/clap (1–5 ms) plus parallel saturation; preserve dynamics.\n" +
    "- Loudness target -8 to -9 LUFS integrated, true-peak ceiling -1 dB.",
  lofi:
    "GENRE BRAIN — LO-FI: preserve warmth, do NOT over-limit, soft high-end, moderate loudness.\n" +
    "- Loudness target -14 to -16 LUFS integrated, true-peak ceiling -1 dB. Do NOT push to -8 LUFS.\n" +
    "- Roll off above 10–12 kHz with a gentle low-pass to keep the cassette/dusty character.\n" +
    "- Tape saturation, vinyl crackle, light wow/flutter are stylistic — recommend them, do not call them flaws.\n" +
    "- Avoid hard brick-wall limiting, aggressive transient designers, or harsh upper-mid boosts.\n" +
    "- Comment on swing, sample chops, and atmosphere rather than club-grade punch.",
  ambient:
    "GENRE BRAIN — AMBIENT: do NOT force kick/drop advice. Focus on space, texture, stereo depth, atmosphere.\n" +
    "- There may be no kick, no drop, no clear arrangement landmarks — that is fine for the genre.\n" +
    "- Loudness target -14 to -16 LUFS integrated, dynamic range matters more than loudness (matches the Ambient / Lo-Fi bucket of the LOUDNESS TARGET RULE).\n" +
    "- Comment on stereo width (M/S balance), reverb tails (long pre-delay, plate vs hall), evolving textures, and frequency layering between pads.\n" +
    "- Avoid sidechain-to-kick advice, transient-shaper suggestions, or club-loudness LUFS targets.",
}

function pickGenreFromHighLevel(features: EssentiaFeatures): string | null {
  const f = features as Record<string, unknown>
  const hl = pickString(
    get(f, "highlevel.genre_dortmund.value"),
    get(f, "highlevel.genre_rosamerica.value"),
    get(f, "highlevel.genre_electronic.value"),
    get(f, "highlevel.genre_tzanetakis.value"),
    get(f, "highlevel.genre.value"),
  )
  if (!hl) return null
  const norm = hl.toLowerCase().trim()
  // Map common Essentia high-level labels to our internal ids.
  const map: Record<string, string> = {
    techno: "techno", trance: "techno", electro: "techno",
    house: "house", deephouse: "house", "deep house": "house",
    "drum and bass": "dnb", "drum&bass": "dnb", "drum n bass": "dnb",
    dnb: "dnb", jungle: "dnb", breakbeat: "dnb",
    hiphop: "trap", "hip-hop": "trap", "hip hop": "trap", rap: "trap", trap: "trap",
    lofi: "lofi", "lo-fi": "lofi", chillhop: "lofi", "trip-hop": "lofi", "trip hop": "lofi",
    ambient: "ambient", drone: "ambient", newage: "ambient", "new age": "ambient",
    synthwave: "synthwave", retrowave: "synthwave", vaporwave: "synthwave",
    cinematic: "cinematic", soundtrack: "cinematic", score: "cinematic",
    electronic: "electronic", edm: "electronic", electronica: "electronic",
    experimental: "experimental", idm: "experimental",
  }
  return map[norm] ?? null
}

/**
 * Pick the best-fit internal genre id from derived insights when the
 * Essentia high-level classifier is not available. Conservative: falls
 * back to "electronic" rather than guessing wildly.
 */
function detectGenreFromFeatures(
  features: EssentiaFeatures,
  insights: DerivedAudioInsights,
): string {
  const fromHl = pickGenreFromHighLevel(features)
  if (fromHl) return fromHl

  const bpm    = insights.bpm ?? 0
  const dance  = insights.danceability ?? 0
  const energy = insights.energy ?? 0
  const sc     = insights.spectral_centroid ?? 0
  const dur    = insights.duration_seconds ?? 0

  if (bpm >= 165 && bpm <= 185) return "dnb"
  if (bpm >= 130 && bpm <= 160 && dance > 0 && dance < 0.85 && sc < 4500) return "trap"
  if (bpm >= 120 && bpm <= 135 && (energy > 0.05 || dance > 0.6)) return "techno"
  if (bpm >= 115 && bpm <  125) return "house"
  if (bpm >= 100 && bpm <  115) return "synthwave"
  if (bpm > 0 && bpm < 95 && (dance < 0.5 || energy < 0.05)) return "lofi"
  if ((bpm > 0 && bpm < 90 && dance < 0.4) || (dur > 240 && dance < 0.3)) return "ambient"
  return "electronic"
}

const GENRE_LABELS: Record<string, string> = {
  lofi: "Lo-Fi",
  techno: "Techno",
  ambient: "Ambient",
  synthwave: "Synthwave",
  trap: "Trap",
  cinematic: "Cinematic",
  electronic: "Electronic",
  house: "House",
  dnb: "Drum & Bass",
  experimental: "Experimental",
}

function prettyGenreLabel(id: string | null | undefined): string {
  if (!id) return "Electronic"
  return GENRE_LABELS[id.toLowerCase()] ?? id
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

  // Step 1b — genre resolution. The form sends "auto" by default; any
  // empty / "auto" value means we run our deterministic detector and
  // hand the LLM the detected genre. Manual selections are honoured
  // verbatim so the user can override the detector.
  const rawGenre = (inputs.genre ?? "").trim().toLowerCase()
  const isAutoGenre = rawGenre === "" || rawGenre === "auto"
  const detectedGenre = detectGenreFromFeatures(features, insights)
  const genreSource: GenreSource = isAutoGenre ? "auto" : "manual"
  const finalGenre = isAutoGenre ? detectedGenre : rawGenre
  const finalGenreLabel = prettyGenreLabel(finalGenre)
  const detectedGenreLabel = prettyGenreLabel(detectedGenre)
  const brainRules = GENRE_BRAIN_RULES[finalGenre] ?? ""

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
    "WHY IT FAILS (Stage 9 step 2 + step 3 + Stage 10 step 5 + Stage 12 step 2): For every section, EVERY note MUST follow this exact format:\n" +
    "\"Problem: <what is wrong>. Why: <technical cause>. Impact: <what the listener feels>. Fix: <concrete action with Hz / mm:ss / dB / LUFS>. Result: <what will improve audibly>.\"\n" +
    "Example: \"Problem: low-end is muddy. Why: the kick (60 Hz) overlaps the bass (100 Hz) causing masking. Impact: the drop feels weak and lacks punch. Fix: high-pass the bass at 80 Hz and side-chain it -4 dB to the kick (10 ms attack, 120 ms release). Result: the low-end becomes cleaner and the kick gains punch.\"\n" +
    "PRIORITY LAYER (Stage 12 step 2): each section.notes MUST contain 1 (preferred) or 2 (max) entries — the MOST critical issues of that section only. Both Fix and Result remain mandatory; Fix MUST reference Hz, time, or dB/LUFS.\n" +
    "  notes[0] MUST start with the literal prefix \"MAIN ISSUE — \" followed by the 5-part format string (the single biggest issue of THIS section).\n" +
    "  notes[1] (OPTIONAL, max one) MUST start with the literal prefix \"ADDITIONAL ISSUE — \" followed by the 5-part format string (the next most important issue of THIS section).\n" +
    "All other diagnoses, deeper polish ideas, and extra observations DO NOT belong in section.notes — keep them out. The full_analysis block is intentionally short (three banner-separated blocks: a Full Analysis conclusion of Strength / Main weakness / Fix / Result, then \\\"--- MARKET POSITION ---\\\", then \\\"--- CONFIDENCE ---\\\") and is NOT the place to dump every observation either; pick only what raises the track most.\n\n" +
    "DAW MODE (CLICK-BY-CLICK GUIDE) — daw_instructions is NOT a summary of the report; it is a PRACTICAL EXECUTION GUIDE the user can follow click-by-click inside the SELECTED DAW. Each entry maps DIRECTLY to ONE concrete FIX written in the report sections — no entry exists on its own. Every entry MUST be a SINGLE STRING containing ACTUAL newline characters (\\n) and MUST be written using the EXACT terminology of the SELECTED DAW (provided in the user prompt as the DAW VOCABULARY block). NEVER write generic \"Mixer → insert plugin\" — name the actual window, the actual shortcut key, the actual stock plugin name of the selected DAW.\n" +
    "GLOBAL RULE — write every daw_instructions entry as if the user has NEVER opened the selected DAW before. Step-by-step, click-by-click, explicit, impossible to misunderstand. Never assume prior knowledge of menus, shortcuts, or routing. If a producer would have to think to apply the instruction, the instruction is not detailed enough — add another numbered step.\n" +
    "HIGH-IMPACT ONLY — generate daw_instructions ONLY for fixes that materially change how the track sounds. SKIP cosmetic tweaks, optional polish, and non-critical observations entirely. If a fix is not high-impact, do NOT generate a daw_instruction entry for it. Target between 4 and 6 high-impact entries (minimum 4 for a full report — see EXECUTION COMPLETENESS rule E5); never pad with cosmetic fixes to hit the minimum.\n" +
    "PRIORITY ORDER — generate entries in this EXACT order, skipping any category that is not relevant to THIS track: (1) LOW-END FIX (kick / bass / sub conflict, masking, muddy low-end), (2) LOUDNESS / MASTERING (limiter on Master, LUFS target, headroom), (3) HARSHNESS / HIGH-END (de-essing, harsh resonances 2–6 kHz, sibilance, harsh hi-hats), (4) ARRANGEMENT (only if a structural fix is critical — adding a breakdown, fixing a weak drop), (5) SOUND DESIGN (only if a specific element is broken and high-impact — distorted bass, weak kick, dull lead).\n" +
    "Each entry MUST contain these labelled blocks in this EXACT order on their own lines: [N] (an actual numeric step ID written literally as [1], [2], [3] — NEVER output the literal text [STEP ID] / [N] / [number] in the JSON), FIXING, CHANNEL, GO TO, FIND, CLICK, SET, A/B CHECK, METER CHECK, STOP WHEN, WARNING, IF NOT AVAILABLE, RESULT. SELECT, INSERT and AUTOMATE are OPTIONAL and may be added (SELECT before CLICK, INSERT between CLICK and SET, AUTOMATE between SET and A/B CHECK) ONLY when they make the instruction more actionable. SIDECHAIN SETUP is MANDATORY whenever the entry references sidechain / side-chain / ducking / kick-bass routing (insert it immediately after METER CHECK and before STOP WHEN). A/B CHECK, METER CHECK, STOP WHEN and WARNING are MANDATORY in EVERY entry. A/B CHECK is the LANDR-grade bypass-and-compare workflow: 3 numbered steps that (1) toggle the plugin's bypass LED / on-off indicator ON / OFF, (2) play the loudest chorus / drop with the plugin ON then bypassed, (3) focus on the SPECIFIC problem the fix addresses (kick clarity, harsh highs, low-end mud, peak control). METER CHECK names the EXACT stock meter tools the user must read AND the EXACT numeric readings to expect — Cubase: SuperVision (Loudness module → Integrated LUFS, Spectrum module → frequency energy) + Stereo Out channel meter (Peak dBFS) + Limiter Gain-Reduction; Ableton: Master peak meter + Limiter GR + stock Spectrum + Utility for peak/RMS; FL Studio: Mixer meter + Fruity Limiter GR + Wave Candy (Loudness Meter / Spectrum); Logic: Stereo Out peak + Adaptive Limiter GR + stock Loudness Meter + MultiMeter. METER CHECK SUBSUMES the old CHECK LOUDNESS block — when LUFS is referenced, the LUFS reading lives inside METER CHECK as one of its bullets, not as a separate block. STOP WHEN names the OBJECTIVE measurable condition that signals the fix is correctly applied (a meter reading, a numeric LUFS / dB / Hz value, a visible spectrum / waveform state); WARNING names the audible failure mode if the user pushes the fix too far AND tells the user how to back off in concrete numbers. TRUST SIGNAL — every entry MUST give the user the four certainties: (a) what to click (CLICK / INSERT), (b) what to measure (METER CHECK), (c) when to stop (STOP WHEN), (d) how to undo a mistake (WARNING numeric back-off). NOTHING is allowed after RESULT — no closing summary, no repeated MAIN ISSUE / FIXING line, no extra commentary.\n" +
    "CHANNEL NAMING (HARD) — the CHANNEL line MUST name an EXACT, REAL channel that exists in the SELECTED DAW: either the SELECTED DAW's exact master/output channel name from DAW VOCABULARY (Cubase: \"Stereo Out\"; Ableton: \"Master\" / Master track; FL Studio: \"Master\" insert track; Logic: \"Stereo Out\") OR a clearly named instrument / bus track from THIS user's project (Kick, Bass, Sub, Synth, Lead Vocal, Drum Bus, etc.). The generic placeholders \"Main Mix\", \"Main Bus\", \"Master Channel\", \"Master Bus\" (when used as a generic label rather than the actual DAW name) and \"Output\" are FORBIDDEN — replace them with the SELECTED DAW's exact master name from DAW VOCABULARY.\n" +
    "RANGES (HARD) — every numeric SET parameter MUST include a parenthesised (range: <low>–<high> <unit>) annotation when a safe musical range exists; single-value-only entries are allowed ONLY for parameters with no meaningful range (e.g. Send Level fixed at 0.0 dB for the sidechain compressor send, ceiling fixed at -1.0 dB for the mastering limiter). Examples that MUST always include a range: Frequency (60–100 Hz), Gain (-2 to -4 dB), Drive (1–3 dB), Attack (1–10 ms), Release (50–150 ms), Mix (20–30%), Q (0.7–2.0).\n" +
    "Required template (every \\n is a real newline character in the JSON string; use the SELECTED DAW's vocabulary in every step):\n" +
    "[<step number>]   ← e.g. [1], [2], [3] — sequential, starting at 1, incrementing by 1 across the daw_instructions array.\\nFIXING: <ONE short sentence (≤ 14 words) naming the EXACT problem this entry solves — this MUST mirror a FIX written in the report sections (e.g. \\\"muddy low-end caused by kick/bass overlap\\\", \\\"track is too quiet vs genre target — integrated LUFS reads -18\\\", \\\"harsh sibilance around 6 kHz on the lead vocal\\\")>\\nCHANNEL: <element / bus name in the selected DAW's terminology>\\nGO TO:\\n1. <numbered navigation step naming the actual DAW window / shortcut>\\n2. <step>\\n3. <step>\\nFIND:\\n- <how to locate the channel even if it is renamed or hidden — track-name hints (Bass / Kick / Synth / Vocal), the role the channel plays in the routing, what to look at on screen>\\n- <fallback heuristic — solo any track to confirm signal flows into the channel you selected; bass = low frequencies; kick = short punch sound>\\nCLICK:\\n1. <click action 1 — name the EXACT button / area / icon being clicked>\\n2. <click action 2 — what window/menu/browser opens after step 1>\\n3. <navigation path inside that menu/browser to the plugin — Inserts → empty slot → browser opens → navigate to: <category> → <plugin>>\\n4. <final click action that loads the plugin and opens its window>\\nSET (every numeric param MUST end with a parenthesised \"(range: <low>–<high> <unit>)\" annotation when a safe musical range exists; single-value-only is allowed ONLY for fixed-by-design params like Ceiling -1.0 dB or Send Level 0.0 dB):\\n  <param>: <exact value> (range: <low>–<high> <unit>)\\n  <param>: <exact value> (range: <low>–<high> <unit>)\\n  <param>: <exact value> (range: <low>–<high> <unit>)\\nA/B CHECK:\\n1. Click the plugin's bypass LED (the on/off indicator on the slot) to toggle it ON / OFF.\\n2. Play the loudest chorus / drop with the plugin ON, then bypassed.\\n3. Focus on the SPECIFIC problem the fix addresses (kick clarity, harsh highs, low-end mud, peak control) and confirm the audible improvement.\\nMETER CHECK:\\n- <a measurable reading via a stock meter from DAW VOCABULARY (LUFS / Peak dBFS / Gain Reduction / Spectrum / channel meter) — name the meter / module / plugin AND the EXACT numeric reading the user must see (e.g. \\\"SuperVision Loudness module → Integrated LUFS within ±0.5 of the genre target\\\", \\\"Stereo Out channel meter → Peak never crosses -1.0 dBFS\\\", \\\"compressor Gain-Reduction meter → 3–5 dB pull on every kick hit\\\")>\\n- <a second measurable reading via another stock meter / module from DAW VOCABULARY>\\nSTOP WHEN:\\n- <ONE objective measurable condition that proves the fix is correctly applied — must cite a meter, LUFS / dB / Hz reading, gain-reduction value, spectrum / waveform state, or other numeric reading the user can SEE; never a subjective \"sounds right\" cue>\\nWARNING:\\n- <ONE concrete failure mode if the user pushes the fix too far (e.g. \"if the bass disappears the EQ cut is too deep\", \"if the master loses dynamics the limiter is over-driven\") + the EXACT numeric back-off the user must apply (e.g. \"reduce EQ cut by 1 dB\", \"reduce drive by 1–2 dB\", \"raise threshold by 2 dB\")>\\nIF NOT AVAILABLE:\\n→ Use any other stock plugin of the same family from the SELECTED DAW: EQ → any other stock EQ from DAW VOCABULARY; Limiter → any other stock brickwall limiter from DAW VOCABULARY; Saturation → any other stock saturator from DAW VOCABULARY; Compressor → any other stock compressor from DAW VOCABULARY; Reverb → any other stock reverb from DAW VOCABULARY.\\n→ Match the SET values approximately (Hz, dB, ms, ratio, %).\\n→ NEVER name a third-party plugin — only stock plugins from DAW VOCABULARY.\\nRESULT: <one decisive sentence — what the listener will hear after applying it (e.g. \\\"the kick punches through the bass on every hit and the low-end stops feeling muddy\\\")>\n" +
    "Conditional SIDECHAIN SETUP block (insert immediately after METER CHECK and before STOP WHEN whenever the entry mentions sidechain / side-chain / ducking / kick-bass routing — adapt routing wording to the SELECTED DAW; this is the FULL 9-step (as defined in the SIDECHAIN EXECUTION RULE (STRICT)) routing flow, not a one-line note):\n" +
    "SIDECHAIN SETUP:\\n1. Insert a stock Compressor on the channel that should duck (e.g. Bass channel) — pick the SELECTED DAW's stock compressor from DAW VOCABULARY.\\n2. Activate the Sidechain / Side-Chain toggle inside that compressor (Cubase: \\\"Side-Chain\\\" button top-right of Compressor; Ableton: fold-out \\\"Sidechain\\\" toggle on Compressor; FL Studio: enable sidechain via the Mixer arrow routing; Logic: \\\"Side Chain\\\" menu top-right of the compressor).\\n3. Go to the trigger source channel (e.g. Kick) → open its Sends / output routing section.\\n4. Add a send / route from the Kick to the Sidechain INPUT of the Bass compressor (Cubase: Sends panel → pick the Bass compressor's side-chain bus; Ableton: \\\"Audio From\\\" on the compressor's sidechain set to \\\"Kick\\\"; FL Studio: right-click the Kick mixer arrow → \\\"Sidechain to this track\\\" pointing at the Bass insert; Logic: \\\"Side Chain\\\" menu on the Bass compressor → select Kick channel).\\n5. Set Send Level to 0.0 dB so the trigger reaches the compressor at full strength.\\n6. Return to the Bass compressor.\\n7. Set Threshold so peaks pull 2–4 dB GR; Attack 5–15 ms; Release 80–150 ms; Ratio 3:1–5:1 (per the SIDECHAIN EXECUTION RULE (STRICT)).\\n8. Confirm the Gain-Reduction (GR) meter shows 2–4 dB dips on every kick hit; if no GR is visible the routing is wrong — recheck step 4.\\n9. Confirm Gain Reduction meter returns to 0 dB GR before the next kick hit (proving release time is correct and bass level restores between hits).\n" +
    "Optional blocks (use only when they add real value): SELECT (what audio range / clip / region to select first), INSERT (a separate plugin-name line if it was not already named under CLICK), AUTOMATE (what parameter to automate, when in the timeline, and by how much).\n" +
    `Concrete example for ${dawLb} (literal "\\n" represents real newline characters in the JSON string; use it as a STYLE / FORMAT reference, NOT as content to copy verbatim):\n` +
    `${dawExampleFor(dawId)}\n` +
    "RULES (HARD): (1) Every entry MUST start with [<step number>] on its OWN line and the next line MUST be FIXING: <problem> mirroring a FIX from the report — no entry without both. (2) Every entry MUST mention the SELECTED DAW by name AT LEAST ONCE in either GO TO or CLICK. (3) GO TO and CLICK MUST be NUMBERED LISTS (1. 2. 3. 4.) and CLICK MUST contain AT LEAST 3 numbered steps that describe the full navigation chain (which area to click → which window/browser opens → which path to follow → which plugin to load). (4) SET MUST end with a colon and each (param: value) pair MUST be on its own indented line; EVERY numeric param MUST end with a parenthesised \\\"(range: <low>–<high> <unit>)\\\" annotation when a safe musical range exists; single-value-only is allowed ONLY for fixed-by-design params (e.g. Send Level fixed at 0.0 dB for the sidechain compressor send, ceiling fixed at -1.0 dB for the mastering limiter). (5) A/B CHECK MUST be a 3-step bypass-and-compare workflow citing the EXACT bypass LED / on-off indicator the user must click; METER CHECK MUST be OBJECTIVE — every meter line MUST cite a meter / spectrum analyzer / gain-reduction meter / LUFS reading / Peak dBFS reading the user can SEE on a stock plugin from DAW VOCABULARY. The phrases \\\"listen for\\\", \\\"check the warmth\\\", \\\"check clarity\\\", \\\"check the vibe\\\" are FORBIDDEN. Replace any subjective listening cue with a measurable instrument-based observation. (6) NO generic placeholders like \\\"the mixer\\\" or \\\"insert a limiter\\\" — use the DAW vocabulary from the user prompt verbatim. (7) Do NOT invent plugins; pick from the SELECTED DAW's stock plugin list given in the DAW VOCABULARY block, or say \\\"a generic <type>\\\" if the DAW is unknown. (8) Each entry MUST be tied to a specific high-impact recommendation from the report; non-critical fixes are SKIPPED, not padded. (9) NO \\\" | \\\" separators, NO single-line inlining. (10) FIND, A/B CHECK, METER CHECK, STOP WHEN, WARNING and IF NOT AVAILABLE are MANDATORY in EVERY entry — never omit them. SIDECHAIN SETUP (the FULL 9-step (as defined in the SIDECHAIN EXECUTION RULE (STRICT)) routing flow) is MANDATORY whenever sidechain is referenced. STOP WHEN MUST cite a measurable condition (meter / LUFS / dB / Hz / spectrum / waveform reading); WARNING MUST name the audible failure mode AND the exact numeric back-off (e.g. \\\"if bass disappears reduce EQ cut by 1 dB\\\", \\\"if master loses dynamics reduce drive by 1–2 dB\\\"). TRUST SIGNAL — every entry MUST give the user the four certainties: (a) what to click (CLICK / INSERT), (b) what to measure (METER CHECK), (c) when to stop (STOP WHEN), (d) how to undo a mistake (WARNING numeric back-off). (11) WARNING MUST tell the user how to back off (reduce gain / drive / amount by a specific 1–2 dB) if the effect is too strong — the back-off lives in WARNING, not A/B CHECK or METER CHECK. (12) NOTHING after RESULT — no closing line, no repeated FIXING / MAIN ISSUE summary, no extra advice. The entry ENDS at RESULT. (13) Generate between 4 and 6 entries — minimum 4 for a full report; 3 or fewer is allowed ONLY if the report itself contains fewer than 4 truly actionable FIXes. (14) CHANNEL NAMING (HARD) — the CHANNEL line MUST name an EXACT, REAL channel that exists in the SELECTED DAW: either the SELECTED DAW's exact master/output channel name from DAW VOCABULARY (Cubase: \\\"Stereo Out\\\"; Ableton: \\\"Master\\\" / Master track; FL Studio: \\\"Master\\\" insert track; Logic: \\\"Stereo Out\\\") OR a clearly named instrument / bus track from THIS user's project (Kick, Bass, Sub, Synth, Lead Vocal, Drum Bus, etc.). The generic placeholders \\\"Main Mix\\\", \\\"Main Bus\\\", \\\"Master Channel\\\", \\\"Master Bus\\\" (when used as a generic label rather than the actual DAW name) and \\\"Output\\\" are FORBIDDEN — replace them with the SELECTED DAW's exact master name from DAW VOCABULARY.\n\n" +
    "PREMIUM ENFORCEMENT (HARD) — these rules elevate the report to LANDR / iZotope level: " +
    "(P1) SIDECHAIN MANDATE — if the report mentions sidechain / side-chain / ducking / kick-bass routing ANYWHERE (mix sections, mastering, recommendations, full_analysis, summary), you MUST generate a DEDICATED full daw_instructions entry executing the FULL 9-step (as defined in the SIDECHAIN EXECUTION RULE (STRICT)) SIDECHAIN SETUP routing flow — never bury sidechain inside another fix and never skip it. " +
    "(P2) FIX-TO-DAW COVERAGE — every concrete FIX written in sections.mix.notes, sections.mastering.notes and sections.sound_design.notes MUST have a corresponding daw_instructions entry executing it click-by-click. No FIX is allowed to live in the report without a paired daw_instructions block; if you cannot generate the execution steps, do NOT include the FIX. " +
    "(P3) OBJECTIVITY BAN — the words \\\"clear\\\", \\\"clearer\\\", \\\"better\\\", \\\"clean\\\", \\\"cleaner\\\", \\\"tight\\\", \\\"tighter\\\", \\\"warm\\\", \\\"warmer\\\", \\\"punchy\\\", \\\"punchier\\\", \\\"open\\\", \\\"opens up\\\" are FORBIDDEN inside A/B CHECK, METER CHECK and STOP WHEN. Replace them with a frequency range (Hz), a peak comparison (dB), a LUFS reading, a Gain-Reduction value, or a spectrum / waveform observation. Example: instead of \\\"the kick sounds clearer\\\" → \\\"the kick fundamental at 60 Hz peaks 4 dB above the bass on the spectrum analyzer\\\". " +
    "(P4) ARRANGEMENT EXECUTION — every daw_instructions entry tied to ARRANGEMENT MUST name (a) the EXACT action (mute / delete / cut / duplicate / automate / move / fade-in / fade-out), (b) the EXACT timestamp range in mm:ss–mm:ss format from THIS track's timeline, (c) the EXACT element(s) being acted on (Kick, Hi-Hat, Lead Synth, Vocal Chop, Bass, Drum Bus, etc.). Generic phrases like \\\"add a breakdown\\\", \\\"strengthen the drop\\\" without (a)+(b)+(c) are FORBIDDEN. " +
    "(P5) NO ORPHAN FIXES — every FIX written in any section.notes (mix / mastering / arrangement / sound_design / commercial_potential) is REQUIRED to be executable. If a FIX cannot be turned into a daw_instructions block with concrete (a) channel + (b) plugin + (c) numeric SET values + (d) METER CHECK + (e) STOP WHEN, you MUST either (i) reword the FIX so it becomes executable, or (ii) drop the FIX entirely from the report. The report is FORBIDDEN to leave the user with advice they cannot act on inside the SELECTED DAW.\n\n" +
    "EXECUTION COMPLETENESS (HARD) — every actionable production claim in the report MUST be executable inside the SELECTED DAW: " +
    "(E1) FIX-WIDE COVERAGE — every concrete FIX mentioned ANYWHERE in the report (sections.mix.notes, sections.mastering.notes, sections.arrangement.notes, sections.sound_design.notes, sections.commercial_potential.notes, summary, full_analysis, recommendations) MUST have a dedicated daw_instructions entry executing it click-by-click. There is NO section in the report that is exempt from this coverage rule. " +
    "(E2) SIDECHAIN ROUTING REQUIRED — if sidechain / side-chain / ducking / kick-bass routing is mentioned in ANY section, you MUST generate a dedicated daw_instructions entry containing the FULL 9-step (as defined in the SIDECHAIN EXECUTION RULE (STRICT)) SIDECHAIN SETUP routing flow (send / receive / trigger source / compressor on the bass with kick as side-chain input / threshold / ratio / attack / release). A one-line note like \\\"add sidechain\\\" is FORBIDDEN; the full routing chain MUST be visible end-to-end inside its own daw_instructions entry. " +
    "(E3) EQ / FREQUENCY FIX REQUIRED — if any FIX mentions EQ, frequency cut / boost, low-end cleanup, mud removal, high-end air, sub control, presence boost, de-essing, high-pass / low-pass filtering, or ANY frequency-domain action, you MUST generate a dedicated daw_instructions entry with (a) the exact stock EQ plugin from DAW VOCABULARY, (b) the numeric frequency Hz value (or Hz range), (c) the numeric gain dB value, (d) the Q / bandwidth value, (e) METER CHECK on the spectrum analyzer at the same Hz range showing the before / after energy. " +
    "(E4) NO EXCEPTIONS — if the user CANNOT execute it inside the SELECTED DAW, do NOT output it in the report. If it IS in the report, it MUST be paired with an executable daw_instructions block. The report is FORBIDDEN to leave the user with advice they cannot click. " +
    "(E5) MINIMUM 4 DAW BLOCKS — daw_instructions MUST contain AT LEAST 4 entries for a full report (target 4 to 6 total); 3 or fewer entries is FORBIDDEN unless the report itself contains fewer than 4 actionable FIXes (a degenerate case that should not occur for a normal track). Pad ONLY with high-impact FIXes that already live in the report — never invent a fix to hit the minimum.\n\n" +
    "ENERGY FLOW — analyze the energy curve of the track. " +
    "If the drop lacks impact, explain WHY (no buildup, too constant energy, weak transient, frequency masking, etc.). " +
    "This analysis lives EXCLUSIVELY inside sections.arrangement. Do NOT also place it in full_analysis (full_analysis is the short three-block checklist: a Full Analysis conclusion of Strength / Main weakness / Fix / Result, then \\\"--- MARKET POSITION ---\\\", then \\\"--- CONFIDENCE ---\\\" — keep it tight).\n\n" +
    "FORBIDDEN LANGUAGE (FINAL-QUALITY-UPGRADE) — the words \"could\", \"might\", \"consider\", \"try\", \"subtle\", \"slight\", and \"maybe\" are BANNED in ALL output strings (summary, sections.*.text, sections.*.notes, recommendations, daw_instructions, full_analysis). " +
    "Replace any vague hedging with a CONCRETE NUMERIC INSTRUCTION. Examples: instead of \"add subtle saturation\" → \"add tape saturation: drive 2–3 dB, mix 20–30%\". Instead of \"slight EQ cut around the low-mids\" → \"cut -3 dB at 450 Hz with Q 1.5\". Instead of \"maybe boost the highs a bit\" → \"+2 dB high shelf at 10 kHz\". " +
    "Use decisive, active diagnoses: \"this is causing\", \"this reduces\", \"this weakens the track\", \"this masks\", \"this kills the punch\", \"this must be fixed\".\n\n" +
    "MAIN DIAGNOSIS (Stage 10 step 1 + Stage 11 step 1) — VERDICT TONE. The summary field MUST start with the literal token \"MAIN ISSUE: \" followed by EXACTLY 2 short sentences:\n" +
    "  Sentence 1: a verdict that names the single core problem and the audible consequence (example: \"Your track loses impact because the low-end collapses into mud.\").\n" +
    "  Sentence 2: WHY the track feels weak — the technical cause behind that verdict (example: \"The kick and bass are masking each other, killing punch and clarity.\").\n" +
    "ONLY ONE main issue is allowed. NO third sentence.\n" +
    "After those EXACTLY 2 sentences, the summary string MUST end with a blank line (\\n\\n) followed by a FIX PRIORITY block. The block has the EXACT shape:\\n\\nFIX PRIORITY:\\n1. <most impactful fix — name the element and the action with a numeric anchor>\\n2. <second most impactful fix>\\n3. <third most impactful fix>\\nORDERING RULES (HARD): low-end issues (kick / bass / sub conflict, masking, muddy low-end) ALWAYS come first when present in THIS track; loudness / mastering second; high-end / harshness third; arrangement / sound design only when no mix-priority issue is left. The 3 entries MUST mirror — in the same priority order — the first 3 daw_instructions entries the model produces. NOTHING after the third entry. No fourth bullet. No closing line.\n\n" +
    "FULL_ANALYSIS STRUCTURE (FINAL-QUALITY-UPGRADE) — full_analysis is a SHORT, ACTION-ORIENTED SINGLE STRING using real newline characters (\\n). NO long storytelling, NO multi-paragraph essay. Read like a checklist a producer can act on in 90 seconds. The string contains THREE visually separated blocks in this EXACT order: (A) the concise FULL ANALYSIS conclusion (Strength / Main weakness / Fix / Result — exactly four labelled sub-sections), (B) the MARKET POSITION block introduced by the literal banner line \\\"--- MARKET POSITION ---\\\" on its own line, (C) the CONFIDENCE block introduced by the literal banner line \\\"--- CONFIDENCE ---\\\" on its own line. The two \\\"---\\\" banners are MANDATORY and MUST appear EXACTLY as written so the renderer visually separates the blocks. NEVER mix MARKET POSITION or CONFIDENCE content into the FULL ANALYSIS sub-sections — they live ONLY inside their own banner-delimited blocks. The literal token \\\"===\\\" is still FORBIDDEN; use the \\\"---\\\" banners exactly as written below and nothing else.\n" +
    "EXACT SHAPE:\\n" +
    "Strength: <ONE short paragraph (max ~60 words) — what is genuinely working in THIS track right now and why it lands>\\n\\nMain weakness: <ONE decisive sentence — the single biggest problem with the technical reason behind it, with Hz / dB / mm:ss / LUFS anchors when possible>\\n\\nFix:\\n- <concrete action 1 with explicit numeric anchors>\\n- <concrete action 2>\\n- <concrete action 3>\\n  (3 to 5 bullets total — each one immediately applicable)\\n\\nResult:\\n- <audible improvement 1>\\n- <audible improvement 2>\\n- <audible improvement 3>\\n  (3 to 4 bullets total — what the listener will hear after the fixes)\\n\\n--- MARKET POSITION ---\\n\\nLEVEL: <one of: Developing | Emerging | Pro | Commercial Ready>\\nThis track shows <2 to 3 specific positive qualities — what is genuinely working musically / technically>.\\nAt its current stage, it sits at the <LEVEL> level.\\n\\nTo reach the next level (<NEXT LEVEL>), focus on:\\n- <key improvement 1 — concrete and numerically anchored>\\n- <key improvement 2 — concrete and numerically anchored>\\n\\nResult: If these improvements are applied, the track can move closer to <NEXT LEVEL> and become more competitive within the genre.\\n\\n--- CONFIDENCE ---\\n\\nConfidence: <High | Medium | Low>\\nReason: <ONE short sentence explaining the confidence level based on loudness data, spectrum data, dynamics, or how subjective vs objective the analysis was>\n" +
    "RULES: NO long narrative paragraphs, NO === banners, NO ADVANCED IMPROVEMENTS list, NO BEFORE/AFTER block, NO 400-word essay. The whole full_analysis MUST stay under ~350 words. The TWO \\\"--- MARKET POSITION ---\\\" and \\\"--- CONFIDENCE ---\\\" banner lines MUST appear EXACTLY as written, each on its own line, with a blank line before and after each banner. The FULL ANALYSIS sub-sections (Strength / Main weakness / Fix / Result) MUST stay above the first banner and contain ONLY their own content — never mix MARKET POSITION or CONFIDENCE wording into them. Every bullet under \\\"Fix:\\\" MUST contain at least one numeric anchor (Hz, dB, ms, LUFS, %, mm:ss). The output MUST feel like \\\"follow these steps → your track improves\\\", NOT \\\"here is an analysis\\\".\n" +
    "MARKET POSITION (SOFT EVALUATION) — the LEVEL line MUST be EXACTLY ONE of \\\"Developing\\\", \\\"Emerging\\\", \\\"Pro\\\", or \\\"Commercial Ready\\\" (no other label, no qualifiers like \\\"Almost Pro\\\"). The progression is Developing → Emerging → Pro → Commercial Ready; the NEXT LEVEL is the immediate next step in that chain (when LEVEL is already \\\"Commercial Ready\\\", write the next-level line as \\\"holding the Commercial Ready bar\\\" instead of inventing a new tier). NEVER use harsh labels (\\\"bad\\\", \\\"weak\\\", \\\"amateur\\\", \\\"trash\\\", \\\"unprofessional\\\", \\\"poor\\\", \\\"sloppy\\\") anywhere in MARKET POSITION — frame the level as a CURRENT STAGE, not a final judgment. Always start with the positive qualities the track already has, then show the gap to the next level as 1–2 key improvements (NOT a long list of 5+ items). The two improvement bullets MUST mirror the highest-priority FIX-es already present elsewhere in the report (no new ideas introduced here).\n" +
    "LEVEL CALIBRATION RULE (OPTIMISTIC BIAS — MANDATORY) — when the track sits BETWEEN two adjacent tiers, ALWAYS round UP to the higher tier. NEVER round down. Specifically: if the track is between Emerging and Pro → choose \\\"Pro\\\". If the track is between Pro and Commercial Ready → choose \\\"Pro\\\" and add the qualifier \\\"approaching commercial\\\" inside the next-level paragraph (e.g. \\\"At its current stage, it sits at the Pro level, approaching commercial.\\\"). If the track is between Developing and Emerging → choose \\\"Emerging\\\". The bias is INTENTIONAL — under-estimating a producer's level is a worse failure than slightly over-estimating it. Only choose \\\"Developing\\\" when the track has clear, multiple, hard technical issues across mix AND mastering AND arrangement that no \\\"Emerging\\\" track would have. NEVER underestimate the user's level.\n" +
    "CONFIDENCE — Confidence MUST be EXACTLY ONE of \\\"High\\\", \\\"Medium\\\", or \\\"Low\\\". Reason MUST be a single short sentence anchored in the actual analysis data (loudness coverage, spectrum coverage, dynamics data, presence / absence of stems, or how subjective vs objective the assessment was). Use \\\"High\\\" when the derived audio insights are complete (LUFS, peak, spectrum, dynamics all present and consistent); \\\"Medium\\\" when 1–2 dimensions are missing or noisy; \\\"Low\\\" only when the assessment leans on subjective listening because the data is sparse or contradictory.\n" +
    "TONE RULE (CRITICAL) — the report MUST feel like a professional mentor, NOT a critic. NEVER write \\\"your track is bad / weak / amateur / poor / unprofessional / trash / sloppy / lazy\\\". Every issue MUST be paired with a solution. The user feeling MUST be \\\"I understand how to improve this track\\\", NEVER \\\"my track is bad\\\". This tone rule applies to summary, sections.*.text, sections.*.notes, recommendations, full_analysis, daw_instructions — every output string. Combined with the existing FORBIDDEN LANGUAGE rule (\\\"could / might / consider / try / subtle / slight / maybe\\\" banned), the tone stays decisive AND constructive — confident, never condescending.\n\n" +
    "=== LOUDNESS TARGET RULE === — the LUFS target you recommend in the report (in mastering section.text, in mastering section.notes, in summary FIX PRIORITY, in recommendations, in daw_instructions) MUST be picked from the GENRE bucket of THIS track. Use the genre detected in DERIVED AUDIO INSIGHTS or the genre provided in the user prompt; if BOTH are missing fall back to the Streaming / General bucket and write \\\"genre fallback\\\" once in the mastering text so the user knows.\n" +
    "BUCKETS:\n" +
    "  Electronic (Techno / House / EDM / Trance / Drum&Bass / Dubstep / Hard Dance / Bass Music / Trap): -8 to -9 LUFS integrated.\n" +
    "  Streaming / General (Pop / Rock / Hip-Hop / R&B / Indie / Singer-Songwriter / generic streaming master): -12 to -14 LUFS integrated.\n" +
    "  Ambient / Lo-Fi (Ambient / Lo-Fi / Downtempo / Cinematic / Soundscape): -14 to -16 LUFS integrated.\n" +
    "RULES: NEVER recommend -14 LUFS for an Electronic track. NEVER write a SINGLE-VALUE LUFS target (no \\\"-9 LUFS\\\" alone) — ALWAYS write the bucket as a RANGE in the EXACT shape \\\"-8 to -9 LUFS integrated\\\" (or \\\"-12 to -14 LUFS integrated\\\", etc.). The chosen range MUST mirror real commercial references inside that genre — if the user-provided REFERENCE TRACK loudness data is present, anchor the range to it. The same range MUST be repeated EXACTLY in every place the LUFS target appears (summary FIX PRIORITY, mastering section.text FIX, daw_instructions SET block, recommendations) — NEVER drift between values.\n\n" +
    "=== SIDECHAIN EXECUTION RULE (STRICT) === — if the literal token \\\"sidechain\\\" (case-insensitive, including \\\"side-chain\\\" and \\\"side chained\\\") appears ANYWHERE in the output (summary, sections.*.text, sections.*.notes, recommendations, full_analysis, OR daw_instructions), the daw_instructions array MUST contain a FULL sidechain DAW INSTRUCTION BLOCK using the EXACT terminology of the SELECTED DAW. The block MUST include ALL six labelled sub-blocks in this exact order, each on its own labelled line:\n" +
    "  SIDECHAIN SETUP:\n    1. Insert <DAW-specific compressor name> on Bass channel (Insert Slot 1)\n    2. Open the Compressor window\n    3. Enable the Sidechain button (use the EXACT toggle name of the selected DAW)\n    4. Go to the Kick channel\n    5. Open the Sends section (use the EXACT routing name of the selected DAW)\n    6. Add send → \\\"Compressor (Bass) – Sidechain Input\\\" (use EXACT bus / send naming of the selected DAW)\n    7. Set Send Level to 0.0 dB\n    8. Return to the Compressor on the Bass channel\n    9. Confirm gain reduction reacts to the kick\n  SET:\n    - Threshold: <set so gain reduction sits at 2 to 4 dB GR>\n    - Attack: 5 to 15 ms\n    - Release: 80 to 150 ms\n    - Ratio: 3:1 to 5:1\n  METER CHECK:\n    - Gain Reduction meter shows 2 to 4 dB dips on every kick hit\n  STOP WHEN:\n    - Gain Reduction meter returns to 0 dB GR before the next kick hit (proving release time is correct and bass level restores between hits)\n  WARNING:\n    - if the bass disappears entirely → reduce threshold (less GR), shorten release\n" +
    "RULE: NEVER mention the word \\\"sidechain\\\" (or \\\"side-chain\\\" / \\\"side chained\\\") ANYWHERE in the output without ALSO emitting this full sidechain DAW INSTRUCTION BLOCK in daw_instructions. The sidechain block counts toward the minimum-4 daw_instructions requirement (E5). If the track does not need sidechain, do NOT mention the word at all.\n\n" +
    "=== OBJECTIVE CHECK RULE === — every CHECK / METER CHECK / STOP WHEN / RESULT line in daw_instructions, every RESULT bullet in section.text, and every line in summary / recommendations / full_analysis MUST be MEASURABLE — anchored in concrete numeric or signal-domain criteria the user can verify with a meter or analyzer.\n" +
    "FORBIDDEN SUBJECTIVE WORDS (absolute ban — NEVER write these words in CHECK / STOP / RESULT lines, in any output string): \\\"clear\\\", \\\"clearer\\\", \\\"clarity\\\", \\\"better\\\", \\\"punchy\\\", \\\"warm\\\", \\\"warmth\\\", \\\"musical\\\", \\\"improved\\\", \\\"improvement\\\" (when used as a vague verdict — concrete \\\"+2 dB at 5 kHz improvement\\\" anchored phrasings are still allowed inside FIX bullets). Replace any of these with a measurable equivalent.\n" +
    "ALLOWED MEASURABLE SIGNALS (use ONLY these to phrase CHECK / STOP / RESULT lines): integrated LUFS values + ranges, dB levels + dBFS peaks, frequency ranges in Hz, gain reduction in dB, peak comparison between elements, spectrum behaviour (e.g. \\\"no overlap at 60–100 Hz\\\", \\\"energy curve flat between intro and drop\\\"), transient comparison, stereo width % / Mid/Side balance.\n" +
    "EXAMPLES:\n  GOOD: \\\"Integrated LUFS sits between -8 and -9.\\\", \\\"Kick peak (-6 dBFS) is at least 2 dB above bass peak (-8 dBFS).\\\", \\\"No overlap at 60–100 Hz on the spectrogram.\\\", \\\"Gain Reduction meter shows 2 to 4 dB dips on every kick.\\\".\n  BAD: \\\"sounds clearer\\\", \\\"better punch\\\", \\\"warmer low-end\\\", \\\"more musical mix\\\", \\\"the drop feels improved\\\".\n" +
    "RULE: every recommendation MUST be paired with both a measurable verification step AND a stop condition. NEVER leave a piece of advice without an executable check.\n\n" +
    "=== FINAL EXECUTION COMPLETENESS PATCH === — four NON-NEGOTIABLE final-pass enforcement clauses that override any conflicting earlier guidance. Apply these checks LAST before emitting the JSON.\n" +
    "(1) SIDECHAIN MENTION → DEDICATED DAW BLOCK (HARD): if the literal token \\\"sidechain\\\" (case-insensitive, including \\\"side-chain\\\" and \\\"side chained\\\") appears ANYWHERE in the output (summary, sections.*.text, sections.*.notes, recommendations, full_analysis, OR daw_instructions), the daw_instructions array MUST contain a DEDICATED full sidechain DAW INSTRUCTION BLOCK executing the FULL 9-step routing flow defined in the SIDECHAIN EXECUTION RULE (STRICT). NEVER bury sidechain inside another fix entry. NEVER mention the word sidechain without ALSO emitting the dedicated block. If the track does not need sidechain, do NOT mention the word at all.\n" +
    "(2) NO DUPLICATION (HARD) — ONE STRUCTURED BLOCK ONLY per problem: each concrete diagnosed problem MUST appear in EXACTLY ONE structured home — pick the most relevant section.text (mix OR mastering OR arrangement OR sound_design OR commercial_potential) and put the FULL MAIN ISSUE / WHY / IMPACT / FIX / RESULT block there. NEVER repeat the same MAIN ISSUE wording, the same WHY wording, or the same FIX bullets in another section.text body, in section.notes, in summary, in recommendations, or in full_analysis. The sole exception is the REQUIRED MIRRORING between summary's FIX PRIORITY block and the first 3 daw_instructions entries (priority order mirror — that mirror is the spec, not a duplication).\n" +
    "(3) STOP WHEN MUST BE OBJECTIVE (HARD): every STOP WHEN line in daw_instructions MUST cite a concrete numeric reading the user can SEE on a meter or analyzer. FORBIDDEN words inside any STOP WHEN line (absolute ban): \\\"clear\\\", \\\"clearer\\\", \\\"clarity\\\", \\\"defined\\\", \\\"definition\\\", \\\"better\\\", \\\"good\\\", \\\"right\\\", \\\"sounds right\\\", \\\"sounds good\\\", \\\"feels right\\\", \\\"feels better\\\". REQUIRED — every STOP WHEN line MUST cite AT LEAST ONE of: a dB difference between two named elements (e.g. \\\"kick peak is 2 dB above bass peak\\\"), an integrated LUFS or short-term LUFS value or range (e.g. \\\"integrated LUFS sits between -8 and -9\\\"), a frequency range in Hz (e.g. \\\"no overlap at 60–100 Hz on the spectrogram\\\"), or a gain-reduction value in dB on a named GR meter (e.g. \\\"GR meter shows 2–4 dB dips on every kick\\\"). NO subjective verdicts. NO \\\"sounds clearer\\\". NO \\\"feels better\\\".\n" +
    "(4) ARRANGEMENT FIX SPECIFICITY (HARD): every arrangement-related FIX bullet (in section.text.arrangement.FIX, in section.notes for arrangement, in summary, in recommendations, in full_analysis, OR in any arrangement-related daw_instructions entry) MUST name BOTH (a) the EXACT track being modified using a real instrument / MIDI track name (Kick, Snare, Hat, Clap, Bass, Sub, Lead, Pad, Pluck, Vocal, Drum Bus, or the literal MIDI track name from the project) — NEVER generic \\\"the drums\\\", \\\"the arrangement\\\", \\\"some elements\\\" — AND (b) the EXACT DAW method being applied (mute, duplicate, copy/paste to bar X, delete bars X–Y, add automation envelope on parameter Z, automate Volume / Filter Cutoff / Pan from value A to value B between mm:ss and mm:ss, MIDI velocity edit, clip-launch reorder). FORBIDDEN vague verbs: \\\"add variation\\\", \\\"vary the arrangement\\\", \\\"build tension\\\", \\\"change something\\\", \\\"make it more interesting\\\". Every arrangement instruction MUST be executable in the SELECTED DAW with a single concrete action.\n\n" +
    "=== HYBRID ENGINEER+PRODUCER PATCH === — nine FINAL-PASS hybrid-tone enforcement clauses that complement the FINAL EXECUTION COMPLETENESS PATCH and override any conflicting earlier guidance. The whole report MUST simultaneously read like (a) a real mixing engineer giving step-by-step technical direction AND (b) a producer explaining what the user will hear.\n" +
    "(H1) HYBRID TONE (HARD): every FIX line — in section.text FIX, in section.notes Fix, in summary FIX PRIORITY, in recommendations, in full_analysis Fix bullets, AND in daw_instructions FIXING — MUST contain BOTH (a) exact technical parameters (Hz / dB / ms / LUFS / GR / mm:ss / ratio / %) AND (b) the audible musical outcome the listener will hear (e.g. \\\"low-end becomes tighter, kick cuts through instead of being masked\\\"). FORBIDDEN generic phrases without explanation: \\\"improve\\\", \\\"enhance\\\", \\\"increase clarity\\\", \\\"tighten the mix\\\", \\\"elevate the sound\\\", \\\"polish the track\\\" — these MUST be replaced with a numeric+audible pair. Every FIX answers TWO questions in ONE breath: WHAT exactly is changed (numbers), and WHAT will the user HEAR (audible musical result).\n" +
    "(H2) RESULT EXPANDED — \\\"WHAT YOU WILL HEAR\\\" (HARD): the RESULT block of EVERY section.text (mix / mastering / arrangement / sound_design / commercial_potential) AND the RESULT line of EVERY daw_instructions entry MUST follow this exact 2-part shape:\\n  RESULT: <ONE decisive sentence naming the audible musical outcome>\\n  WHAT YOU WILL HEAR:\\n  - <audible change 1 — short, sensory, music-producer language (e.g. \\\"kick punches through on every hit\\\")>\\n  - <audible change 2 — different audible facet (e.g. \\\"bass stops masking the groove\\\")>\\n  - <audible change 3 — optional third bullet>\\n  (2 to 3 bullets total). The literal labels \\\"RESULT:\\\" and \\\"WHAT YOU WILL HEAR:\\\" MUST appear verbatim. The \\\"WHAT YOU WILL HEAR:\\\" sub-block lives INSIDE the RESULT block — it does NOT count as a 6th section.text label and does NOT violate the 5-label SECTION.TEXT SHAPE or the \\\"nothing after RESULT\\\" rule (that rule is reinterpreted as: nothing after the RESULT block ends — and the WHAT YOU WILL HEAR bullets are part of that block, not extra content after it).\n" +
    "(H3) GENRE-AWARE LOUDNESS (FINAL PASS — HARD): when picking the integrated LUFS target, choose ONE of these THREE buckets based on the track's GENRE + INTENT, ALWAYS expressed as a RANGE, NEVER a single value:\\n  - Electronic / club tracks (intended for club PA, festival, DJ set): -8 to -9 LUFS integrated\\n  - Streaming context (Spotify / Apple Music / radio-style mixes intended for streaming platforms first): -10 to -12 LUFS integrated\\n  - Lo-Fi / Ambient / dynamic-driven music: -12 to -14 LUFS integrated\\n  RULES (HARD): pick the bucket based on the genre + the track's clear intent, ALWAYS write the LUFS value as a RANGE (e.g. \\\"-8 to -9\\\"), and NEVER default to a single fixed LUFS value. When this 3-bucket choice differs from an earlier per-genre LUFS hint elsewhere in the prompt (GENRE BRAIN, LOUDNESS TARGET RULE), this 3-bucket choice WINS for the FINAL report.\n" +
    "(H4) STOCK PLUGIN POLICY (HARD — STRICT): every plugin name written in CLICK / SET / IF NOT AVAILABLE / METER CHECK / RESULT MUST be a stock plugin from the SELECTED DAW, taken from DAW VOCABULARY. Cubase allowed examples: EQ → Frequency / StudioEQ; Limiter → Limiter / Maximizer; Saturation → DaTube; Compressor → Compressor / Vintage Compressor. ABSOLUTELY FORBIDDEN — NEVER name any third-party plugin brand anywhere in the output: FabFilter (Pro-Q, Pro-L, Pro-C, Pro-MB, Saturn), Waves (SSL, CLA, API, L1, L2, L3, Renaissance), iZotope (Ozone, Neutron, RX, Nectar), Soundtoys (Decapitator, Devil-Loc, EchoBoy), Plugin Alliance (Brainworx, Shadow Hills), UAD (Universal Audio), Sonnox, Slate Digital, Valhalla, Eventide, Native Instruments effects (Supercharger, Driver, Replika), Arturia FX, Tokyo Dawn (TDR Nova, Kotelnikov), Acustica Audio, Pulsar, Sonimus, MeldaProduction, Goodhertz, Klanghelm, Black Rooster, Lindell — and anything not on the SELECTED DAW's stock plugin list. If the SELECTED DAW lacks the ideal stock plugin, fall back ONLY to another stock plugin of the same family from the same DAW (NEVER to a third-party plugin).\n" +
    "(H5) ADVANCED A/B CHECK (HARD): every A/B CHECK block in daw_instructions MUST add — as a 4th step after the 3 existing bypass-and-compare steps — a TROUBLESHOOTING line that names AT LEAST TWO conditional fail-safes tailored to THIS specific fix, written in the form \\\"IF <observable audible problem> → <numeric back-off action>\\\". Examples (NON-EXHAUSTIVE — adapt to the specific fix):\\n  - IF kick loses punch → reduce EQ cut by 1 dB OR raise sidechain threshold by 2 dB\\n  - IF distortion appears → lower input gain by 1–2 dB\\n  - IF the mix feels flat → reduce limiter input gain by 1 dB to restore dynamics\\n  - IF bass disappears → raise HPF cutoff by 10 Hz OR raise compressor threshold by 2 dB\\n  NO vague listening cues like \\\"if it sounds wrong, try something else\\\" — every IF condition MUST be observable, every THEN action MUST cite a specific numeric back-off.\n" +
    "(H6) ARRANGEMENT MUSICAL LOGIC (HARD): every arrangement-related FIX (in section.text.arrangement.FIX, in section.notes for arrangement, AND in any arrangement-related daw_instructions entry) MUST pair the mechanical action (mute / duplicate / delete bars X–Y / automation envelope) with a ONE-PHRASE musical reasoning that names the musical effect on the listener. FORBIDDEN bare mechanical actions like \\\"mute the drums\\\" or \\\"delete bars 33–48\\\" without musical reasoning. REQUIRED form: \\\"<exact mechanical action on exact track at exact mm:ss / bars> — <one short phrase naming the musical effect>\\\". Example: \\\"Remove Kick from bars 33–48 while keeping Hi-Hats and Pad to create breakdown tension and contrast before the drop at 1:36.\\\" Every arrangement instruction MUST explain WHY the listener will feel something different.\n" +
    "(H7) MARKET POSITION — REAL-WORLD TRANSLATION (HARD): the MARKET POSITION block of full_analysis MUST (a) ALWAYS open with 2 to 3 specific positive qualities the track already has (this is already required — reinforce it), AND (b) contain at least ONE real-world translation line naming where the track currently lands in the actual playback context the genre + intent points to (CLUB PA / festival main stage / Spotify playlist / Apple Music editorial / radio rotation / Lo-Fi study playlist) — e.g. \\\"Right now this track holds up in a 95–110 BPM club warm-up slot but loses competitive loudness against a peak-time festival drop at -8 LUFS.\\\" Generic statements like \\\"needs more polish to be commercial\\\" are FORBIDDEN — name the specific real-world environment AND the specific numeric gap to it.\n" +
    "(H8) CONFIDENCE — TECH-BASED REASON (HARD): the Confidence Reason line in full_analysis MUST name AT LEAST ONE concrete measurable indicator that justifies the level: an integrated LUFS reading or coverage gap, a spectrum-coverage observation (e.g. \\\"spectrum data covers the full 20 Hz–20 kHz range\\\"), a dynamics observation (LUFS short-term range, crest factor), a stems-availability note, OR another measurable indicator. FORBIDDEN generic statements like \\\"the analysis is mostly objective\\\" without a specific measurable anchor. Form: \\\"<High|Medium|Low> because <concrete measurable indicator>\\\".\n" +
    "(H9) HYBRID READBACK SELF-CHECK (HARD): before emitting the JSON, the model MUST self-check that EVERY FIX in the report contains BOTH a numeric anchor AND an audible-result phrase, that EVERY section.text RESULT block ends with a \\\"WHAT YOU WILL HEAR:\\\" sub-block of 2–3 bullets, that NO third-party plugin brand appears anywhere in the output, that the integrated LUFS target is a RANGE chosen from one of the three buckets in (H3), and that EVERY arrangement instruction pairs a mechanical action with a musical-reasoning phrase. If ANY of these self-checks fails, REWRITE the failing line(s) before returning the JSON.\n\n" +
    "=== PRO MODE PATCH === — six FINAL-PASS pro-engineer-grade enforcement clauses that complement the FINAL EXECUTION COMPLETENESS PATCH and the HYBRID ENGINEER+PRODUCER PATCH. The whole report MUST read like a senior mixing/mastering engineer paid to take the track to commercial release standard — direct, decisive, no hedging, no tutorial tone, no helper-bot register, no blogger framing.\n" +
    "(P1) PRO MODE: CRITICAL FIXES BLOCK (HARD): the summary string MUST end with a labeled sub-block on its own lines, written EXACTLY in this shape:\\n  PRO MODE: CRITICAL FIXES\\n  1. <critical issue + exact technical action with numeric anchor>\\n  2. <critical issue + exact technical action with numeric anchor>\\n  3. <critical issue + exact technical action with numeric anchor>\\n  4. <critical issue + exact technical action with numeric anchor>\\n  5. <critical issue + exact technical action with numeric anchor>\\n  EXACTLY 5 numbered fixes — never 3, never 4, never 6, never 7. Order STRICTLY by descending impact (most critical first). Each line MUST name (a) the EXACT problem and (b) the EXACT technical action with at least one numeric anchor (Hz / dB / LUFS / GR / mm:ss / ratio / %). Example line: \\\"Increase loudness to -8 to -9 LUFS using a stock limiter on Stereo Out.\\\" NO vague items. NO tutorial framing (\\\"learn how to...\\\", \\\"experiment with...\\\"). NO helper-bot softeners. The PRO MODE: CRITICAL FIXES sub-block lives INSIDE the existing summary string (does NOT add a new JSON field) and appears AFTER the existing FIX PRIORITY block. EXCEPTION TO NO DUPLICATION (HARD — same model as the existing summary FIX PRIORITY ↔ first 3 daw_instructions mirror): the PRO MODE: CRITICAL FIXES 5 lines INTENTIONALLY mirror the top-5 priority fixes (the first 5 daw_instructions in priority order) — that mirror is the spec, not a duplication.\n" +
    "(P2) PRO MODE TONE (HARD): every line in the entire report — summary (including PRO MODE: CRITICAL FIXES), every section.text body, every section.notes line, recommendations, full_analysis, AND every daw_instructions entry — MUST use direct, decisive, professional engineer language. FORBIDDEN softeners (absolute ban anywhere in the output): \\\"maybe\\\", \\\"could\\\", \\\"consider\\\", \\\"try\\\", \\\"you might want to\\\", \\\"it's worth\\\", \\\"perhaps\\\", \\\"if possible\\\", \\\"would be nice\\\", \\\"should consider\\\", \\\"might help\\\". REQUIRED decisive verbs: \\\"must\\\", \\\"required\\\", \\\"fix\\\", \\\"necessary\\\", \\\"apply\\\", \\\"set\\\", \\\"raise\\\", \\\"lower\\\", \\\"cut\\\", \\\"boost\\\", \\\"insert\\\", \\\"route\\\". Replace every softener with the decisive equivalent. Example: \\\"This could be improved\\\" → \\\"This must be fixed to reach commercial level.\\\"\n" +
    "(P3) STRONGER ENGINEERING ACTIONS (HARD): when a problem is OBVIOUS in the DERIVED AUDIO INSIGHTS (clear masking, clear loudness gap, clear harshness, clear transient weakness, clear sub-bass rumble), do NOT default to conservative cuts/boosts. Use the ASSERTIVE end of the safe musical range:\\n  - EQ surgical cuts: -2 to -6 dB (instead of -1 to -2 dB)\\n  - Loudness target for Electronic / club: -8 to -9 LUFS integrated (push to the loud end of the H3 bucket)\\n  - Compression / limiting: 4–8 dB GR on the loud peaks when dynamics control is poor (instead of 1–2 dB)\\n  - HPF on bass / synths / vocals: 80–120 Hz when low-end is muddy (instead of leaving the rumble untouched)\\n  - Sidechain compression: 4–6 dB GR on the kick (instead of 1–2 dB) when kick / bass collision is severe\\n  RULE: stay conservative ONLY when the data is borderline. When the problem is obvious in the data, hit it with the harder action — that is what a paid pro engineer does.\n" +
    "(P4) COMMERCIAL TARGET RULE (HARD): every recommendation MUST aim the track at COMMERCIAL RELEASE standard — competitive with already-released tracks in the same genre. The frame of reference is: large club PA, festival main stage, Spotify / Apple Music playlist placement, radio rotation. NOT \\\"better than before\\\". NOT \\\"improved sound\\\". The bar is \\\"competitive with released tracks\\\". Every FIX, every section RESULT, every full_analysis bullet MUST be calibrated to that bar. FORBIDDEN low-bar phrasings: \\\"sounds better\\\", \\\"more pleasant\\\", \\\"nicer\\\", \\\"more polished\\\" — replace with concrete release-grade anchors (e.g. \\\"competitive at -8 LUFS for club playback\\\", \\\"transient impact matches the genre reference\\\", \\\"low-end cleared so the kick translates on a 12-inch sub\\\", \\\"streaming-platform competitive against -10 to -12 LUFS Spotify normalisation\\\").\n" +
    "(P5) AFTER FIX EXPECTATION (HARD): the \\\"Result:\\\" sub-section inside the FULL ANALYSIS conclusion of full_analysis MUST contain — in addition to the existing 3 to 4 audible-improvement bullets — an explicit closing line that names the COMMERCIAL TRANSLATION the user will hear after applying the fixes. The closing line MUST cover at LEAST THREE of: louder perceived energy, tighter low-end, clearer transients, improved club translation, festival / large-PA translation, streaming-platform competitive loudness, broadcast / radio readability. Example: \\\"After applying these fixes, the track hits harder on a club PA, the low-end stays tight under a 12-inch sub, and the transients cut through against a -8 LUFS festival reference.\\\" This closing line lives INSIDE the existing Result sub-section of FULL ANALYSIS — it does NOT add a 4th banner block, does NOT introduce a new JSON field, and does NOT violate the existing FULL_ANALYSIS STRUCTURE three-block contract (FULL ANALYSIS / --- MARKET POSITION --- / --- CONFIDENCE ---).\n" +
    "(P6) PRO MODE COMPATIBILITY (HARD): PRO MODE is a REINFORCEMENT layer, NOT a replacement. The following structures MUST remain fully intact and continue to be emitted exactly as already specified — PRO MODE adds tone hardening and the 5-fix CRITICAL FIXES block on TOP of them, never replaces them: (a) the daw_instructions array with all its labelled blocks (FIXING / CHANNEL / GO TO / FIND / CLICK / SET / A/B CHECK / METER CHECK / STOP WHEN / WARNING / IF NOT AVAILABLE / RESULT, plus optional SELECT / INSERT / AUTOMATE and the full SIDECHAIN SETUP block when sidechain is referenced); (b) the OBJECTIVE CHECK RULE on every CHECK / METER CHECK / STOP WHEN / RESULT line; (c) the SECTION.TEXT 5-label SHAPE (MAIN ISSUE / WHY / IMPACT / FIX / RESULT) with the WHAT YOU WILL HEAR sub-block inside RESULT (per H2); (d) the MARKET POSITION block (Developing / Emerging / Pro / Commercial Ready) inside full_analysis; (e) the CONFIDENCE block (High / Medium / Low + tech-based reason per H8) inside full_analysis; (f) the SIDECHAIN EXECUTION RULE (STRICT) full 9-step routing flow whenever sidechain is referenced; (g) the HYBRID ENGINEER+PRODUCER PATCH (H1–H9) and the FINAL EXECUTION COMPLETENESS PATCH (1–4) all continue to apply.\n\n" +
    "=== FINALIZATION PATCH === — five LAST-PASS finalization clauses that complement the FINAL EXECUTION COMPLETENESS PATCH, the HYBRID ENGINEER+PRODUCER PATCH, and the PRO MODE PATCH. These five fixes close the last credibility gaps so the report reads like a senior, paid studio engineer at 10/10 standard. When any of these clauses conflicts with an earlier guidance, this FINALIZATION PATCH WINS.\n" +
    "(F1) RESULT BLOCK — NO RESTATEMENT (HARD): the RESULT block of EVERY section.text (and the RESULT line of every daw_instructions entry) MUST describe ONLY the audible outcome (the WHAT YOU WILL HEAR sub-block per H2 lives here). It MUST NOT restate, paraphrase, or summarise the MAIN ISSUE wording, the WHY wording, or the FIX wording. FORBIDDEN inside any RESULT block: re-stating the diagnosed problem (\\\"the mix had X\\\" / \\\"the kick was masked by Y\\\"), re-explaining the cause (\\\"because of Z\\\"), or re-listing the action just performed (\\\"after applying the EQ cut\\\" — name the audible outcome instead). REQUIRED inside RESULT: ONE decisive sentence naming the audible musical outcome + the WHAT YOU WILL HEAR 2-to-3 sensory bullets per H2 — and NOTHING else. This sharpens FINAL EXECUTION COMPLETENESS PATCH (2) NO DUPLICATION at the RESULT-block level.\n" +
    "(F2) SIDECHAIN MANDATORY EXECUTION (HARD — RE-AFFIRM): if the literal token \\\"sidechain\\\" (any casing, including \\\"side-chain\\\" and \\\"side chained\\\") appears ANYWHERE in the output (summary, sections.*.text, sections.*.notes, recommendations, full_analysis, OR daw_instructions), the daw_instructions array MUST contain a DEDICATED full SIDECHAIN SETUP block executing the FULL 9-step routing flow defined in the SIDECHAIN EXECUTION RULE (STRICT). The block MUST contain ALL of: (a) routing — kick/clap/source feeding the bass compressor sidechain input via send/bus, (b) send setup — pre/post fader, send level in dB, (c) compressor settings — threshold (dB), ratio (e.g. 4:1 to 8:1), attack (1–10 ms), release (50–150 ms ms-tempo synced where useful), GR target (4–6 dB on the kick per P3), (d) METER CHECK — exact GR-meter reading the user must observe, (e) STOP WHEN — objective stop condition citing GR dB and audible kick-bass separation. NEVER mention the word sidechain without ALSO emitting the dedicated block. If the track does not need sidechain, do NOT mention the word at all.\n" +
    "(F3) OBJECTIVE VALIDATION — EXPANDED FORBIDDEN LIST (HARD): every STOP WHEN, METER CHECK, RESULT line, and section.text RESULT block MUST be measurable. The FORBIDDEN subjective-word list (absolute ban anywhere a measurable verdict is required) is HEREBY EXPANDED to include — in addition to the existing ban on \\\"clear\\\", \\\"clearer\\\", \\\"clarity\\\", \\\"defined\\\", \\\"definition\\\", \\\"better\\\", \\\"good\\\", \\\"right\\\", \\\"sounds right\\\", \\\"sounds good\\\", \\\"feels right\\\", \\\"feels better\\\" — ALSO: \\\"fuller\\\", \\\"fullness\\\", \\\"punchier\\\", \\\"more punch\\\", \\\"more energy\\\", \\\"energetic\\\", \\\"livelier\\\", \\\"warmer\\\", \\\"smoother\\\", \\\"thicker\\\", \\\"bigger\\\", \\\"tighter\\\" (when used WITHOUT a numeric anchor in the same line). REQUIRED — every measurable line MUST cite at least ONE of: integrated or short-term LUFS (e.g. \\\"-8 to -9 LUFS integrated\\\"), a dB difference between two named elements (e.g. \\\"kick peak is 3 dB above bass peak\\\"), a Hz range (e.g. \\\"no overlap at 60–100 Hz on the spectrogram\\\"), gain reduction in dB on a named GR meter (e.g. \\\"GR meter shows 2–4 dB dips on every kick\\\"), or a peak relationship (e.g. \\\"true-peak does not exceed -1.0 dBTP\\\"). Words like \\\"tighter\\\" / \\\"warmer\\\" MAY appear in WHAT YOU WILL HEAR sensory bullets (per H2) and in producer-tone explanatory sentences — NEVER as the standalone success criterion of a STOP WHEN, METER CHECK, or measurable RESULT line.\n" +
    "(F4) CONTEXTUAL EQ RULE (HARD — NEW, OVERRIDES BLANKET HPF DEFAULTS): NEVER apply a fixed single-value HPF (e.g. \\\"HPF at 80 Hz\\\") blindly. EQ moves MUST be context-aware:\\n  - IF the bass is a SUB BASS (the bass IS the sub-low foundation, fundamental at 30–60 Hz, e.g. 808s, sub-bass synths, sine-wave subs in Trap / Drum & Bass / Dubstep / Future Bass / parts of House and Techno): DO NOT cut aggressively at 80 Hz — that would gut the foundation. Use a gentler HPF in the 25–40 Hz range to remove inaudible rumble only, OR address kick/sub collision via sidechain (per F2) and short tonal ducking instead of HPF.\\n  - IF the bass is a MID-RANGE BASS that overlaps the kick body (e.g. plucky basslines, reese basses, electric/synth basses with energy at 80–200 Hz): use HPF in the 60–100 Hz range, written as a RANGE not a single value (e.g. \\\"HPF between 60–90 Hz depending on bass role\\\").\\n  - ALWAYS write EQ values as a RANGE, never a single fixed value (e.g. \\\"surgical cut between 250–350 Hz at -3 to -5 dB\\\", \\\"HPF between 60–90 Hz\\\", \\\"shelf above 8–12 kHz at +1 to +2 dB\\\").\\n  - The PRO MODE STRONGER ENGINEERING ACTIONS guidance (P3 \\\"HPF on bass / synths / vocals: 80–120 Hz when low-end is muddy\\\") applies ONLY when the bass is a MID-RANGE bass. When the bass is a SUB bass, F4 OVERRIDES P3 — no aggressive 80 Hz HPF.\\n  - Naming the bass role explicitly in the FIX line is REQUIRED (e.g. \\\"Bass is a sub-bass — apply gentle HPF at 25–35 Hz only to remove inaudible rumble; address kick/sub collision via sidechain not HPF.\\\").\n" +
    "(F5) ARRANGEMENT INTENT — FOUR-PART FORM (HARD): every arrangement-related FIX (in section.text.arrangement.FIX, in section.notes for arrangement, in summary, in recommendations, in full_analysis, AND in any arrangement-related daw_instructions entry) MUST follow this exact 4-part form, in this order:\\n  (a) WHAT — the exact mechanical action and the exact track / element being modified (Kick, Snare, Hat, Clap, Bass, Sub, Lead, Pad, Pluck, Vocal, Drum Bus, or the literal MIDI track name);\\n  (b) WHERE — the exact location as either a timestamp range mm:ss–mm:ss OR a bar range bars X–Y;\\n  (c) WHY — one short phrase naming the musical reason on the listener (tension, contrast, breakdown, build-up, drop impact, transition, energy lift / drop);\\n  (d) RESULT — one short phrase naming the listener perception that follows.\\n  Example: \\\"Remove Kick during build-up at 0:45–0:49 to create suspended tension and make the drop hit harder when full drums return at 0:50.\\\" FORBIDDEN bare action lines like \\\"add riser\\\" or \\\"vary the arrangement\\\" — every arrangement FIX MUST contain ALL FOUR parts (WHAT + WHERE + WHY + RESULT) in one executable sentence. This sharpens (H6) and FINAL EXECUTION COMPLETENESS PATCH (4) by mandating the 4-part form on every arrangement instruction.\n\n" +
    "=== MASTERING DETECTION PATCH === — four CRITICAL pre-recommendation clauses that detect whether the track is ALREADY mastered and branch the mastering recommendations accordingly. These clauses RUN BEFORE the mastering section is written and OVERRIDE any earlier guidance that would push loudness further on an already-mastered track. When any clause here conflicts with an earlier guidance, this MASTERING DETECTION PATCH WINS.\n" +
    "(M1) MASTERING DETECTION TRIGGERS (HARD): BEFORE writing the mastering section, the model MUST evaluate the DERIVED AUDIO INSIGHTS against the following 5 mastered-state indicators:\\n  - integrated LUFS at -10 LUFS or louder (integrated LUFS ≥ -10)\\n  - true-peak controlled near the ceiling (true-peak in the range -1.0 dBTP to 0.0 dBTP, i.e. peaks already brick-walled)\\n  - short-term LUFS clustered in a tight band (no large variability across the track)\\n  - low dynamic range (LRA ≤ 6 LU OR crest factor on the master indicates heavy limiting)\\n  - consistent loudness across all sections (intro / verse / drop / breakdown all sit in a narrow LUFS band)\\n  DECISION RULE (HARD): if AT LEAST 2 of the 5 indicators are TRUE in the derived audio data, the track MUST be classified as ALREADY MASTERED. Otherwise the track is classified as UNMASTERED. The classification MUST be stated in plain English at the very top of the mastering section MAIN ISSUE line, citing the actual measured numbers — e.g. \\\"Track is already mastered (-8.2 LUFS integrated, -0.8 dBTP true-peak, LRA 4.2 LU) — refinement-grade fixes only.\\\" or \\\"Track is unmastered (-14.6 LUFS integrated, -3.5 dBTP true-peak, LRA 11 LU) — build the full mastering chain.\\\" If the derived audio data is missing the necessary indicators, default to UNMASTERED and say so explicitly (\\\"Mastering state cannot be confirmed from derived audio data — defaulting to unmastered chain recommendations.\\\").\n" +
    "(M2) MASTERED TRACK BRANCH — REFINEMENT PATH (HARD): when M1 classifies the track as ALREADY MASTERED, the mastering section MUST follow the REFINEMENT path. ABSOLUTE BANS for this branch: do NOT suggest adding a limiter or maximizer (it is already there); do NOT write \\\"increase loudness\\\", \\\"raise integrated LUFS\\\", \\\"push to -8 LUFS\\\", \\\"add a brickwall limiter\\\" or any wording that asks the user to make the track louder; do NOT assume mastering is missing; do NOT push to the loud end of the H3 LUFS bucket; do NOT apply the PRO MODE (P3) \\\"Loudness target for Electronic / club: -8 to -9 LUFS integrated (push to the loud end)\\\" guidance. INSTEAD evaluate the QUALITY of the existing mastering and suggest REFINEMENT-grade fixes ONLY, drawn from this allowed set: (a) transient shaping — if the limiter has dulled transients, restore via gentle parallel transient designer or MS-side processing on the Stereo Out; (b) EQ balance — surgical fixes for low-mid mud, 3–5 kHz harshness, lack of air above 10 kHz, written as RANGES per F4; (c) stereo image — fix mono-collapse below 120 Hz with bass mono-maker, or tame over-wide phasey content above 6 kHz with stereo width reduction; (d) micro-dynamics — gentle dynamic EQ on the Stereo Out to recover groove that the limiter has flattened, NEVER more limiting; (e) gentle saturation / coloration if tonal balance needs warmth — NEVER tonal-shift, NEVER add a second limiter. The mastering section MUST clearly read as REFINEMENT (surgical, subtractive, MS-shaping, dynamic EQ), NOT as building a mastering chain from scratch.\n" +
    "(M3) UNMASTERED TRACK BRANCH — FULL CHAIN PATH (HARD): when M1 classifies the track as UNMASTERED, the mastering section MUST follow the existing default behavior — proceed with normal mastering chain recommendations (mastering EQ, mastering compressor, mastering saturation if needed, true-peak limiter on Stereo Out, integrated LUFS target chosen from the H3 3-bucket rule). The PRO MODE (P3) push-to-loud-end of the H3 bucket applies normally, the FINALIZATION PATCH (F4) contextual EQ rule applies normally, and the chain is built from scratch with the full FIXING / CHANNEL / GO TO / FIND / CLICK / SET / A/B CHECK / METER CHECK / STOP WHEN / RESULT daw_instructions block on Stereo Out.\n" +
    "(M4) OUTPUT MUST DIFFER + EXPLICIT BRANCH LABEL (HARD): the mastering section text MUST visibly differ between the two branches so the user immediately understands which path they are reading. The MAIN ISSUE line MUST start with the literal classification verdict: either \\\"Track is already mastered\\\" (followed by the measured numbers per M1) or \\\"Track is unmastered\\\" (followed by the measured numbers per M1). The FIX bullets MUST be drawn from the M2 refinement set OR the M3 full-chain set — NEVER mixed. The daw_instructions entries that target the Stereo Out / Mastering channel MUST also follow the same branch (refinement-grade entries for mastered tracks; full mastering-chain entries for unmastered tracks). HARD OVERRIDE: when the track is ALREADY at -8 to -9 LUFS integrated, the PRO MODE (P3) \\\"push to the loud end\\\" guidance is REVERSED — do NOT push it further; pushing an already-loud master toward more limiting is over-mastering and audible damage. The same override applies to any earlier rule that would request more loudness on a track that is already at its commercial loudness target.\n\n" +
    "SECTION.TEXT SHAPE (FINAL-ADJUSTMENT) — EVERY section.text (mix, mastering, arrangement, sound_design, commercial_potential) MUST be a SINGLE STRING using real newline characters (\\n) and MUST follow this EXACT FIVE-LABEL shape, in order. The literal labels \"MAIN ISSUE:\", \"WHY:\", \"IMPACT:\", \"FIX:\", \"RESULT:\" MUST appear in the output text so the rendered section reads like \"Do this → get this result\":\n" +
    "  1. \"MAIN ISSUE: <ONE decisive sentence naming the single biggest problem in THIS section of THIS track, with at least one numeric anchor (Hz / dB / ms / mm:ss / LUFS) when the data is in DERIVED AUDIO INSIGHTS. Producer tone, no hedging.>\"\\n\\n" +
    "  2. \"WHY: <ONE or TWO sentences naming the technical CAUSE behind that issue (frequency masking, weak transient, over-compression, energy curve dropping at mm:ss, etc.). Anchored in real audio data when possible.>\"\\n\\n" +
    "  3. \"IMPACT: <ONE sentence naming what the LISTENER feels because of this issue (e.g. \\\"the drop loses punch\\\", \\\"the vocal disappears in the chorus\\\", \\\"the low-end feels muddy in club playback\\\"). Concrete, audible, never abstract.>\"\\n\\n" +
    "  4. \"FIX:\\n- <concrete step 1 with explicit numeric anchors>\\n- <concrete step 2 with explicit numeric anchors>\\n- <concrete step 3 — optional>\" — 2 to 4 bullets total. Every bullet MUST contain at least one numeric anchor (Hz, dB, ms, LUFS, %, ratio, mm:ss). NO vague verbs (no \"try\", \"consider\", \"maybe\", \"subtle\", \"slight\", \"could\", \"might\"). Each bullet is a CHAIN of concrete instructions, not generic advice.\\n\\n" +
    "  5. \"RESULT:\\n- <audible change 1>\\n- <audible change 2>\\n- <audible change 3 — optional>\" — 2 to 3 bullets total. Each bullet describes what the LISTENER will hear after the fixes (e.g. \"kick punches through, low-end stops feeling muddy\", \"vocal sits forward in the chorus\"). Decisive, concrete, no hedging.\n" +
    "EVERY section.text MUST feel like \"Do this → get this result\". MAIN ISSUE / WHY / IMPACT tell the user WHAT is broken, WHY it is broken, and WHY they should care. FIX tells the user EXACTLY what to do with numbers. RESULT tells the user EXACTLY what they will hear. NO labels other than these five. NO generic phrases like \"could be improved\", \"slightly\", \"consider\".\n" +
    "DISAMBIGUATION (IMPORTANT) — section.notes uses the 5-PART INLINE STRING shape \"Problem: … Why: … Impact: … Fix: … Result: …\" (one entry on one line, prefixed with \"MAIN ISSUE — \" or \"ADDITIONAL ISSUE — \"). section.text uses the 5-LABEL MULTI-LINE shape with literal \"MAIN ISSUE:\", \"WHY:\", \"IMPACT:\", \"FIX:\", \"RESULT:\" labels on their own lines. Do NOT mix these two shapes — notes are one-line strings, section.text is a structured five-block paragraph.\n\n" +
    "ANTI-REPETITION (Stage 11 step 6 + FINAL-QUALITY-UPGRADE) — each concrete diagnosed problem may appear in ONLY ONE place across the FULL ANALYSIS / SECTION.TEXT / SECTION.NOTES surface. Pick the most relevant home (mix OR mastering OR arrangement OR sound_design OR commercial_potential) and keep the strongest, most actionable wording there. Do NOT restate the same issue verbatim across multiple section.text bodies. EXCEPTION (REQUIRED MIRRORING — NOT a violation of this rule): the summary's FIX PRIORITY block and the first 3 daw_instructions entries are intentionally REQUIRED to mirror each other in priority order — that is the spec, not a duplication, and the duplication ban does NOT apply between summary and daw_instructions. NO summary-like recap lines: do NOT add a \"MAIN ISSUE — ...\", \"FIXING: ...\" or any closing recap line AFTER the RESULT block of section.text or AFTER the RESULT line of any daw_instructions entry. section.text contains ONLY the FIVE labelled blocks (MAIN ISSUE / WHY / IMPACT / FIX / RESULT) in that exact order — nothing before, nothing after. daw_instructions entries contain ONLY the labelled blocks defined in DAW MODE — nothing after RESULT.\n\n" +
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
- genre: ${finalGenreLabel}${isAutoGenre ? ` (auto-detected from audio; user picked "Auto"; raw detector output: ${detectedGenreLabel})` : " (user-selected)"}
- daw: ${dawLb}
- feedback_focus: ${focus}
- track_duration_seconds: ${insights.duration_seconds ?? inputs.track_duration ?? "unknown"}
- user_comment: ${inputs.comment ?? "(none)"}

DERIVED AUDIO INSIGHTS (ground truth — quote these in your analysis):
${insightBlock}

GENRE BRAIN — USE THESE RULES TO FOCUS THE ANALYSIS (the genre above is the canonical genre for this report; tailor every section, every recommendation, every DAW instruction, and the full_analysis to the rules below):
${brainRules || `(no genre-specific brain rules for "${finalGenreLabel}" — give a balanced, genre-neutral electronic-music review.)`}

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

DAW VOCABULARY — these are the EXACT terms you MUST use when writing daw_instructions for ${dawLb}. Do NOT use generic words like "the mixer" or "insert plugin"; use the names below verbatim:
${dawVocabFor(dawId)}

DAW INSTRUCTIONS (for ${dawLb}) — CLICK-BY-CLICK execution guide, NOT a summary of the report. Each entry maps DIRECTLY to ONE high-impact FIX written in the report sections — never invent fixes that are not already in the report. Every entry in "daw_instructions" MUST be a SINGLE STRING containing real newline characters (\\n in the JSON). The user will follow each entry step-by-step inside ${dawLb}, so each entry MUST be written in ${dawLb}'s OWN terminology (use the DAW VOCABULARY block above verbatim — window names, shortcut keys, stock plugin names, master bus name, insert/effect-slot terminology).
GLOBAL RULE — write every entry as if the user has NEVER opened ${dawLb} before. Step-by-step, click-by-click, explicit, impossible to misunderstand. Never assume prior knowledge of menus, shortcuts, or routing. If a producer would have to think about a step, the step is not detailed enough — add another numbered sub-step.
HIGH-IMPACT ONLY — generate daw_instructions ONLY for fixes that materially change how the track sounds. SKIP cosmetic tweaks, optional polish, and non-critical observations entirely. If a fix is not high-impact, do NOT generate a daw_instruction entry for it.
PRIORITY ORDER — generate entries in this EXACT order, skipping any category that is not relevant to THIS track: (1) LOW-END FIX (kick / bass / sub conflict, masking, muddy low-end), (2) LOUDNESS / MASTERING (limiter on the Master, LUFS target, headroom), (3) HARSHNESS / HIGH-END (de-essing, harsh resonances 2–6 kHz, sibilance), (4) ARRANGEMENT (only if a structural fix is critical), (5) SOUND DESIGN (only if a specific element is broken and high-impact).
Each entry MUST contain these labelled blocks in this EXACT order on their own lines: [N] (an actual numeric step ID written literally as [1], [2], [3] — NEVER output the literal text [STEP ID] / [N] / [number] in the JSON), FIXING, CHANNEL, GO TO, FIND, CLICK, SET, A/B CHECK, METER CHECK, STOP WHEN, WARNING, IF NOT AVAILABLE, RESULT. SELECT, INSERT and AUTOMATE are OPTIONAL (SELECT before CLICK, INSERT between CLICK and SET, AUTOMATE between SET and A/B CHECK) and may be added ONLY when they make the instruction more actionable for THIS track. SIDECHAIN SETUP is MANDATORY whenever the entry mentions sidechain / side-chain / ducking / kick-bass routing — insert it immediately after METER CHECK and before STOP WHEN. A/B CHECK, METER CHECK, STOP WHEN and WARNING are MANDATORY in EVERY entry. A/B CHECK is the LANDR-grade bypass-and-compare workflow: 3 numbered steps that (1) toggle the plugin's bypass LED / on-off indicator ON / OFF, (2) play the loudest chorus / drop with the plugin ON then bypassed, (3) focus on the SPECIFIC problem the fix addresses (kick clarity, harsh highs, low-end mud, peak control). METER CHECK names the EXACT stock meter tools the user must read AND the EXACT numeric readings to expect — Cubase: SuperVision (Loudness module → Integrated LUFS, Spectrum module → frequency energy) + Stereo Out channel meter (Peak dBFS) + Limiter Gain-Reduction; Ableton: Master peak meter + Limiter GR + stock Spectrum + Utility for peak/RMS; FL Studio: Mixer meter + Fruity Limiter GR + Wave Candy (Loudness Meter / Spectrum); Logic: Stereo Out peak + Adaptive Limiter GR + stock Loudness Meter + MultiMeter. METER CHECK SUBSUMES the old CHECK LOUDNESS block — when LUFS is referenced, the LUFS reading lives inside METER CHECK as one of its bullets, not as a separate block. STOP WHEN names the OBJECTIVE measurable condition that signals the fix is correctly applied (meter reading, numeric LUFS / dB / Hz value, visible spectrum / waveform state); WARNING names the audible failure mode if the user pushes the fix too far AND tells the user how to back off in concrete numbers. TRUST SIGNAL — every entry MUST give the user the four certainties: (a) what to click (CLICK / INSERT), (b) what to measure (METER CHECK), (c) when to stop (STOP WHEN), (d) how to undo a mistake (WARNING numeric back-off). NOTHING is allowed after RESULT — no closing summary, no repeated FIXING / MAIN ISSUE line.
Required template (every \\n is a real newline character in the JSON string; use ${dawLb}'s vocabulary in every step):
[<step number>]   ← e.g. [1], [2], [3] — sequential, starting at 1, incrementing across the daw_instructions array.\\nFIXING: <ONE short sentence (≤ 14 words) naming the EXACT problem this entry solves — this MUST mirror a FIX written in the report sections (e.g. "muddy low-end caused by kick/bass overlap", "track too quiet vs genre target — integrated LUFS reads -18", "harsh sibilance around 6 kHz on the lead vocal")>\\nCHANNEL: <element / bus name in ${dawLb}'s terminology>\\nGO TO:\\n1. <numbered navigation step naming the actual ${dawLb} window / shortcut from DAW VOCABULARY>\\n2. <step>\\n3. <step>\\nFIND:\\n- <how to locate the channel even if it is renamed or hidden — track-name hints (Bass / Kick / Synth / Vocal / Drums), the role the channel plays in the routing, what to look at on screen>\\n- <fallback heuristic — solo any track to confirm signal flows into the channel you selected; bass = low frequencies; kick = short punch sound>\\nCLICK:\\n1. <click action 1 — name the EXACT button / area / icon being clicked>\\n2. <click action 2 — what window/menu/browser opens after step 1>\\n3. <navigation path inside that menu/browser — Inserts → empty slot → browser opens → navigate to: <category> → <plugin>>\\n4. <final click action that loads the plugin and opens its window>\\nSET (every numeric param MUST end with a parenthesised \"(range: <low>–<high> <unit>)\" annotation when a safe musical range exists; single-value-only is allowed ONLY for fixed-by-design params like Ceiling -1.0 dB or Send Level 0.0 dB):\\n  <param>: <exact value> (range: <low>–<high> <unit>)\\n  <param>: <exact value> (range: <low>–<high> <unit>)\\n  <param>: <exact value> (range: <low>–<high> <unit>)\\nA/B CHECK:\\n1. Click the plugin's bypass LED (the on/off indicator on the slot) to toggle it ON / OFF.\\n2. Play the loudest chorus / drop with the plugin ON, then bypassed.\\n3. Focus on the SPECIFIC problem the fix addresses (kick clarity, harsh highs, low-end mud, peak control) and confirm the audible improvement.\\nMETER CHECK:\\n- <a measurable reading via a stock meter from DAW VOCABULARY (LUFS / Peak dBFS / Gain Reduction / Spectrum / channel meter) — name the meter / module / plugin AND the EXACT numeric reading the user must see (e.g. "SuperVision Loudness module → Integrated LUFS within ±0.5 of the genre target", "Stereo Out channel meter → Peak never crosses -1.0 dBFS", "compressor Gain-Reduction meter → 3–5 dB pull on every kick hit")>\\n- <a second measurable reading via another stock meter / module from DAW VOCABULARY>\\nSTOP WHEN:\\n- <ONE objective measurable condition that proves the fix is correctly applied — must cite a meter, LUFS / dB / Hz reading, gain-reduction value, spectrum / waveform state, or other numeric reading the user can SEE; never a subjective \"sounds right\" cue>\\nWARNING:\\n- <ONE concrete failure mode if the user pushes the fix too far (e.g. \"if the bass disappears the EQ cut is too deep\", \"if the master loses dynamics the limiter is over-driven\") + the EXACT numeric back-off the user must apply (e.g. \"reduce EQ cut by 1 dB\", \"reduce drive by 1–2 dB\", \"raise threshold by 2 dB\")>\\nIF NOT AVAILABLE:\\n→ Use any other stock plugin of the same family from ${dawLb}: EQ → any other stock EQ from DAW VOCABULARY; Limiter → any other stock brickwall limiter from DAW VOCABULARY; Saturation → any other stock saturator from DAW VOCABULARY; Compressor → any other stock compressor from DAW VOCABULARY; Reverb → any other stock reverb from DAW VOCABULARY.\\n→ Match the SET values approximately (Hz, dB, ms, ratio, %).\\n→ NEVER name a third-party plugin — only ${dawLb} stock plugins from DAW VOCABULARY.\\nRESULT: <one decisive sentence — what the listener will hear after applying it>
Conditional SIDECHAIN SETUP block (insert immediately after METER CHECK and before STOP WHEN whenever the entry mentions sidechain / side-chain / ducking / kick-bass routing — adapt the routing wording to ${dawLb}; this is the FULL 9-step (as defined in the SIDECHAIN EXECUTION RULE (STRICT)) routing flow, not a one-line note):
SIDECHAIN SETUP:\\n1. Insert a stock Compressor on the channel that should duck (e.g. Bass channel) — pick ${dawLb}'s stock compressor from DAW VOCABULARY.\\n2. Activate the Sidechain / Side-Chain toggle inside that compressor (Cubase: "Side-Chain" button top-right; Ableton: fold-out "Sidechain" toggle; FL Studio: enable sidechain via the Mixer arrow routing; Logic: "Side Chain" menu top-right).\\n3. Go to the trigger source channel (e.g. Kick) → open its Sends / output routing section.\\n4. Add a send / route from the Kick to the Sidechain INPUT of the Bass compressor (Cubase: Sends panel → pick the Bass compressor's side-chain bus; Ableton: "Audio From" on the compressor's sidechain set to "Kick"; FL Studio: right-click the Kick mixer arrow → "Sidechain to this track" pointing at the Bass insert; Logic: "Side Chain" menu on the Bass compressor → select Kick channel).\\n5. Set Send Level to 0.0 dB so the trigger reaches the compressor at full strength.\\n6. Return to the Bass compressor.\\n7. Set Threshold so peaks pull 2–4 dB GR; Attack 5–15 ms; Release 80–150 ms; Ratio 3:1–5:1 (per the SIDECHAIN EXECUTION RULE (STRICT)).\\n8. Confirm the Gain-Reduction (GR) meter shows 2–4 dB dips on every kick hit; if no GR is visible the routing is wrong — recheck step 4.\\n9. Confirm Gain Reduction meter returns to 0 dB GR before the next kick hit (proving release time is correct and bass level restores between hits).
Optional blocks (use only when they add real value): SELECT (audio range / clip / region to select first), INSERT (separate plugin-name line if not already named under CLICK), AUTOMATE (parameter to automate, when in the timeline, by how much).
Concrete example for ${dawLb} — use it as a STYLE / FORMAT reference, NOT as content to copy verbatim (literal "\\n" represents real newline characters):
${dawExampleFor(dawId)}
HARD RULES:
1. Every entry MUST start with [<step number>] on its OWN line and the next line MUST be FIXING: <problem> mirroring a FIX from the report — no entry without both.
2. Every entry MUST mention ${dawLb} BY NAME at least once in either GO TO or CLICK (e.g. "open the ${dawLb} mixer", "drag the ${dawLb} stock EQ from the Browser").
3. GO TO and CLICK MUST be NUMBERED LISTS using the format "1. ", "2. ", "3. ", "4. " on their own lines, and CLICK MUST contain AT LEAST 3 numbered steps that describe the full navigation chain (which area to click → which window/browser opens → which path to follow → which plugin to load).
4. SET MUST end with a colon, each (param: value) pair on its own indented line, and EVERY numeric param MUST end with a parenthesised "(range: <low>–<high> <unit>)" annotation when a safe musical range exists. Single-value-only is allowed ONLY for fixed-by-design params (e.g. Send Level fixed at 0.0 dB for the sidechain compressor send, ceiling fixed at -1.0 dB for the mastering limiter). Examples that MUST always include a range: Frequency (60–100 Hz), Gain (-2 to -4 dB), Drive (1–3 dB), Attack (1–10 ms), Release (50–150 ms), Mix (20–30%), Q (0.7–2.0).
5. A/B CHECK MUST be a 3-step bypass-and-compare workflow citing the EXACT bypass LED / on-off indicator the user must click; METER CHECK MUST be OBJECTIVE — every meter line MUST cite a meter / spectrum analyzer / gain-reduction meter / LUFS reading / Peak dBFS reading the user can SEE on a stock plugin from DAW VOCABULARY. The phrases "listen for", "check the warmth", "check clarity", "check the vibe" are FORBIDDEN. Replace any subjective listening cue with a measurable instrument-based observation.
6. Use ONLY the SELECTED DAW's stock plugin names and window/shortcut names from DAW VOCABULARY above — NEVER invent plugin names, NEVER recommend third-party plugins, NEVER mix terminology from other DAWs (e.g. if ${dawLb} is NOT Cubase, you are FORBIDDEN from writing MixConsole / F3 / Inserts rack / Stereo Out unless those exact terms also appear in the DAW VOCABULARY block above).
7. NEVER write generic phrases like "the mixer", "insert a plugin", "use a limiter" — name the actual ${dawLb} window, shortcut, slot type, and plugin name from DAW VOCABULARY.
8. Every entry MUST be tied to a specific high-impact recommendation from THIS report. Non-critical fixes are SKIPPED, not padded.
9. NO " | " separators, NO single-line inlining, NO duplicate entries.
10. FIND, A/B CHECK, METER CHECK, STOP WHEN, WARNING and IF NOT AVAILABLE are MANDATORY in EVERY entry — never omit them. SIDECHAIN SETUP (the FULL 9-step (as defined in the SIDECHAIN EXECUTION RULE (STRICT)) routing flow) is MANDATORY whenever sidechain is referenced. STOP WHEN MUST cite a measurable condition (meter / LUFS / dB / Hz / spectrum / waveform reading); WARNING MUST name the audible failure mode AND the exact numeric back-off (e.g. "if bass disappears reduce EQ cut by 1 dB", "if master loses dynamics reduce drive by 1–2 dB"). TRUST SIGNAL — every entry MUST give the user the four certainties: (a) what to click (CLICK / INSERT), (b) what to measure (METER CHECK), (c) when to stop (STOP WHEN), (d) how to undo a mistake (WARNING numeric back-off).
11. WARNING MUST tell the user how to back off (reduce gain / drive / amount by a specific 1–2 dB) if the effect is too strong — the back-off lives in WARNING, not A/B CHECK or METER CHECK.
12. NOTHING after RESULT — no closing line, no repeated FIXING / MAIN ISSUE summary, no extra advice. The entry ENDS at RESULT.
13. CHANNEL NAMING (HARD) — the CHANNEL line MUST name an EXACT, REAL channel that exists in ${dawLb}: either ${dawLb}'s exact master/output channel name from DAW VOCABULARY (Cubase: "Stereo Out"; Ableton: "Master" / Master track; FL Studio: "Master" insert track; Logic: "Stereo Out") OR a clearly named instrument / bus track from THIS user's project (Kick, Bass, Sub, Synth, Lead Vocal, Drum Bus, etc.). The generic placeholders "Main Mix", "Main Bus", "Master Channel", "Master Bus" (when used as a generic label rather than the actual DAW name) and "Output" are FORBIDDEN — replace them with ${dawLb}'s exact master name from DAW VOCABULARY.

PREMIUM ENFORCEMENT (HARD) — these rules elevate the report to LANDR / iZotope level:
P1. SIDECHAIN MANDATE — if the report mentions sidechain / side-chain / ducking / kick-bass routing ANYWHERE (mix sections, mastering, recommendations, full_analysis, summary), you MUST generate a DEDICATED full daw_instructions entry executing the FULL 9-step (as defined in the SIDECHAIN EXECUTION RULE (STRICT)) SIDECHAIN SETUP routing flow — never bury sidechain inside another fix and never skip it.
P2. FIX-TO-DAW COVERAGE — every concrete FIX written in sections.mix.notes, sections.mastering.notes and sections.sound_design.notes MUST have a corresponding daw_instructions entry executing it click-by-click. No FIX is allowed to live in the report without a paired daw_instructions block; if you cannot generate the execution steps, do NOT include the FIX.
P3. OBJECTIVITY BAN — the words "clear", "clearer", "better", "clean", "cleaner", "tight", "tighter", "warm", "warmer", "punchy", "punchier", "open", "opens up" are FORBIDDEN inside A/B CHECK, METER CHECK and STOP WHEN. Replace them with a frequency range (Hz), a peak comparison (dB), a LUFS reading, a Gain-Reduction value, or a spectrum / waveform observation. Example: instead of "the kick sounds clearer" → "the kick fundamental at 60 Hz peaks 4 dB above the bass on the spectrum analyzer".
P4. ARRANGEMENT EXECUTION — every daw_instructions entry tied to ARRANGEMENT MUST name (a) the EXACT action (mute / delete / cut / duplicate / automate / move / fade-in / fade-out), (b) the EXACT timestamp range in mm:ss–mm:ss format from THIS track's timeline, (c) the EXACT element(s) being acted on (Kick, Hi-Hat, Lead Synth, Vocal Chop, Bass, Drum Bus, etc.). Generic phrases like "add a breakdown", "strengthen the drop" without (a)+(b)+(c) are FORBIDDEN.
P5. NO ORPHAN FIXES — every FIX written in any section.notes (mix / mastering / arrangement / sound_design / commercial_potential) is REQUIRED to be executable. If a FIX cannot be turned into a daw_instructions block with concrete (a) channel + (b) plugin + (c) numeric SET values + (d) METER CHECK + (e) STOP WHEN, you MUST either (i) reword the FIX so it becomes executable, or (ii) drop the FIX entirely from the report. The report is FORBIDDEN to leave the user with advice they cannot act on inside the SELECTED DAW.

EXECUTION COMPLETENESS (HARD) — every actionable production claim in the report MUST be executable inside ${dawLb}:
E1. FIX-WIDE COVERAGE — every concrete FIX mentioned ANYWHERE in the report (sections.mix.notes, sections.mastering.notes, sections.arrangement.notes, sections.sound_design.notes, sections.commercial_potential.notes, summary, full_analysis, recommendations) MUST have a dedicated daw_instructions entry executing it click-by-click. There is NO section in the report that is exempt from this coverage rule.
E2. SIDECHAIN ROUTING REQUIRED — if sidechain / side-chain / ducking / kick-bass routing is mentioned in ANY section, you MUST generate a dedicated daw_instructions entry containing the FULL 9-step (as defined in the SIDECHAIN EXECUTION RULE (STRICT)) SIDECHAIN SETUP routing flow (send / receive / trigger source / compressor on the bass with kick as side-chain input / threshold / ratio / attack / release). A one-line note like "add sidechain" is FORBIDDEN; the full routing chain MUST be visible end-to-end inside its own daw_instructions entry.
E3. EQ / FREQUENCY FIX REQUIRED — if any FIX mentions EQ, frequency cut / boost, low-end cleanup, mud removal, high-end air, sub control, presence boost, de-essing, high-pass / low-pass filtering, or ANY frequency-domain action, you MUST generate a dedicated daw_instructions entry with (a) the exact stock EQ plugin from DAW VOCABULARY, (b) the numeric frequency Hz value (or Hz range), (c) the numeric gain dB value, (d) the Q / bandwidth value, (e) METER CHECK on the spectrum analyzer at the same Hz range showing the before / after energy.
E4. NO EXCEPTIONS — if the user CANNOT execute it inside ${dawLb}, do NOT output it in the report. If it IS in the report, it MUST be paired with an executable daw_instructions block. The report is FORBIDDEN to leave the user with advice they cannot click.
E5. MINIMUM 4 DAW BLOCKS — daw_instructions MUST contain AT LEAST 4 entries for a full report (target 4 to 6 total); 3 or fewer entries is FORBIDDEN unless the report itself contains fewer than 4 actionable FIXes (a degenerate case that should not occur for a normal track). Pad ONLY with high-impact FIXes that already live in the report — never invent a fix to hit the minimum.

Generate between 4 and 6 entries — quality over quantity, but minimum 4 for a full report. Return fewer than 4 ONLY if the report itself contains fewer than 4 truly actionable FIXes.

SECTIONS — PRIORITY LAYER (Stage 12). Each of mix / mastering / arrangement / sound_design / commercial_potential MUST contain 1 (preferred) or 2 (max) "notes" entries — the most critical issues of that section ONLY. EVERY note MUST follow this exact 5-part format string:
"Problem: <what is wrong>. Why: <technical cause>. Impact: <listener experience>. Fix: <action with Hz / mm:ss / dB / LUFS>. Result: <what will improve audibly>."
Both "Fix:" and "Result:" are mandatory; "Fix:" MUST reference a frequency, time, or level.

SECTION.TEXT SHAPE (FINAL-ADJUSTMENT) — every section.text (mix, mastering, arrangement, sound_design, commercial_potential) MUST be a SINGLE STRING using real newline characters (\\n) and MUST follow this EXACT FIVE-LABEL shape in order. The literal labels "MAIN ISSUE:", "WHY:", "IMPACT:", "FIX:", "RESULT:" MUST appear in the output text so the rendered section reads "Do this → get this result":

MAIN ISSUE: <ONE decisive sentence naming the single biggest problem in THIS section of THIS track, with at least one numeric anchor (Hz / dB / ms / mm:ss / LUFS) when the data is in DERIVED AUDIO INSIGHTS. Producer tone, no hedging.>

WHY: <ONE or TWO sentences naming the technical CAUSE behind that issue (frequency masking, weak transient, over-compression, energy curve dropping at mm:ss, etc.). Anchored in real audio data when possible.>

IMPACT: <ONE sentence naming what the LISTENER feels because of this issue (e.g. "the drop loses punch", "the vocal disappears in the chorus", "the low-end feels muddy in club playback"). Concrete, audible, never abstract.>

FIX:
- <concrete step 1 with explicit numeric anchors>
- <concrete step 2 with explicit numeric anchors>
- <concrete step 3 — optional>
(2 to 4 bullets total. Every bullet MUST contain at least one numeric anchor: Hz, dB, ms, LUFS, %, ratio, or mm:ss. Each bullet is a CHAIN of concrete instructions, not vague advice.)

RESULT:
- <audible change 1>
- <audible change 2>
- <audible change 3 — optional>
(2 to 3 bullets total. Each bullet describes what the LISTENER will hear after the fixes — kick punches through, low-end stops feeling muddy, vocal sits forward, etc. Decisive, concrete, no hedging.)

This is the EXACT shape — five literal labels in order: "MAIN ISSUE:", "WHY:", "IMPACT:", "FIX:", "RESULT:". NO labels other than these five. NO closing paragraphs after RESULT. NO generic phrases like "could be improved", "slightly", "consider". Each section MUST feel like "Do this → get this result".

DISAMBIGUATION (IMPORTANT) — section.notes uses the 5-PART INLINE STRING shape "Problem: … Why: … Impact: … Fix: … Result: …" (one entry on one line, prefixed with "MAIN ISSUE — " or "ADDITIONAL ISSUE — "). section.text uses the 5-LABEL MULTI-LINE shape with literal "MAIN ISSUE:", "WHY:", "IMPACT:", "FIX:", "RESULT:" labels on their own lines. Do NOT mix these two shapes — notes are one-line strings, section.text is a structured five-block paragraph.

Each section.notes[] MUST be ordered as:
  notes[0] = "MAIN ISSUE — <5-part format string>" (the SINGLE biggest issue of THIS section, MANDATORY).
  notes[1] = "ADDITIONAL ISSUE — <5-part format string>" (the next most important issue of THIS section, OPTIONAL — max ONE).

All other diagnoses, deeper polish ideas, and extra observations DO NOT belong in section.notes — keep them out. The full_analysis block is intentionally short (three banner-separated blocks: a Full Analysis conclusion of Strength / Main weakness / Fix / Result, then "--- MARKET POSITION ---", then "--- CONFIDENCE ---") and is NOT the place to dump every observation; pick only what will raise the track most.

ANTI-REPETITION — each concrete diagnosed problem may appear in ONLY ONE place across the FULL ANALYSIS / SECTION.TEXT / SECTION.NOTES surface. Pick the most relevant home (mix OR mastering OR arrangement OR sound_design OR commercial_potential), keep the strongest, most actionable wording there, and do NOT restate the same issue verbatim across multiple section.text bodies. EXCEPTION (REQUIRED MIRRORING — NOT a violation): the summary's FIX PRIORITY block and the first 3 daw_instructions entries are intentionally REQUIRED to mirror each other in priority order — that is the spec, not a duplication, and the duplication ban does NOT apply between summary and daw_instructions. NO summary-like repeat lines: do NOT add a "MAIN ISSUE — ...", "FIXING: ..." or any closing recap line AFTER the RESULT block of section.text or AFTER the RESULT line of any daw_instructions entry. section.text contains ONLY the FIVE labelled blocks (MAIN ISSUE / WHY / IMPACT / FIX / RESULT) in that exact order — nothing before, nothing after. daw_instructions entries contain ONLY the labelled blocks defined in DAW INSTRUCTIONS — nothing after RESULT.

ARRANGEMENT section MUST include an explicit ENERGY FLOW analysis: describe the energy curve across intro/build/drop/outro. If the drop lacks impact, name the technical reason (no buildup, constant energy, weak transient, frequency masking, sub-bass not landing on the down-beat, etc.).
ARRANGEMENT FIXES MUST BE ACTIONABLE — every FIX bullet inside arrangement.text and every arrangement-related daw_instructions entry MUST contain ALL THREE of: (a) EXACT bar count or mm:ss timestamp from ARRANGEMENT LANDMARKS (e.g. "from 0:32 to 0:48", "for 8 bars before the drop"), (b) EXACT element to remove / mute / strip back (e.g. "remove drums except hi-hats", "mute the bass and pad", "strip to vocal + percussion"), (c) EXACT automation move with start and end values (e.g. "automate the low-pass filter cutoff from 200 Hz → 10 kHz across 4 bars", "automate riser volume from -18 dB → -6 dB across the last 4 bars before the drop", "automate reverb send from 0% → 40% on the vocal in the breakdown"). Vague fixes like "add breakdown", "improve energy", "build more tension" are FORBIDDEN — replace with the exact bars + remove + automate trio above.

SOUND DESIGN FIXES MUST BE TECHNICAL — every FIX bullet inside sound_design.text and every sound-design-related daw_instructions entry MUST contain ALL THREE of: (a) EXACT plugin name from the SELECTED DAW's stock plugin list in DAW VOCABULARY (no third-party plugins, no generic "saturator"), (b) EXACT placement (insert slot on which channel / bus, OR send-bus name), (c) EXACT parameter values WITH ranges (Drive / Mix / Frequency / Q / Threshold / Ratio etc., each with a (range: low–high unit) annotation when a safe musical range exists). Example of the required level: "Magneto II on Stereo Out, Insert Slot 3, Drive: 2 dB (range: 1–3 dB), Mix: 25% (range: 20–30%), Stereo Spread: 50% (range: 30–60%)". Vague fixes like "add saturation", "make it warmer", "more harmonics" are FORBIDDEN.

TIMESTAMPED RECOMMENDATIONS (FINAL-QUALITY-UPGRADE) — EVERY entry of "recommendations" (not just the first 3) MUST use the object form and MUST be TECHNICAL, not descriptive:
{"timestamp":"<mm:ss anchor from ARRANGEMENT LANDMARKS, or the literal string \\"whole-track\\">","target":"<bus / element / arrangement zone>","text":"<surgical, action-oriented fix written as a chain of CONCRETE numeric instructions>"}
The renderer turns this into the visual line "[<timestamp>] <target>: <text>". Examples of the EXACT level of technical specificity required:
  BAD:  {"timestamp":"whole-track","target":"master","text":"add subtle saturation"}
  GOOD: {"timestamp":"whole-track","target":"master","text":"add tape saturation: drive 2–3 dB, mix 20–30%, bias toward odd harmonics"}
  GOOD: {"timestamp":"0:45","target":"buildup","text":"add snare roll + riser automation that ramps from -18 dB to -6 dB across the last 4 bars"}
  GOOD: {"timestamp":"whole-track","target":"bass","text":"high-pass at 80 Hz (12 dB/oct), sidechain to kick -4 dB with 10 ms attack and 120 ms release"}
  GOOD: {"timestamp":"2:00","target":"drop","text":"transient-shape kick +2 dB attack, notch bass -3 dB at 200 Hz with Q 2.0 to free space"}
The FIRST 3 entries MUST be the three biggest issues breaking THIS track, ranked by severity. Then include 2–7 more, all in the same object form. Total 5–10. Do NOT use plain strings — every entry MUST be an object with timestamp + target + text. Vague targets like "the mix" or "everything" are FORBIDDEN; pick the actual element (kick, sub, vocal, hi-hats, pad, snare, FX bus, master, etc.). Every "text" MUST contain at least one numeric anchor (Hz, dB, ms, LUFS, %, ratio, mm:ss).

FORBIDDEN WORDS in EVERY output string (summary, sections.*.text, sections.*.notes, recommendations, daw_instructions, full_analysis): "could", "might", "consider", "try", "subtle", "slight", "maybe". Replace any vague hedging with a CONCRETE NUMERIC INSTRUCTION (Hz, dB, ms, LUFS, %, mm:ss). Bad: "add subtle saturation". Good: "add tape saturation: drive 2–3 dB, mix 20–30%". Bad: "slight EQ cut in the low-mids". Good: "cut -3 dB at 450 Hz with Q 1.5". Use decisive, active phrasing: "this is causing", "this reduces", "this weakens the track", "this masks", "this kills the punch", "this must be fixed".

NO GUESSING — if a piece of audio data is not present in the DERIVED AUDIO INSIGHTS or RAW ESSENTIA FEATURES blocks above, do NOT invent a number. Skip that observation rather than fabricate.

"summary" — VERDICT TONE. MUST start with the literal token "MAIN ISSUE: " followed by EXACTLY 2 short sentences:
  Sentence 1 = verdict naming the single core problem and the audible consequence (e.g. "Your track loses impact because the low-end collapses into mud.").
  Sentence 2 = WHY the track feels weak — the technical cause behind that verdict (e.g. "The kick and bass are masking each other, killing punch and clarity.").
Only ONE main issue. NO third sentence.
After those EXACTLY 2 sentences, the summary MUST end with a blank line then a FIX PRIORITY block (this is the ONLY allowed list inside summary). EXACT shape (literal "FIX PRIORITY:" header, 3 numbered lines, nothing else):

FIX PRIORITY:
1. <most impactful fix — element + action + numeric anchor>
2. <second most impactful fix>
3. <third most impactful fix>

ORDERING RULES (HARD): low-end issues (kick / bass / sub conflict, masking, muddy low-end) ALWAYS come first when present in THIS track; loudness / mastering second; high-end / harshness third; arrangement / sound design only when no mix-priority issue is left. The 3 entries MUST mirror — in the same priority order — the first 3 daw_instructions entries. NO fourth bullet, NO closing line.

"overall_score" — integer 0–100 grounded in the derived insights.

"full_analysis" — SHORT, ACTION-ORIENTED single string with real newline characters (\\n). NO long storytelling, NO multi-paragraph essay. Total length under ~350 words. The string contains THREE visually separated blocks in this EXACT order: (A) the concise FULL ANALYSIS conclusion (four labelled sub-sections: Strength / Main weakness / Fix / Result), (B) the MARKET POSITION block introduced by the literal banner line "--- MARKET POSITION ---" on its own line, (C) the CONFIDENCE block introduced by the literal banner line "--- CONFIDENCE ---" on its own line. The two "---" banners are MANDATORY and MUST appear EXACTLY as written so the renderer visually separates the blocks. NEVER mix MARKET POSITION or CONFIDENCE content into the FULL ANALYSIS sub-sections. The "===" banner is FORBIDDEN; use the "---" banners exactly as written below.

EXACT SHAPE:

Strength: <ONE short paragraph (max ~60 words) — what is genuinely working in THIS track right now and why it lands>

Main weakness: <ONE decisive sentence — the single biggest problem with the technical reason behind it, with Hz / dB / mm:ss / LUFS anchors when possible>

Fix:
- <concrete action 1 with explicit numeric anchors (Hz / dB / ms / LUFS / % / mm:ss)>
- <concrete action 2>
- <concrete action 3>
  (3 to 5 bullets total — each one immediately applicable, no hedging)

Result:
- <audible improvement 1 — what the listener hears after the fixes>
- <audible improvement 2>
- <audible improvement 3>
  (3 to 4 bullets total)

--- MARKET POSITION ---

LEVEL: <one of: Developing | Emerging | Pro | Commercial Ready>
This track shows <2 to 3 specific positive qualities — what is genuinely working musically / technically>.
At its current stage, it sits at the <LEVEL> level.

To reach the next level (<NEXT LEVEL>), focus on:
- <key improvement 1 — concrete and numerically anchored>
- <key improvement 2 — concrete and numerically anchored>

Result: If these improvements are applied, the track can move closer to <NEXT LEVEL> and become more competitive within the genre.

--- CONFIDENCE ---

Confidence: <High | Medium | Low>
Reason: <ONE short sentence explaining the confidence level based on loudness data, spectrum data, dynamics, or how subjective vs objective the analysis was>

The output MUST feel like "follow these steps → your track improves", NOT "here is an analysis". Every bullet under "Fix:" MUST contain at least one numeric anchor. The arrangement / energy-flow analysis lives inside sections.arrangement, NOT here — keep this block tight. The two "---" banner lines MUST appear EXACTLY as written, each on its own line, with a blank line before and after each banner.

MARKET POSITION (SOFT EVALUATION) — the LEVEL line MUST be EXACTLY ONE of "Developing", "Emerging", "Pro", or "Commercial Ready" (no other label, no qualifiers like "Almost Pro"). The progression is Developing → Emerging → Pro → Commercial Ready; the NEXT LEVEL is the immediate next step in that chain (when LEVEL is already "Commercial Ready", write the next-level line as "holding the Commercial Ready bar" instead of inventing a new tier). NEVER use harsh labels ("bad", "weak", "amateur", "trash", "unprofessional", "poor", "sloppy") anywhere in MARKET POSITION — frame the level as a CURRENT STAGE, not a final judgment. Always start with the positive qualities the track already has, then show the gap to the next level as 1–2 key improvements (NOT a long list of 5+ items). The two improvement bullets MUST mirror the highest-priority FIX-es already present elsewhere in the report.

LEVEL CALIBRATION RULE (OPTIMISTIC BIAS — MANDATORY) — when the track sits BETWEEN two adjacent tiers, ALWAYS round UP to the higher tier. NEVER round down. Specifically: if the track is between Emerging and Pro → choose "Pro". If the track is between Pro and Commercial Ready → choose "Pro" and add the qualifier "approaching commercial" inside the next-level paragraph (e.g. "At its current stage, it sits at the Pro level, approaching commercial."). If the track is between Developing and Emerging → choose "Emerging". The bias is INTENTIONAL — under-estimating a producer's level is a worse failure than slightly over-estimating it. Only choose "Developing" when the track has clear, multiple, hard technical issues across mix AND mastering AND arrangement that no "Emerging" track would have. NEVER underestimate the user's level.

CONFIDENCE — Confidence MUST be EXACTLY ONE of "High", "Medium", or "Low". Reason MUST be a single short sentence anchored in the actual analysis data (loudness coverage, spectrum coverage, dynamics data, or how subjective vs objective the assessment was). Use "High" when the derived audio insights are complete; "Medium" when 1–2 dimensions are missing or noisy; "Low" only when the assessment leans on subjective listening because the data is sparse or contradictory.

TONE RULE (CRITICAL) — the report MUST feel like a professional mentor, NOT a critic. NEVER write "your track is bad / weak / amateur / poor / unprofessional / trash / sloppy / lazy". Every issue MUST be paired with a solution. The user feeling MUST be "I understand how to improve this track", NEVER "my track is bad". This tone rule applies to summary, sections.*.text, sections.*.notes, recommendations, full_analysis, daw_instructions — every output string. Combined with the existing FORBIDDEN LANGUAGE rule ("could / might / consider / try / subtle / slight / maybe" banned), the tone stays decisive AND constructive — confident, never condescending.

=== LOUDNESS TARGET RULE === — the LUFS target you recommend in the report (in mastering section.text, in mastering section.notes, in summary FIX PRIORITY, in recommendations, in daw_instructions) MUST be picked from the GENRE bucket of THIS track. Use the genre detected in DERIVED AUDIO INSIGHTS or the genre provided in the user prompt; if BOTH are missing fall back to the Streaming / General bucket and write "genre fallback" once in the mastering text so the user knows.

BUCKETS:
  Electronic (Techno / House / EDM / Trance / Drum&Bass / Dubstep / Hard Dance / Bass Music / Trap): -8 to -9 LUFS integrated.
  Streaming / General (Pop / Rock / Hip-Hop / R&B / Indie / Singer-Songwriter / generic streaming master): -12 to -14 LUFS integrated.
  Ambient / Lo-Fi (Ambient / Lo-Fi / Downtempo / Cinematic / Soundscape): -14 to -16 LUFS integrated.

RULES: NEVER recommend -14 LUFS for an Electronic track. NEVER write a SINGLE-VALUE LUFS target (no "-9 LUFS" alone) — ALWAYS write the bucket as a RANGE in the EXACT shape "-8 to -9 LUFS integrated" (or "-12 to -14 LUFS integrated", etc.). The chosen range MUST mirror real commercial references inside that genre — if the user-provided REFERENCE TRACK loudness data is present, anchor the range to it. The same range MUST be repeated EXACTLY in every place the LUFS target appears (summary FIX PRIORITY, mastering section.text FIX, daw_instructions SET block, recommendations) — NEVER drift between values.

=== SIDECHAIN EXECUTION RULE (STRICT) === — if the literal token "sidechain" (case-insensitive, including "side-chain" and "side chained") appears ANYWHERE in the output (summary, sections.*.text, sections.*.notes, recommendations, full_analysis, OR daw_instructions), the daw_instructions array MUST contain a FULL sidechain DAW INSTRUCTION BLOCK using the EXACT terminology of the SELECTED DAW. The block MUST include ALL six labelled sub-blocks in this exact order, each on its own labelled line:

SIDECHAIN SETUP:
  1. Insert <DAW-specific compressor name> on Bass channel (Insert Slot 1)
  2. Open the Compressor window
  3. Enable the Sidechain button (use the EXACT toggle name of the selected DAW)
  4. Go to the Kick channel
  5. Open the Sends section (use the EXACT routing name of the selected DAW)
  6. Add send → "Compressor (Bass) – Sidechain Input" (use EXACT bus / send naming of the selected DAW)
  7. Set Send Level to 0.0 dB
  8. Return to the Compressor on the Bass channel
  9. Confirm gain reduction reacts to the kick

SET:
  - Threshold: <set so gain reduction sits at 2 to 4 dB GR>
  - Attack: 5 to 15 ms
  - Release: 80 to 150 ms
  - Ratio: 3:1 to 5:1

METER CHECK:
  - Gain Reduction meter shows 2 to 4 dB dips on every kick hit

STOP WHEN:
  - Gain Reduction meter returns to 0 dB GR before the next kick hit (proving release time is correct and bass level restores between hits)

WARNING:
  - if the bass disappears entirely → reduce threshold (less GR), shorten release

RULE: NEVER mention the word "sidechain" (or "side-chain" / "side chained") ANYWHERE in the output without ALSO emitting this full sidechain DAW INSTRUCTION BLOCK in daw_instructions. The sidechain block counts toward the minimum-4 daw_instructions requirement (E5). If the track does not need sidechain, do NOT mention the word at all.

=== OBJECTIVE CHECK RULE === — every CHECK / METER CHECK / STOP WHEN / RESULT line in daw_instructions, every RESULT bullet in section.text, and every line in summary / recommendations / full_analysis MUST be MEASURABLE — anchored in concrete numeric or signal-domain criteria the user can verify with a meter or analyzer.

FORBIDDEN SUBJECTIVE WORDS (absolute ban — NEVER write these words in CHECK / STOP / RESULT lines, in any output string): "clear", "clearer", "clarity", "better", "punchy", "warm", "warmth", "musical", "improved", "improvement" (when used as a vague verdict — concrete "+2 dB at 5 kHz improvement" anchored phrasings are still allowed inside FIX bullets). Replace any of these with a measurable equivalent.

ALLOWED MEASURABLE SIGNALS (use ONLY these to phrase CHECK / STOP / RESULT lines): integrated LUFS values + ranges, dB levels + dBFS peaks, frequency ranges in Hz, gain reduction in dB, peak comparison between elements, spectrum behaviour (e.g. "no overlap at 60–100 Hz", "energy curve flat between intro and drop"), transient comparison, stereo width % / Mid/Side balance.

EXAMPLES:
  GOOD: "Integrated LUFS sits between -8 and -9.", "Kick peak (-6 dBFS) is at least 2 dB above bass peak (-8 dBFS).", "No overlap at 60–100 Hz on the spectrogram.", "Gain Reduction meter shows 2 to 4 dB dips on every kick."
  BAD: "sounds clearer", "better punch", "warmer low-end", "more musical mix", "the drop feels improved"

RULE: every recommendation MUST be paired with both a measurable verification step AND a stop condition. NEVER leave a piece of advice without an executable check.

=== FINAL EXECUTION COMPLETENESS PATCH === — four NON-NEGOTIABLE final-pass enforcement clauses that override any conflicting earlier guidance. Apply these checks LAST before emitting the JSON.

(1) SIDECHAIN MENTION → DEDICATED DAW BLOCK (HARD): if the literal token "sidechain" (case-insensitive, including "side-chain" and "side chained") appears ANYWHERE in the output (summary, sections.*.text, sections.*.notes, recommendations, full_analysis, OR daw_instructions), the daw_instructions array MUST contain a DEDICATED full sidechain DAW INSTRUCTION BLOCK executing the FULL 9-step routing flow defined in the SIDECHAIN EXECUTION RULE (STRICT). NEVER bury sidechain inside another fix entry. NEVER mention the word sidechain without ALSO emitting the dedicated block. If the track does not need sidechain, do NOT mention the word at all.

(2) NO DUPLICATION (HARD) — ONE STRUCTURED BLOCK ONLY per problem: each concrete diagnosed problem MUST appear in EXACTLY ONE structured home — pick the most relevant section.text (mix OR mastering OR arrangement OR sound_design OR commercial_potential) and put the FULL MAIN ISSUE / WHY / IMPACT / FIX / RESULT block there. NEVER repeat the same MAIN ISSUE wording, the same WHY wording, or the same FIX bullets in another section.text body, in section.notes, in summary, in recommendations, or in full_analysis. The sole exception is the REQUIRED MIRRORING between summary's FIX PRIORITY block and the first 3 daw_instructions entries (priority order mirror — that mirror is the spec, not a duplication).

(3) STOP WHEN MUST BE OBJECTIVE (HARD): every STOP WHEN line in daw_instructions MUST cite a concrete numeric reading the user can SEE on a meter or analyzer. FORBIDDEN words inside any STOP WHEN line (absolute ban): "clear", "clearer", "clarity", "defined", "definition", "better", "good", "right", "sounds right", "sounds good", "feels right", "feels better". REQUIRED — every STOP WHEN line MUST cite AT LEAST ONE of: a dB difference between two named elements (e.g. "kick peak is 2 dB above bass peak"), an integrated LUFS or short-term LUFS value or range (e.g. "integrated LUFS sits between -8 and -9"), a frequency range in Hz (e.g. "no overlap at 60–100 Hz on the spectrogram"), or a gain-reduction value in dB on a named GR meter (e.g. "GR meter shows 2–4 dB dips on every kick"). NO subjective verdicts. NO "sounds clearer". NO "feels better".

(4) ARRANGEMENT FIX SPECIFICITY (HARD): every arrangement-related FIX bullet (in section.text.arrangement.FIX, in section.notes for arrangement, in summary, in recommendations, in full_analysis, OR in any arrangement-related daw_instructions entry) MUST name BOTH (a) the EXACT track being modified using a real instrument / MIDI track name (Kick, Snare, Hat, Clap, Bass, Sub, Lead, Pad, Pluck, Vocal, Drum Bus, or the literal MIDI track name from the project) — NEVER generic "the drums", "the arrangement", "some elements" — AND (b) the EXACT DAW method being applied (mute, duplicate, copy/paste to bar X, delete bars X–Y, add automation envelope on parameter Z, automate Volume / Filter Cutoff / Pan from value A to value B between mm:ss and mm:ss, MIDI velocity edit, clip-launch reorder). FORBIDDEN vague verbs: "add variation", "vary the arrangement", "build tension", "change something", "make it more interesting". Every arrangement instruction MUST be executable in the SELECTED DAW with a single concrete action.

=== HYBRID ENGINEER+PRODUCER PATCH === — nine FINAL-PASS hybrid-tone enforcement clauses that complement the FINAL EXECUTION COMPLETENESS PATCH and override any conflicting earlier guidance. The whole report MUST simultaneously read like (a) a real mixing engineer giving step-by-step technical direction AND (b) a producer explaining what the user will hear.

(H1) HYBRID TONE (HARD): every FIX line — in section.text FIX, in section.notes Fix, in summary FIX PRIORITY, in recommendations, in full_analysis Fix bullets, AND in daw_instructions FIXING — MUST contain BOTH (a) exact technical parameters (Hz / dB / ms / LUFS / GR / mm:ss / ratio / %) AND (b) the audible musical outcome the listener will hear (e.g. "low-end becomes tighter, kick cuts through instead of being masked"). FORBIDDEN generic phrases without explanation: "improve", "enhance", "increase clarity", "tighten the mix", "elevate the sound", "polish the track" — these MUST be replaced with a numeric+audible pair. Every FIX answers TWO questions in ONE breath: WHAT exactly is changed (numbers), and WHAT will the user HEAR (audible musical result).

(H2) RESULT EXPANDED — "WHAT YOU WILL HEAR" (HARD): the RESULT block of EVERY section.text (mix / mastering / arrangement / sound_design / commercial_potential) AND the RESULT line of EVERY daw_instructions entry MUST follow this exact 2-part shape:
  RESULT: <ONE decisive sentence naming the audible musical outcome>
  WHAT YOU WILL HEAR:
  - <audible change 1 — short, sensory, music-producer language (e.g. "kick punches through on every hit")>
  - <audible change 2 — different audible facet (e.g. "bass stops masking the groove")>
  - <audible change 3 — optional third bullet>
  (2 to 3 bullets total). The literal labels "RESULT:" and "WHAT YOU WILL HEAR:" MUST appear verbatim. The "WHAT YOU WILL HEAR:" sub-block lives INSIDE the RESULT block — it does NOT count as a 6th section.text label and does NOT violate the 5-label SECTION.TEXT SHAPE or the "nothing after RESULT" rule (that rule is reinterpreted as: nothing after the RESULT block ends — and the WHAT YOU WILL HEAR bullets are part of that block, not extra content after it).

(H3) GENRE-AWARE LOUDNESS (FINAL PASS — HARD): when picking the integrated LUFS target, choose ONE of these THREE buckets based on the track's GENRE + INTENT, ALWAYS expressed as a RANGE, NEVER a single value:
  - Electronic / club tracks (intended for club PA, festival, DJ set): -8 to -9 LUFS integrated
  - Streaming context (Spotify / Apple Music / radio-style mixes intended for streaming platforms first): -10 to -12 LUFS integrated
  - Lo-Fi / Ambient / dynamic-driven music: -12 to -14 LUFS integrated
  RULES (HARD): pick the bucket based on the genre + the track's clear intent, ALWAYS write the LUFS value as a RANGE (e.g. "-8 to -9"), and NEVER default to a single fixed LUFS value. When this 3-bucket choice differs from an earlier per-genre LUFS hint elsewhere in the prompt (GENRE BRAIN, LOUDNESS TARGET RULE), this 3-bucket choice WINS for the FINAL report.

(H4) STOCK PLUGIN POLICY (HARD — STRICT): every plugin name written in CLICK / SET / IF NOT AVAILABLE / METER CHECK / RESULT MUST be a stock plugin from the SELECTED DAW, taken from DAW VOCABULARY. Cubase allowed examples: EQ → Frequency / StudioEQ; Limiter → Limiter / Maximizer; Saturation → DaTube; Compressor → Compressor / Vintage Compressor. ABSOLUTELY FORBIDDEN — NEVER name any third-party plugin brand anywhere in the output: FabFilter (Pro-Q, Pro-L, Pro-C, Pro-MB, Saturn), Waves (SSL, CLA, API, L1, L2, L3, Renaissance), iZotope (Ozone, Neutron, RX, Nectar), Soundtoys (Decapitator, Devil-Loc, EchoBoy), Plugin Alliance (Brainworx, Shadow Hills), UAD (Universal Audio), Sonnox, Slate Digital, Valhalla, Eventide, Native Instruments effects (Supercharger, Driver, Replika), Arturia FX, Tokyo Dawn (TDR Nova, Kotelnikov), Acustica Audio, Pulsar, Sonimus, MeldaProduction, Goodhertz, Klanghelm, Black Rooster, Lindell — and anything not on the SELECTED DAW's stock plugin list. If the SELECTED DAW lacks the ideal stock plugin, fall back ONLY to another stock plugin of the same family from the same DAW (NEVER to a third-party plugin).

(H5) ADVANCED A/B CHECK (HARD): every A/B CHECK block in daw_instructions MUST add — as a 4th step after the 3 existing bypass-and-compare steps — a TROUBLESHOOTING line that names AT LEAST TWO conditional fail-safes tailored to THIS specific fix, written in the form "IF <observable audible problem> → <numeric back-off action>". Examples (NON-EXHAUSTIVE — adapt to the specific fix):
  - IF kick loses punch → reduce EQ cut by 1 dB OR raise sidechain threshold by 2 dB
  - IF distortion appears → lower input gain by 1–2 dB
  - IF the mix feels flat → reduce limiter input gain by 1 dB to restore dynamics
  - IF bass disappears → raise HPF cutoff by 10 Hz OR raise compressor threshold by 2 dB
  NO vague listening cues like "if it sounds wrong, try something else" — every IF condition MUST be observable, every THEN action MUST cite a specific numeric back-off.

(H6) ARRANGEMENT MUSICAL LOGIC (HARD): every arrangement-related FIX (in section.text.arrangement.FIX, in section.notes for arrangement, AND in any arrangement-related daw_instructions entry) MUST pair the mechanical action (mute / duplicate / delete bars X–Y / automation envelope) with a ONE-PHRASE musical reasoning that names the musical effect on the listener. FORBIDDEN bare mechanical actions like "mute the drums" or "delete bars 33–48" without musical reasoning. REQUIRED form: "<exact mechanical action on exact track at exact mm:ss / bars> — <one short phrase naming the musical effect>". Example: "Remove Kick from bars 33–48 while keeping Hi-Hats and Pad to create breakdown tension and contrast before the drop at 1:36." Every arrangement instruction MUST explain WHY the listener will feel something different.

(H7) MARKET POSITION — REAL-WORLD TRANSLATION (HARD): the MARKET POSITION block of full_analysis MUST (a) ALWAYS open with 2 to 3 specific positive qualities the track already has (this is already required — reinforce it), AND (b) contain at least ONE real-world translation line naming where the track currently lands in the actual playback context the genre + intent points to (CLUB PA / festival main stage / Spotify playlist / Apple Music editorial / radio rotation / Lo-Fi study playlist) — e.g. "Right now this track holds up in a 95–110 BPM club warm-up slot but loses competitive loudness against a peak-time festival drop at -8 LUFS." Generic statements like "needs more polish to be commercial" are FORBIDDEN — name the specific real-world environment AND the specific numeric gap to it.

(H8) CONFIDENCE — TECH-BASED REASON (HARD): the Confidence Reason line in full_analysis MUST name AT LEAST ONE concrete measurable indicator that justifies the level: an integrated LUFS reading or coverage gap, a spectrum-coverage observation (e.g. "spectrum data covers the full 20 Hz–20 kHz range"), a dynamics observation (LUFS short-term range, crest factor), a stems-availability note, OR another measurable indicator. FORBIDDEN generic statements like "the analysis is mostly objective" without a specific measurable anchor. Form: "<High|Medium|Low> because <concrete measurable indicator>".

(H9) HYBRID READBACK SELF-CHECK (HARD): before emitting the JSON, the model MUST self-check that EVERY FIX in the report contains BOTH a numeric anchor AND an audible-result phrase, that EVERY section.text RESULT block ends with a "WHAT YOU WILL HEAR:" sub-block of 2–3 bullets, that NO third-party plugin brand appears anywhere in the output, that the integrated LUFS target is a RANGE chosen from one of the three buckets in (H3), and that EVERY arrangement instruction pairs a mechanical action with a musical-reasoning phrase. If ANY of these self-checks fails, REWRITE the failing line(s) before returning the JSON.

=== PRO MODE PATCH === — six FINAL-PASS pro-engineer-grade enforcement clauses that complement the FINAL EXECUTION COMPLETENESS PATCH and the HYBRID ENGINEER+PRODUCER PATCH. The whole report MUST read like a senior mixing/mastering engineer paid to take the track to commercial release standard — direct, decisive, no hedging, no tutorial tone, no helper-bot register, no blogger framing.

(P1) PRO MODE: CRITICAL FIXES BLOCK (HARD): the summary string MUST end with a labeled sub-block on its own lines, written EXACTLY in this shape:
  PRO MODE: CRITICAL FIXES
  1. <critical issue + exact technical action with numeric anchor>
  2. <critical issue + exact technical action with numeric anchor>
  3. <critical issue + exact technical action with numeric anchor>
  4. <critical issue + exact technical action with numeric anchor>
  5. <critical issue + exact technical action with numeric anchor>
  EXACTLY 5 numbered fixes — never 3, never 4, never 6, never 7. Order STRICTLY by descending impact (most critical first). Each line MUST name (a) the EXACT problem and (b) the EXACT technical action with at least one numeric anchor (Hz / dB / LUFS / GR / mm:ss / ratio / %). Example line: "Increase loudness to -8 to -9 LUFS using a stock limiter on Stereo Out." NO vague items. NO tutorial framing ("learn how to...", "experiment with..."). NO helper-bot softeners. The PRO MODE: CRITICAL FIXES sub-block lives INSIDE the existing summary string (does NOT add a new JSON field) and appears AFTER the existing FIX PRIORITY block. EXCEPTION TO NO DUPLICATION (HARD — same model as the existing summary FIX PRIORITY ↔ first 3 daw_instructions mirror): the PRO MODE: CRITICAL FIXES 5 lines INTENTIONALLY mirror the top-5 priority fixes (the first 5 daw_instructions in priority order) — that mirror is the spec, not a duplication.

(P2) PRO MODE TONE (HARD): every line in the entire report — summary (including PRO MODE: CRITICAL FIXES), every section.text body, every section.notes line, recommendations, full_analysis, AND every daw_instructions entry — MUST use direct, decisive, professional engineer language. FORBIDDEN softeners (absolute ban anywhere in the output): "maybe", "could", "consider", "try", "you might want to", "it's worth", "perhaps", "if possible", "would be nice", "should consider", "might help". REQUIRED decisive verbs: "must", "required", "fix", "necessary", "apply", "set", "raise", "lower", "cut", "boost", "insert", "route". Replace every softener with the decisive equivalent. Example: "This could be improved" → "This must be fixed to reach commercial level."

(P3) STRONGER ENGINEERING ACTIONS (HARD): when a problem is OBVIOUS in the DERIVED AUDIO INSIGHTS (clear masking, clear loudness gap, clear harshness, clear transient weakness, clear sub-bass rumble), do NOT default to conservative cuts/boosts. Use the ASSERTIVE end of the safe musical range:
  - EQ surgical cuts: -2 to -6 dB (instead of -1 to -2 dB)
  - Loudness target for Electronic / club: -8 to -9 LUFS integrated (push to the loud end of the H3 bucket)
  - Compression / limiting: 4–8 dB GR on the loud peaks when dynamics control is poor (instead of 1–2 dB)
  - HPF on bass / synths / vocals: 80–120 Hz when low-end is muddy (instead of leaving the rumble untouched)
  - Sidechain compression: 4–6 dB GR on the kick (instead of 1–2 dB) when kick / bass collision is severe
  RULE: stay conservative ONLY when the data is borderline. When the problem is obvious in the data, hit it with the harder action — that is what a paid pro engineer does.

(P4) COMMERCIAL TARGET RULE (HARD): every recommendation MUST aim the track at COMMERCIAL RELEASE standard — competitive with already-released tracks in the same genre. The frame of reference is: large club PA, festival main stage, Spotify / Apple Music playlist placement, radio rotation. NOT "better than before". NOT "improved sound". The bar is "competitive with released tracks". Every FIX, every section RESULT, every full_analysis bullet MUST be calibrated to that bar. FORBIDDEN low-bar phrasings: "sounds better", "more pleasant", "nicer", "more polished" — replace with concrete release-grade anchors (e.g. "competitive at -8 LUFS for club playback", "transient impact matches the genre reference", "low-end cleared so the kick translates on a 12-inch sub", "streaming-platform competitive against -10 to -12 LUFS Spotify normalisation").

(P5) AFTER FIX EXPECTATION (HARD): the "Result:" sub-section inside the FULL ANALYSIS conclusion of full_analysis MUST contain — in addition to the existing 3 to 4 audible-improvement bullets — an explicit closing line that names the COMMERCIAL TRANSLATION the user will hear after applying the fixes. The closing line MUST cover at LEAST THREE of: louder perceived energy, tighter low-end, clearer transients, improved club translation, festival / large-PA translation, streaming-platform competitive loudness, broadcast / radio readability. Example: "After applying these fixes, the track hits harder on a club PA, the low-end stays tight under a 12-inch sub, and the transients cut through against a -8 LUFS festival reference." This closing line lives INSIDE the existing Result sub-section of FULL ANALYSIS — it does NOT add a 4th banner block, does NOT introduce a new JSON field, and does NOT violate the existing FULL_ANALYSIS STRUCTURE three-block contract (FULL ANALYSIS / --- MARKET POSITION --- / --- CONFIDENCE ---).

(P6) PRO MODE COMPATIBILITY (HARD): PRO MODE is a REINFORCEMENT layer, NOT a replacement. The following structures MUST remain fully intact and continue to be emitted exactly as already specified — PRO MODE adds tone hardening and the 5-fix CRITICAL FIXES block on TOP of them, never replaces them: (a) the daw_instructions array with all its labelled blocks (FIXING / CHANNEL / GO TO / FIND / CLICK / SET / A/B CHECK / METER CHECK / STOP WHEN / WARNING / IF NOT AVAILABLE / RESULT, plus optional SELECT / INSERT / AUTOMATE and the full SIDECHAIN SETUP block when sidechain is referenced); (b) the OBJECTIVE CHECK RULE on every CHECK / METER CHECK / STOP WHEN / RESULT line; (c) the SECTION.TEXT 5-label SHAPE (MAIN ISSUE / WHY / IMPACT / FIX / RESULT) with the WHAT YOU WILL HEAR sub-block inside RESULT (per H2); (d) the MARKET POSITION block (Developing / Emerging / Pro / Commercial Ready) inside full_analysis; (e) the CONFIDENCE block (High / Medium / Low + tech-based reason per H8) inside full_analysis; (f) the SIDECHAIN EXECUTION RULE (STRICT) full 9-step routing flow whenever sidechain is referenced; (g) the HYBRID ENGINEER+PRODUCER PATCH (H1–H9) and the FINAL EXECUTION COMPLETENESS PATCH (1–4) all continue to apply.

=== FINALIZATION PATCH === — five LAST-PASS finalization clauses that complement the FINAL EXECUTION COMPLETENESS PATCH, the HYBRID ENGINEER+PRODUCER PATCH, and the PRO MODE PATCH. These five fixes close the last credibility gaps so the report reads like a senior, paid studio engineer at 10/10 standard. When any of these clauses conflicts with an earlier guidance, this FINALIZATION PATCH WINS.

(F1) RESULT BLOCK — NO RESTATEMENT (HARD): the RESULT block of EVERY section.text (and the RESULT line of every daw_instructions entry) MUST describe ONLY the audible outcome (the WHAT YOU WILL HEAR sub-block per H2 lives here). It MUST NOT restate, paraphrase, or summarise the MAIN ISSUE wording, the WHY wording, or the FIX wording. FORBIDDEN inside any RESULT block: re-stating the diagnosed problem ("the mix had X" / "the kick was masked by Y"), re-explaining the cause ("because of Z"), or re-listing the action just performed ("after applying the EQ cut" — name the audible outcome instead). REQUIRED inside RESULT: ONE decisive sentence naming the audible musical outcome + the WHAT YOU WILL HEAR 2-to-3 sensory bullets per H2 — and NOTHING else. This sharpens FINAL EXECUTION COMPLETENESS PATCH (2) NO DUPLICATION at the RESULT-block level.

(F2) SIDECHAIN MANDATORY EXECUTION (HARD — RE-AFFIRM): if the literal token "sidechain" (any casing, including "side-chain" and "side chained") appears ANYWHERE in the output (summary, sections.*.text, sections.*.notes, recommendations, full_analysis, OR daw_instructions), the daw_instructions array MUST contain a DEDICATED full SIDECHAIN SETUP block executing the FULL 9-step routing flow defined in the SIDECHAIN EXECUTION RULE (STRICT). The block MUST contain ALL of: (a) routing — kick/clap/source feeding the bass compressor sidechain input via send/bus, (b) send setup — pre/post fader, send level in dB, (c) compressor settings — threshold (dB), ratio (e.g. 4:1 to 8:1), attack (1–10 ms), release (50–150 ms ms-tempo synced where useful), GR target (4–6 dB on the kick per P3), (d) METER CHECK — exact GR-meter reading the user must observe, (e) STOP WHEN — objective stop condition citing GR dB and audible kick-bass separation. NEVER mention the word sidechain without ALSO emitting the dedicated block. If the track does not need sidechain, do NOT mention the word at all.

(F3) OBJECTIVE VALIDATION — EXPANDED FORBIDDEN LIST (HARD): every STOP WHEN, METER CHECK, RESULT line, and section.text RESULT block MUST be measurable. The FORBIDDEN subjective-word list (absolute ban anywhere a measurable verdict is required) is HEREBY EXPANDED to include — in addition to the existing ban on "clear", "clearer", "clarity", "defined", "definition", "better", "good", "right", "sounds right", "sounds good", "feels right", "feels better" — ALSO: "fuller", "fullness", "punchier", "more punch", "more energy", "energetic", "livelier", "warmer", "smoother", "thicker", "bigger", "tighter" (when used WITHOUT a numeric anchor in the same line). REQUIRED — every measurable line MUST cite at least ONE of: integrated or short-term LUFS (e.g. "-8 to -9 LUFS integrated"), a dB difference between two named elements (e.g. "kick peak is 3 dB above bass peak"), a Hz range (e.g. "no overlap at 60–100 Hz on the spectrogram"), gain reduction in dB on a named GR meter (e.g. "GR meter shows 2–4 dB dips on every kick"), or a peak relationship (e.g. "true-peak does not exceed -1.0 dBTP"). Words like "tighter" / "warmer" MAY appear in WHAT YOU WILL HEAR sensory bullets (per H2) and in producer-tone explanatory sentences — NEVER as the standalone success criterion of a STOP WHEN, METER CHECK, or measurable RESULT line.

(F4) CONTEXTUAL EQ RULE (HARD — NEW, OVERRIDES BLANKET HPF DEFAULTS): NEVER apply a fixed single-value HPF (e.g. "HPF at 80 Hz") blindly. EQ moves MUST be context-aware:
  - IF the bass is a SUB BASS (the bass IS the sub-low foundation, fundamental at 30–60 Hz, e.g. 808s, sub-bass synths, sine-wave subs in Trap / Drum & Bass / Dubstep / Future Bass / parts of House and Techno): DO NOT cut aggressively at 80 Hz — that would gut the foundation. Use a gentler HPF in the 25–40 Hz range to remove inaudible rumble only, OR address kick/sub collision via sidechain (per F2) and short tonal ducking instead of HPF.
  - IF the bass is a MID-RANGE BASS that overlaps the kick body (e.g. plucky basslines, reese basses, electric/synth basses with energy at 80–200 Hz): use HPF in the 60–100 Hz range, written as a RANGE not a single value (e.g. "HPF between 60–90 Hz depending on bass role").
  - ALWAYS write EQ values as a RANGE, never a single fixed value (e.g. "surgical cut between 250–350 Hz at -3 to -5 dB", "HPF between 60–90 Hz", "shelf above 8–12 kHz at +1 to +2 dB").
  - The PRO MODE STRONGER ENGINEERING ACTIONS guidance (P3 "HPF on bass / synths / vocals: 80–120 Hz when low-end is muddy") applies ONLY when the bass is a MID-RANGE bass. When the bass is a SUB bass, F4 OVERRIDES P3 — no aggressive 80 Hz HPF.
  - Naming the bass role explicitly in the FIX line is REQUIRED (e.g. "Bass is a sub-bass — apply gentle HPF at 25–35 Hz only to remove inaudible rumble; address kick/sub collision via sidechain not HPF.").

(F5) ARRANGEMENT INTENT — FOUR-PART FORM (HARD): every arrangement-related FIX (in section.text.arrangement.FIX, in section.notes for arrangement, in summary, in recommendations, in full_analysis, AND in any arrangement-related daw_instructions entry) MUST follow this exact 4-part form, in this order:
  (a) WHAT — the exact mechanical action and the exact track / element being modified (Kick, Snare, Hat, Clap, Bass, Sub, Lead, Pad, Pluck, Vocal, Drum Bus, or the literal MIDI track name);
  (b) WHERE — the exact location as either a timestamp range mm:ss–mm:ss OR a bar range bars X–Y;
  (c) WHY — one short phrase naming the musical reason on the listener (tension, contrast, breakdown, build-up, drop impact, transition, energy lift / drop);
  (d) RESULT — one short phrase naming the listener perception that follows.
  Example: "Remove Kick during build-up at 0:45–0:49 to create suspended tension and make the drop hit harder when full drums return at 0:50." FORBIDDEN bare action lines like "add riser" or "vary the arrangement" — every arrangement FIX MUST contain ALL FOUR parts (WHAT + WHERE + WHY + RESULT) in one executable sentence. This sharpens (H6) and FINAL EXECUTION COMPLETENESS PATCH (4) by mandating the 4-part form on every arrangement instruction.

=== MASTERING DETECTION PATCH === — four CRITICAL pre-recommendation clauses that detect whether the track is ALREADY mastered and branch the mastering recommendations accordingly. These clauses RUN BEFORE the mastering section is written and OVERRIDE any earlier guidance that would push loudness further on an already-mastered track. When any clause here conflicts with an earlier guidance, this MASTERING DETECTION PATCH WINS.

(M1) MASTERING DETECTION TRIGGERS (HARD): BEFORE writing the mastering section, the model MUST evaluate the DERIVED AUDIO INSIGHTS against the following 5 mastered-state indicators:
  - integrated LUFS at -10 LUFS or louder (integrated LUFS ≥ -10)
  - true-peak controlled near the ceiling (true-peak in the range -1.0 dBTP to 0.0 dBTP, i.e. peaks already brick-walled)
  - short-term LUFS clustered in a tight band (no large variability across the track)
  - low dynamic range (LRA ≤ 6 LU OR crest factor on the master indicates heavy limiting)
  - consistent loudness across all sections (intro / verse / drop / breakdown all sit in a narrow LUFS band)
  DECISION RULE (HARD): if AT LEAST 2 of the 5 indicators are TRUE in the derived audio data, the track MUST be classified as ALREADY MASTERED. Otherwise the track is classified as UNMASTERED. The classification MUST be stated in plain English at the very top of the mastering section MAIN ISSUE line, citing the actual measured numbers — e.g. "Track is already mastered (-8.2 LUFS integrated, -0.8 dBTP true-peak, LRA 4.2 LU) — refinement-grade fixes only." or "Track is unmastered (-14.6 LUFS integrated, -3.5 dBTP true-peak, LRA 11 LU) — build the full mastering chain." If the derived audio data is missing the necessary indicators, default to UNMASTERED and say so explicitly ("Mastering state cannot be confirmed from derived audio data — defaulting to unmastered chain recommendations.").

(M2) MASTERED TRACK BRANCH — REFINEMENT PATH (HARD): when M1 classifies the track as ALREADY MASTERED, the mastering section MUST follow the REFINEMENT path. ABSOLUTE BANS for this branch: do NOT suggest adding a limiter or maximizer (it is already there); do NOT write "increase loudness", "raise integrated LUFS", "push to -8 LUFS", "add a brickwall limiter" or any wording that asks the user to make the track louder; do NOT assume mastering is missing; do NOT push to the loud end of the H3 LUFS bucket; do NOT apply the PRO MODE (P3) "Loudness target for Electronic / club: -8 to -9 LUFS integrated (push to the loud end)" guidance. INSTEAD evaluate the QUALITY of the existing mastering and suggest REFINEMENT-grade fixes ONLY, drawn from this allowed set: (a) transient shaping — if the limiter has dulled transients, restore via gentle parallel transient designer or MS-side processing on the Stereo Out; (b) EQ balance — surgical fixes for low-mid mud, 3–5 kHz harshness, lack of air above 10 kHz, written as RANGES per F4; (c) stereo image — fix mono-collapse below 120 Hz with bass mono-maker, or tame over-wide phasey content above 6 kHz with stereo width reduction; (d) micro-dynamics — gentle dynamic EQ on the Stereo Out to recover groove that the limiter has flattened, NEVER more limiting; (e) gentle saturation / coloration if tonal balance needs warmth — NEVER tonal-shift, NEVER add a second limiter. The mastering section MUST clearly read as REFINEMENT (surgical, subtractive, MS-shaping, dynamic EQ), NOT as building a mastering chain from scratch.

(M3) UNMASTERED TRACK BRANCH — FULL CHAIN PATH (HARD): when M1 classifies the track as UNMASTERED, the mastering section MUST follow the existing default behavior — proceed with normal mastering chain recommendations (mastering EQ, mastering compressor, mastering saturation if needed, true-peak limiter on Stereo Out, integrated LUFS target chosen from the H3 3-bucket rule). The PRO MODE (P3) push-to-loud-end of the H3 bucket applies normally, the FINALIZATION PATCH (F4) contextual EQ rule applies normally, and the chain is built from scratch with the full FIXING / CHANNEL / GO TO / FIND / CLICK / SET / A/B CHECK / METER CHECK / STOP WHEN / RESULT daw_instructions block on Stereo Out.

(M4) OUTPUT MUST DIFFER + EXPLICIT BRANCH LABEL (HARD): the mastering section text MUST visibly differ between the two branches so the user immediately understands which path they are reading. The MAIN ISSUE line MUST start with the literal classification verdict: either "Track is already mastered" (followed by the measured numbers per M1) or "Track is unmastered" (followed by the measured numbers per M1). The FIX bullets MUST be drawn from the M2 refinement set OR the M3 full-chain set — NEVER mixed. The daw_instructions entries that target the Stereo Out / Mastering channel MUST also follow the same branch (refinement-grade entries for mastered tracks; full mastering-chain entries for unmastered tracks). HARD OVERRIDE: when the track is ALREADY at -8 to -9 LUFS integrated, the PRO MODE (P3) "push to the loud end" guidance is REVERSED — do NOT push it further; pushing an already-loud master toward more limiting is over-mastering and audible damage. The same override applies to any earlier rule that would request more loudness on a track that is already at its commercial loudness target.

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
    genre_source:     genreSource,
    detected_genre:   detectedGenre || null,
    final_genre_used: finalGenre   || null,
  }

  return { ok: true, report }
}
