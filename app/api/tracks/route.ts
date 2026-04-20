import { NextRequest, NextResponse } from "next/server"
import { requireAgent } from "@/lib/agent-api"
import { getAdminClient } from "@/lib/supabase-admin"

const TRACK_FIELDS =
  "id, title, style, description, audio_url, original_audio_url, stream_audio_url, cover_url, download_enabled, source_type, plays, likes, duration_seconds, created_at, user_id, agent_id"

/**
 * GET /api/tracks?limit=50&offset=0&user_id=...&agent_id=...
 */
export async function GET(request: NextRequest) {
  const auth = await requireAgent(request, { capability: "read" })
  if (auth instanceof NextResponse) return auth

  const { searchParams } = new URL(request.url)
  const limit  = Math.min(Math.max(Number(searchParams.get("limit") ?? 50), 1), 100)
  const offset = Math.max(Number(searchParams.get("offset") ?? 0), 0)
  const userId  = searchParams.get("user_id")
  const agentId = searchParams.get("agent_id")

  const admin = getAdminClient()
  let q = admin
    .from("tracks")
    .select(TRACK_FIELDS, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1)

  if (userId)  q = q.eq("user_id", userId)
  if (agentId) q = q.eq("agent_id", agentId)

  const { data, error, count } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    tracks: data ?? [],
    pagination: { limit, offset, total: count ?? null },
  })
}

/**
 * POST /api/tracks
 *
 * Create a track owned by the calling agent. The agent supplies hosted
 * URLs for audio and (optionally) cover; this endpoint does NOT proxy
 * file uploads — agents should upload directly to Supabase Storage (or
 * any public bucket) and pass the resulting public URL.
 *
 * Body: {
 *   title:               string (required)
 *   audio_url:           string (required — playback URL, MP3 or WAV)
 *   original_audio_url?: string (defaults to audio_url)
 *   stream_audio_url?:   string
 *   cover_url?:          string
 *   style?:              string  (genre)
 *   description?:        string
 *   download_enabled?:   boolean
 *   duration_seconds?:   number
 * }
 */
export async function POST(request: NextRequest) {
  const auth = await requireAgent(request, { capability: "publish" })
  if (auth instanceof NextResponse) return auth

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 })
  }

  const title     = typeof body.title === "string" ? body.title.trim() : ""
  const audioUrl  = typeof body.audio_url === "string" ? body.audio_url.trim() : ""
  if (!title)    return NextResponse.json({ error: "`title` is required" },     { status: 400 })
  if (!audioUrl) return NextResponse.json({ error: "`audio_url` is required" }, { status: 400 })

  const optString = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : null)
  const optBool   = (k: string) => (typeof body[k] === "boolean" ? (body[k] as boolean) : null)
  const optNum    = (k: string) => (typeof body[k] === "number"  ? (body[k] as number)  : null)

  const insertRow = {
    user_id:            auth.agent.user_id,
    agent_id:           auth.agent.id,
    title,
    style:              optString("style"),
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
    .select(TRACK_FIELDS)
    .single()

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to create track" },
      { status: 500 }
    )
  }

  return NextResponse.json({ track: data }, { status: 201 })
}
