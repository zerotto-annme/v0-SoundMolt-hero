import { NextRequest, NextResponse } from "next/server"
import { getAdminClient, getUserFromAuthHeader } from "@/lib/supabase-admin"

/**
 * POST /api/me/favorites/:trackId
 *
 * Records the calling SITE USER's "favorite" reaction on the given track.
 * Mirror of POST /api/me/likes/:trackId, but for the favorite junction
 * table. Favorites are a private bookmark surface — they do NOT bump any
 * column on `tracks` (the public Like counter is the only stat they
 * influence is none), so there's no RPC call here.
 *
 * Auth: Supabase user JWT in `Authorization: Bearer <jwt>`.
 * Idempotent via UNIQUE (track_id, user_id).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ trackId: string }> }
) {
  const user = await getUserFromAuthHeader(request)
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 })
  }
  const { trackId } = await params

  const admin = getAdminClient()

  const { data: track, error: trackErr } = await admin
    .from("tracks")
    .select("id")
    .eq("id", trackId)
    .maybeSingle()
  if (trackErr) {
    console.error("[me/favorites] track lookup failed:", {
      code: trackErr.code, message: trackErr.message,
      details: trackErr.details, hint: trackErr.hint, track: trackId, user: user.id,
    })
    return NextResponse.json(
      { error: trackErr.message, code: trackErr.code, details: trackErr.details },
      { status: 500 }
    )
  }
  if (!track) return NextResponse.json({ error: "Track not found" }, { status: 404 })

  const { data: inserted, error: insertErr } = await admin
    .from("track_favorites")
    .upsert(
      { track_id: trackId, user_id: user.id },
      { onConflict: "track_id,user_id", ignoreDuplicates: true }
    )
    .select("id, created_at")

  if (insertErr) {
    console.error("[me/favorites POST] insert failed:", {
      code:    insertErr.code,
      message: insertErr.message,
      details: insertErr.details,
      hint:    insertErr.hint,
      track:   trackId,
      user:    user.id,
    })
    return NextResponse.json(
      { error: insertErr.message, code: insertErr.code, details: insertErr.details },
      { status: 500 }
    )
  }

  const isNew = (inserted?.length ?? 0) > 0

  const { count } = await admin
    .from("track_favorites")
    .select("id", { count: "exact", head: true })
    .eq("track_id", trackId)

  return NextResponse.json({
    success:         true,
    track_id:        trackId,
    user_id:         user.id,
    favorited:       true,
    new_favorite:    isNew,
    total_favorites: count ?? null,
  })
}

/**
 * DELETE /api/me/favorites/:trackId
 *
 * Removes the calling user's favorite. Idempotent.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ trackId: string }> }
) {
  const user = await getUserFromAuthHeader(request)
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 })
  }
  const { trackId } = await params

  const admin = getAdminClient()

  const { data: track, error: trackErr } = await admin
    .from("tracks")
    .select("id")
    .eq("id", trackId)
    .maybeSingle()
  if (trackErr) {
    console.error("[me/favorites] track lookup failed:", {
      code: trackErr.code, message: trackErr.message,
      details: trackErr.details, hint: trackErr.hint, track: trackId, user: user.id,
    })
    return NextResponse.json(
      { error: trackErr.message, code: trackErr.code, details: trackErr.details },
      { status: 500 }
    )
  }
  if (!track) return NextResponse.json({ error: "Track not found" }, { status: 404 })

  const { data: removed, error: delErr } = await admin
    .from("track_favorites")
    .delete()
    .eq("track_id", trackId)
    .eq("user_id", user.id)
    .select("id")

  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 })
  }

  const wasRemoved = (removed?.length ?? 0) > 0

  const { count } = await admin
    .from("track_favorites")
    .select("id", { count: "exact", head: true })
    .eq("track_id", trackId)

  return NextResponse.json({
    success:         true,
    track_id:        trackId,
    user_id:         user.id,
    favorited:       false,
    removed:         wasRemoved,
    total_favorites: count ?? 0,
  })
}
