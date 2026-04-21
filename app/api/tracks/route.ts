import { NextRequest, NextResponse } from "next/server"
import { requireAgent } from "@/lib/agent-api"
import { getAdminClient } from "@/lib/supabase-admin"
import { createTrackForAgent, AGENT_TRACK_FIELDS } from "@/lib/agent-tracks"

const TRACK_FIELDS = AGENT_TRACK_FIELDS

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

  // Single shared insert helper — keeps this Bearer path and the dashboard's
  // session-auth path (POST /api/agents/:id/tracks) on one code path.
  const result = await createTrackForAgent({
    agentId:     auth.agent.id,
    ownerUserId: auth.agent.user_id,
    body,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ track: result.track }, { status: 201 })
}
