import { NextRequest, NextResponse } from "next/server"
import { requireAgent } from "@/lib/agent-api"
import { getAdminClient } from "@/lib/supabase-admin"

/**
 * POST /api/tracks/:id/publish
 *
 * Marks the calling agent's track as explicitly published. Today every
 * track is immediately discoverable on creation, so this endpoint is the
 * forward-compatible publish lifecycle hook: it stamps `published_at` so
 * downstream features (draft-vs-published filtering, audit trails, etc.)
 * have a real signal to key off.
 *
 * Behavior:
 *   • Requires the `publish` capability.
 *   • Validates the track exists (404).
 *   • Validates the calling agent owns the track (`tracks.agent_id` ==
 *     authed agent id) — 403 otherwise.
 *   • Idempotent: if `published_at` is already set, returns the row
 *     unchanged with `was_already_published: true`. Otherwise stamps
 *     `published_at = now()`.
 *   • Returns the full track row including the new `published_at`.
 */
//
// NOTE: We use a route-local field list (instead of the shared
// AGENT_TRACK_FIELDS in lib/agent-tracks.ts) because `published_at` is a
// new column added in migration 033. Keeping the shared constant unchanged
// means the already-working track/feed routes don't accidentally start
// selecting a column that may not yet exist on every environment.
const TRACK_FIELDS_WITH_PUBLISHED =
  "id, title, style, description, audio_url, original_audio_url, stream_audio_url, " +
  "cover_url, download_enabled, source_type, plays, likes, duration_seconds, " +
  "created_at, user_id, agent_id, published_at"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAgent(request, { capability: "publish" })
  if (auth instanceof NextResponse) return auth
  const { id: trackId } = await params

  const admin = getAdminClient()

  // 1) Track exists + ownership check.
  const { data: existing, error: lookupErr } = await admin
    .from("tracks")
    .select("id, agent_id, published_at")
    .eq("id", trackId)
    .maybeSingle()

  if (lookupErr) {
    return NextResponse.json({ error: lookupErr.message }, { status: 500 })
  }
  if (!existing) {
    return NextResponse.json({ error: "Track not found" }, { status: 404 })
  }
  if (existing.agent_id !== auth.agent.id) {
    return NextResponse.json(
      { error: "Agents may only publish tracks they own" },
      { status: 403 }
    )
  }

  // 2) Idempotent publish.
  const wasAlreadyPublished = !!existing.published_at
  const nowIso = new Date().toISOString()

  // The .eq("agent_id", auth.agent.id) below makes the authorization
  // check and the write atomic — even if the row's agent_id changed
  // between the lookup above and this update, we still won't write to
  // a track the caller doesn't own.
  const { data, error } = await admin
    .from("tracks")
    .update({ published_at: existing.published_at ?? nowIso })
    .eq("id", trackId)
    .eq("agent_id", auth.agent.id)
    .select(TRACK_FIELDS_WITH_PUBLISHED)
    .single()

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to publish track" },
      { status: 500 }
    )
  }

  return NextResponse.json({
    success:                true,
    track_id:               trackId,
    published:              true,
    was_already_published:  wasAlreadyPublished,
    track:                  data,
  })
}
