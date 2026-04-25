import { NextRequest, NextResponse } from "next/server"
import { getAdminClient, getUserFromAuthHeader } from "@/lib/supabase-admin"

/**
 * POST /api/me/likes/:trackId
 *
 * Records the calling SITE USER's "like" reaction on the given track.
 * Mirrors POST /api/tracks/:id/like (which is for AGENTS) — both write
 * to the same `public.track_likes` junction table, so every
 * public-facing display reflects user + agent likes combined.
 *
 * Auth: Supabase user JWT in `Authorization: Bearer <jwt>`.
 *
 * Behavior:
 *   • Requires an authenticated user (401 otherwise).
 *   • Validates the track exists (404 otherwise).
 *   • Idempotent via UNIQUE (track_id, user_id): re-liking the same
 *     track is a no-op and returns `new_like: false`.
 *   • Re-syncs the cached `tracks.likes` column to the junction-table
 *     COUNT(*) on every call (the `increment_track_likes` RPC is not
 *     in the live schema cache, so we keep the cached counter accurate
 *     by writing the truth on each toggle — see comments below).
 *   • Returns the FULL display total (organic junction count + admin
 *     boost from `track_boost_totals`) as both `total_likes` and
 *     `count`, so the UI can snap directly to the response without
 *     needing to re-fold the boost client-side.
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

  // 3) Junction-table truth count (organic only — does not include boost).
  const { count } = await admin
    .from("track_likes")
    .select("id", { count: "exact", head: true })
    .eq("track_id", trackId)

  // 4) Sync the cached `tracks.likes` column to match the junction
  //    truth. We previously called the `increment_track_likes` RPC, but
  //    that function isn't registered in the live schema cache (PGRST202
  //    "could not find the function"), so the cached counter never
  //    bumped and the modal/feed showed 0 after refresh. Writing the
  //    real count here is self-correcting: even if a prior call missed
  //    or the column drifted for any reason, every like/unlike puts it
  //    back in sync. Junction-truth wins.
  //
  //    Concurrency note: SELECT-then-UPDATE is not atomic, so under heavy
  //    concurrent toggles the cached column may briefly drift by one. The
  //    next like/unlike on the same track corrects it, and the truth
  //    (junction table) is never wrong — only the display cache lags by
  //    at most one operation. Acceptable for a cached counter.
  if (typeof count === "number") {
    const { error: syncErr } = await admin
      .from("tracks")
      .update({ likes: count })
      .eq("id", trackId)
    if (syncErr) {
      console.error("[me/likes POST] cached count sync failed:", {
        code: syncErr.code, message: syncErr.message, track: trackId,
      })
    }
  }

  // 5) Fold in admin boost so the response value matches what the
  //    feed pipeline shows everywhere else. Without this, snapping the
  //    UI to `total_likes` would visually drop the boost amount on
  //    boosted tracks the moment a user likes/unlikes. Graceful if the
  //    boost view doesn't exist (every track gets 0).
  let boostLikes = 0
  try {
    const { data: boost } = await admin
      .from("track_boost_totals")
      .select("total_boost_likes")
      .eq("track_id", trackId)
      .maybeSingle()
    boostLikes = Number((boost as { total_boost_likes?: number } | null)?.total_boost_likes ?? 0)
  } catch {
    // ignore — boost is purely additive
  }
  const organic = count ?? 0
  const displayTotal = organic + boostLikes

  return NextResponse.json({
    ok:           true,
    success:      true,
    track_id:     trackId,
    user_id:      user.id,
    liked:        true,
    new_like:     isNew,
    total_likes:  displayTotal,    // organic + boost — what the UI shows
    organic_likes: organic,        // junction-only count
    boost_likes:  boostLikes,
    count:        displayTotal,
  })
}

/**
 * DELETE /api/me/likes/:trackId
 *
 * Removes the calling user's like. Mirror of POST.
 *
 * Idempotent: deleting when no like exists returns success with
 * `removed: false`. On every call we re-sync the cached `tracks.likes`
 * column to the junction-table COUNT(*) (same self-correcting pattern
 * as POST). Returns the FULL display total (organic + boost) as
 * `total_likes` and `count` so the UI can snap directly to it.
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
    console.error("[me/likes DELETE] delete failed:", {
      code: delErr.code, message: delErr.message,
      details: delErr.details, hint: delErr.hint, track: trackId, user: user.id,
    })
    return NextResponse.json(
      { error: delErr.message, code: delErr.code, details: delErr.details },
      { status: 500 }
    )
  }

  const wasRemoved = (removed?.length ?? 0) > 0

  const { count } = await admin
    .from("track_likes")
    .select("id", { count: "exact", head: true })
    .eq("track_id", trackId)

  // Sync cached counter to junction truth (see POST handler comment).
  if (typeof count === "number") {
    const { error: syncErr } = await admin
      .from("tracks")
      .update({ likes: count })
      .eq("id", trackId)
    if (syncErr) {
      console.error("[me/likes DELETE] cached count sync failed:", {
        code: syncErr.code, message: syncErr.message, track: trackId,
      })
    }
  }

  // Boost-fold for display parity (see POST).
  let boostLikes = 0
  try {
    const { data: boost } = await admin
      .from("track_boost_totals")
      .select("total_boost_likes")
      .eq("track_id", trackId)
      .maybeSingle()
    boostLikes = Number((boost as { total_boost_likes?: number } | null)?.total_boost_likes ?? 0)
  } catch {
    // ignore — boost is purely additive
  }
  const organic = count ?? 0
  const displayTotal = organic + boostLikes

  return NextResponse.json({
    ok:           true,
    success:      true,
    track_id:     trackId,
    user_id:      user.id,
    liked:         false,
    removed:       wasRemoved,
    total_likes:   displayTotal,    // organic + boost — what the UI shows
    organic_likes: organic,
    boost_likes:   boostLikes,
    count:         displayTotal,
  })
}
