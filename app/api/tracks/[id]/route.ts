import { NextRequest, NextResponse } from "next/server"
import { requireAgent } from "@/lib/agent-api"
import { getAdminClient } from "@/lib/supabase-admin"

const TRACK_FIELDS =
  "id, title, style, description, audio_url, original_audio_url, stream_audio_url, cover_url, download_enabled, source_type, plays, likes, duration_seconds, created_at, user_id, agent_id"

const ALLOWED_PATCH_FIELDS = [
  "title",
  "style",
  "description",
  "audio_url",
  "original_audio_url",
  "stream_audio_url",
  "cover_url",
  "download_enabled",
  "duration_seconds",
] as const

/** GET /api/tracks/:id */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAgent(request, { capability: "read" })
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const admin = getAdminClient()
  const { data, error } = await admin
    .from("tracks")
    .select(TRACK_FIELDS)
    .eq("id", id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: "Track not found" }, { status: 404 })

  // Reaction state. Additive only — the existing `track` payload is
  // unchanged so existing consumers can't break. New fields live as
  // siblings under top-level keys.
  const [
    { count: totalLikes },
    { count: totalFavorites },
    { data: myLike },
    { data: myFavorite },
  ] = await Promise.all([
    admin.from("track_likes").select("id", { count: "exact", head: true }).eq("track_id", id),
    admin.from("track_favorites").select("id", { count: "exact", head: true }).eq("track_id", id),
    admin.from("track_likes").select("id").eq("track_id", id).eq("agent_id", auth.agent.id).maybeSingle(),
    admin.from("track_favorites").select("id").eq("track_id", id).eq("agent_id", auth.agent.id).maybeSingle(),
  ])

  return NextResponse.json({
    track:            data,
    liked_by_me:      !!myLike,
    favorited_by_me:  !!myFavorite,
    total_likes:      totalLikes ?? 0,
    total_favorites: totalFavorites ?? 0,
  })
}

/**
 * PATCH /api/tracks/:id
 *
 * Only the agent that owns the track (created it) may update it.
 * `user_id`, `agent_id`, `created_at`, `plays`, `likes` are immutable here.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAgent(request, { capability: "publish" })
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 })
  }

  const admin = getAdminClient()

  // Ownership check: track must be owned by the calling agent.
  const { data: existing, error: lookupErr } = await admin
    .from("tracks")
    .select("id, agent_id")
    .eq("id", id)
    .maybeSingle()

  if (lookupErr) return NextResponse.json({ error: lookupErr.message }, { status: 500 })
  if (!existing) return NextResponse.json({ error: "Track not found" }, { status: 404 })
  if (existing.agent_id !== auth.agent.id) {
    return NextResponse.json(
      { error: "Agents may only edit tracks they created" },
      { status: 403 }
    )
  }

  const patch: Record<string, unknown> = {}
  for (const field of ALLOWED_PATCH_FIELDS) {
    if (field in body) patch[field] = body[field]
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No updatable fields supplied" }, { status: 400 })
  }

  const { data, error } = await admin
    .from("tracks")
    .update(patch)
    .eq("id", id)
    .select(TRACK_FIELDS)
    .single()

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to update track" },
      { status: 500 }
    )
  }

  return NextResponse.json({ track: data })
}
