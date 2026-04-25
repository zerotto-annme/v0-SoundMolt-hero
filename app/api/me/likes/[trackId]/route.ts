import { NextRequest, NextResponse } from "next/server"
import { getAdminClient, getUserFromAuthHeader } from "@/lib/supabase-admin"

/**
 * POST /api/me/likes/:trackId
 *
 * Records the calling SITE USER's "like" reaction on the given track.
 * Mirrors POST /api/tracks/:id/like (which is for AGENTS) — both write
 * to the same `public.track_likes` junction table and bump the same
 * cached `tracks.likes` counter via the `increment_track_likes` RPC,
 * so every public-facing display reflects user + agent likes combined.
 *
 * Auth: Supabase user JWT in `Authorization: Bearer <jwt>`.
 *
 * Behavior:
 *   • Requires an authenticated user (401 otherwise).
 *   • Validates the track exists (404 otherwise).
 *   • Idempotent via UNIQUE (track_id, user_id): re-liking the same
 *     track is a no-op and returns `new_like: false`.
 *   • On a fresh like only, atomically bumps `tracks.likes` via the
 *     existing increment RPC (single SQL UPDATE = no lost updates
 *     under concurrent likes from different users / agents).
 *   • Returns the total like count from the junction table so callers
 *     always see the ground-truth count.
 *
 * Note: the displayed "X likes" everywhere in the app is the cached
 * `tracks.likes` (organic) PLUS any admin boost from track_boost_totals,
 * folded together by the BrowseFeed pipeline. Boosts are NOT included
 * in this endpoint's `total_likes` — that field is the organic-only
 * junction-table count. The UI updates the displayed total optimistically.
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

  // 1) Track must exist.
  const { data: track, error: trackErr } = await admin
    .from("tracks")
    .select("id")
    .eq("id", trackId)
    .maybeSingle()
  if (trackErr) {
    console.error("[me/likes] track lookup failed:", {
      code: trackErr.code, message: trackErr.message,
      details: trackErr.details, hint: trackErr.hint, track: trackId, user: user.id,
    })
    return NextResponse.json(
      { error: trackErr.message, code: trackErr.code, details: trackErr.details },
      { status: 500 }
    )
  }
  if (!track) return NextResponse.json({ error: "Track not found" }, { status: 404 })

  // 2) Idempotent insert.
  const { data: inserted, error: insertErr } = await admin
    .from("track_likes")
    .upsert(
      { track_id: trackId, user_id: user.id },
      { onConflict: "track_id,user_id", ignoreDuplicates: true }
    )
    .select("id, created_at")

  if (insertErr) {
    // Surface PG error code + details to the server log so a missing
    // constraint / FK / RLS issue is obvious instead of a bare 500.
    console.error("[me/likes POST] insert failed:", {
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

  // 3) Bump cached counter only on first like for this user.
  if (isNew) {
    const { error: bumpErr } = await admin.rpc("increment_track_likes", {
      p_track_id: trackId,
    })
    if (bumpErr) {
      console.error("[me/likes POST] counter bump failed:", bumpErr.message)
    }
  }

  // 4) Junction-table truth count (organic only — does not include boost).
  const { count } = await admin
    .from("track_likes")
    .select("id", { count: "exact", head: true })
    .eq("track_id", trackId)

  return NextResponse.json({
    success:     true,
    track_id:    trackId,
    user_id:     user.id,
    liked:       true,
    new_like:    isNew,
    total_likes: count ?? null,
  })
}

/**
 * DELETE /api/me/likes/:trackId
 *
 * Removes the calling user's like. Mirror of POST.
 *
 * Idempotent: deleting when no like exists returns success with
 * `removed: false`. On removal, atomically decrements the cached
 * `tracks.likes` counter via the decrement RPC (floors at zero).
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

  // 1) Track must exist.
  const { data: track, error: trackErr } = await admin
    .from("tracks")
    .select("id")
    .eq("id", trackId)
    .maybeSingle()
  if (trackErr) {
    console.error("[me/likes] track lookup failed:", {
      code: trackErr.code, message: trackErr.message,
      details: trackErr.details, hint: trackErr.hint, track: trackId, user: user.id,
    })
    return NextResponse.json(
      { error: trackErr.message, code: trackErr.code, details: trackErr.details },
      { status: 500 }
    )
  }
  if (!track) return NextResponse.json({ error: "Track not found" }, { status: 404 })

  // 2) Delete only this user's like (idempotent on missing row).
  const { data: removed, error: delErr } = await admin
    .from("track_likes")
    .delete()
    .eq("track_id", trackId)
    .eq("user_id", user.id)
    .select("id")

  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 })
  }

  const wasRemoved = (removed?.length ?? 0) > 0

  if (wasRemoved) {
    const { error: bumpErr } = await admin.rpc("decrement_track_likes", {
      p_track_id: trackId,
    })
    if (bumpErr) {
      console.error("[me/likes DELETE] counter bump failed:", bumpErr.message)
    }
  }

  const { count } = await admin
    .from("track_likes")
    .select("id", { count: "exact", head: true })
    .eq("track_id", trackId)

  return NextResponse.json({
    success:     true,
    track_id:    trackId,
    user_id:     user.id,
    liked:       false,
    removed:     wasRemoved,
    total_likes: count ?? 0,
  })
}
