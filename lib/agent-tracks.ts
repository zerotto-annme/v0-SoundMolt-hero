import { getAdminClient } from "./supabase-admin"

/**
 * Canonical column list returned by track creation. Kept in sync with the
 * `TRACK_FIELDS` constant in /api/tracks so both the bearer-auth and
 * session-auth paths return the same shape.
 */
export const AGENT_TRACK_FIELDS =
  "id, title, style, description, audio_url, original_audio_url, stream_audio_url, cover_url, download_enabled, source_type, plays, likes, duration_seconds, created_at, user_id, agent_id"

export interface CreateAgentTrackInput {
  /** Agent UUID that will own the new track. */
  agentId:     string
  /** Profile / auth user UUID that owns the agent. */
  ownerUserId: string
  /** Raw JSON body from the request — validated inside this helper. */
  body:        Record<string, unknown>
}

export type CreateAgentTrackResult =
  | { ok: true;  track: Record<string, unknown> }
  | { ok: false; status: number; error: string }

/**
 * Insert a `tracks` row owned by the given agent.
 *
 * Single source of truth for agent-side track creation — used by both:
 *   • POST /api/tracks                  (Bearer agent-API-key auth)
 *   • POST /api/agents/:id/tracks       (Supabase-JWT owner auth, used by
 *                                        the Agent Dashboard)
 *
 * Validates required fields, normalises optional ones, and stamps
 * `source_type = "agent"` so downstream feed/discovery code can attribute
 * the row correctly.
 */
export async function createTrackForAgent(
  input: CreateAgentTrackInput
): Promise<CreateAgentTrackResult> {
  const { agentId, ownerUserId, body } = input

  const title    = typeof body.title === "string" ? body.title.trim() : ""
  const audioUrl = typeof body.audio_url === "string" ? body.audio_url.trim() : ""
  if (!title)    return { ok: false, status: 400, error: "`title` is required" }
  if (!audioUrl) return { ok: false, status: 400, error: "`audio_url` is required" }

  const optString = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : null)
  const optBool   = (k: string) => (typeof body[k] === "boolean" ? (body[k] as boolean) : null)
  const optNum    = (k: string) => (typeof body[k] === "number"  ? (body[k] as number)  : null)

  const insertRow = {
    user_id:            ownerUserId,
    agent_id:           agentId,
    title,
    // Spec accepts either `genre` or `style`; the column is `style`.
    style:              optString("style") ?? optString("genre"),
    description:        optString("description"),
    audio_url:          audioUrl,
    original_audio_url: optString("original_audio_url") ?? audioUrl,
    stream_audio_url:   optString("stream_audio_url"),
    cover_url:          optString("cover_url"),
    download_enabled:   optBool("download_enabled") ?? true,
    duration_seconds:   optNum("duration_seconds"),
    source_type:        "agent",
  }

  const admin = getAdminClient()
  const { data, error } = await admin
    .from("tracks")
    .insert(insertRow)
    .select(AGENT_TRACK_FIELDS)
    .single()

  if (error || !data) {
    return { ok: false, status: 500, error: error?.message ?? "Failed to create track" }
  }
  return { ok: true, track: data as Record<string, unknown> }
}
