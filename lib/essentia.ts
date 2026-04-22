/**
 * Essentia analysis integration.
 *
 * Calls the external Essentia microservice to extract audio features
 * (BPM, key, mood, energy, …) for a freshly-created track and persists
 * the result into the existing `track_analysis` table with
 * provider="essentia". Designed to be fire-and-forget-safe: any failure
 * is caught and logged so it can never break the parent track-create
 * request.
 *
 * Endpoint:  POST {ESSENTIA_API_URL}/analyze
 * Field:     file (multipart/form-data)
 * Response:  arbitrary JSON — stored verbatim in `results`. If the
 *            response contains a string `summary` (or `interpretation`)
 *            field we lift it into the dedicated `summary` column.
 */
import { getAdminClient } from "./supabase-admin"

export const ESSENTIA_API_URL =
  process.env.ESSENTIA_API_URL ?? "https://essentia-service-production.up.railway.app"

/** Hard cap on how long we wait for Essentia before giving up. */
const ESSENTIA_TIMEOUT_MS = 120_000

export interface EssentiaJobInput {
  trackId:     string
  agentId:     string | null
  ownerUserId: string
  audioUrl:    string
}

export type EssentiaJobResult =
  | { ok: true;  analysis_id: string; provider: "essentia"; version: "1.0" }
  | { ok: false; error: string; stage: "fetch" | "analyze" | "store" | "config" | "ssrf" }

/**
 * SSRF guard. Audio URLs are agent-controlled, and we fetch them
 * server-side to forward bytes to Essentia. Without this check an
 * attacker holding an agent key could probe internal infrastructure
 * (cloud metadata, private subnets, localhost services). We restrict
 * to https + a small set of approved storage hosts, and explicitly
 * reject loopback / private / link-local literals.
 */
const ALLOWED_HOST_SUFFIXES = [
  ".supabase.co",       // Supabase Storage (this app's primary bucket)
  ".soundhelix.com",    // public sample audio used in test fixtures
  ".s3.amazonaws.com",  // common public S3 buckets
  ".r2.cloudflarestorage.com",
  ".cdn.replit.dev",
]
function isPrivateOrLoopbackHost(host: string): boolean {
  if (host === "localhost" || host === "0.0.0.0") return true
  // IPv6 loopback / unique local
  if (host === "::1" || host.startsWith("[::1") || /^\[fc|^\[fd/i.test(host)) return true
  // IPv4 literal in dotted form
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false
  const [a, b] = [+m[1], +m[2]]
  if (a === 10) return true                        // 10.0.0.0/8
  if (a === 127) return true                       // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true          // 169.254.0.0/16 link-local (incl. cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 192 && b === 168) return true          // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true// 100.64.0.0/10 carrier-grade NAT
  if (a === 0) return true                         // 0.0.0.0/8
  return false
}
function assertSafeAudioUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let u: URL
  try { u = new URL(raw) } catch { return { ok: false, reason: "invalid URL" } }
  if (u.protocol !== "https:") return { ok: false, reason: `scheme ${u.protocol} not allowed (https only)` }
  const host = u.hostname.toLowerCase()
  if (isPrivateOrLoopbackHost(host)) return { ok: false, reason: `private/loopback host blocked (${host})` }
  if (!ALLOWED_HOST_SUFFIXES.some((s) => host === s.replace(/^\./, "") || host.endsWith(s))) {
    return { ok: false, reason: `host not in allowlist (${host})` }
  }
  return { ok: true, url: u }
}

/**
 * Run the full pipeline: fetch audio bytes → POST to Essentia → save
 * result into `track_analysis`. Always resolves; never throws.
 */
export async function analyzeTrackWithEssentia(
  input: EssentiaJobInput
): Promise<EssentiaJobResult> {
  const { trackId, agentId, ownerUserId, audioUrl } = input

  if (!audioUrl) {
    return { ok: false, error: "audio_url missing", stage: "config" }
  }

  // SSRF guard — see ALLOWED_HOST_SUFFIXES / isPrivateOrLoopbackHost above.
  const safe = assertSafeAudioUrl(audioUrl)
  if (!safe.ok) {
    return { ok: false, error: safe.reason, stage: "ssrf" }
  }

  // 1) Fetch the audio file bytes from the hosted URL the agent supplied.
  //    The track-create endpoints already accept hosted URLs (Supabase
  //    Storage / external) so we re-fetch here rather than requiring the
  //    raw bytes to be plumbed through the request layer.
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
    // Best-effort filename for the multipart part — Essentia uses the
    // extension to pick a decoder.
    try {
      const u  = new URL(audioUrl)
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

  // 2) POST multipart/form-data to {ESSENTIA_API_URL}/analyze, field="file".
  let results: Record<string, unknown>
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
    results = json as Record<string, unknown>
  } catch (err) {
    return {
      ok: false,
      error: `essentia call failed: ${err instanceof Error ? err.message : String(err)}`,
      stage: "analyze",
    }
  }

  // 3) Lift a human-readable summary out of the response if Essentia
  //    provides one (the field name varies across versions of the
  //    service — try the common ones).
  const summaryCandidate =
    typeof results.summary        === "string" ? results.summary        :
    typeof results.interpretation === "string" ? results.interpretation :
    null

  // 4) Persist to the existing track_analysis table. Schema fields used
  //    here come straight from migration 028; no schema changes needed.
  //    Wrapped in try/catch because getAdminClient() can throw if the
  //    service-role env vars are missing — this helper must NEVER throw.
  try {
    const admin = getAdminClient()
    const { data, error } = await admin
      .from("track_analysis")
      .insert({
        track_id:      trackId,
        agent_id:      agentId,
        owner_user_id: ownerUserId,
        provider:      "essentia",
        version:       "1.0",
        results,
        summary:       summaryCandidate,
      })
      .select("id")
      .single()

    if (error || !data) {
      return {
        ok: false,
        error: error?.message ?? "insert failed",
        stage: "store",
      }
    }

    return { ok: true, analysis_id: data.id, provider: "essentia", version: "1.0" }
  } catch (err) {
    return {
      ok: false,
      error: `store failed: ${err instanceof Error ? err.message : String(err)}`,
      stage: "store",
    }
  }
}
