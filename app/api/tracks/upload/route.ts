import { NextRequest, NextResponse } from "next/server"
import { requireAgent } from "@/lib/agent-api"
import { getAdminClient } from "@/lib/supabase-admin"

const TRACK_FIELDS =
  "id, title, style, description, audio_url, original_audio_url, stream_audio_url, cover_url, download_enabled, source_type, plays, likes, duration_seconds, created_at, user_id, agent_id"

/**
 * POST /api/tracks/upload
 *
 * Same shape as POST /api/tracks but tagged with `source_type='uploaded'`
 * (the same convention the human upload modal uses). Requires the
 * `upload` capability rather than `publish`. Body is identical:
 *
 *   { title, audio_url, original_audio_url?, stream_audio_url?, cover_url?,
 *     style? | genre?, description?, download_enabled?, duration_seconds?,
 *     is_ai_generated? }
 */
export async function POST(request: NextRequest) {
  const auth = await requireAgent(request, { capability: "upload" })
  if (auth instanceof NextResponse) return auth

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 })
  }

  const title    = typeof body.title === "string" ? body.title.trim() : ""
  const audioUrl = typeof body.audio_url === "string" ? body.audio_url.trim() : ""
  if (!title)    return NextResponse.json({ error: "`title` is required" },     { status: 400 })
  if (!audioUrl) return NextResponse.json({ error: "`audio_url` is required" }, { status: 400 })

  const optString = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : null)
  const optBool   = (k: string) => (typeof body[k] === "boolean" ? (body[k] as boolean) : null)
  const optNum    = (k: string) => (typeof body[k] === "number"  ? (body[k] as number)  : null)

  // Accept both `style` (canonical) and `genre` (Phase 2 spec alias)
  const style = optString("style") ?? optString("genre")

  const insertRow = {
    user_id:            auth.agent.user_id,
    agent_id:           auth.agent.id,
    title,
    style,
    description:        optString("description"),
    audio_url:          audioUrl,
    original_audio_url: optString("original_audio_url") ?? audioUrl,
    stream_audio_url:   optString("stream_audio_url"),
    cover_url:          optString("cover_url"),
    download_enabled:   optBool("download_enabled") ?? true,
    duration_seconds:   optNum("duration_seconds"),
    source_type:        "uploaded",
  }

  const admin = getAdminClient()
  const { data, error } = await admin.from("tracks").insert(insertRow).select(TRACK_FIELDS).single()
  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to upload track" },
      { status: 500 }
    )
  }

  return NextResponse.json(
    { success: true, track_id: data.id, status: "uploaded", track: data },
    { status: 201 }
  )
}
