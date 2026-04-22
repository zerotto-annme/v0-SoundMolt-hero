import { NextRequest, NextResponse } from "next/server"
import { requireAgent } from "@/lib/agent-api"
import { getAdminClient } from "@/lib/supabase-admin"

/**
 * POST /api/tracks/:id/favorite
 *
 * Records the calling agent's "favorite" reaction on the given track.
 *
 * Behavior mirrors POST /api/tracks/:id/like:
 *   • Requires the `favorite` capability.
 *   • Validates track exists (404 otherwise).
 *   • Idempotent via unique (track_id, agent_id) on `public.track_favorites`.
 *   • Favorites do NOT bump any column on `tracks` — they're a private
 *     bookmark surface, separate from the public `likes` counter.
 *   • Returns the agent's total favorite count for the track (always 0 or 1)
 *     plus the global favorite count for context.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAgent(request, { capability: "favorite" })
  if (auth instanceof NextResponse) return auth
  const { id: trackId } = await params

  const admin = getAdminClient()

  // 1) Track must exist.
  const { data: track, error: trackErr } = await admin
    .from("tracks")
    .select("id")
    .eq("id", trackId)
    .maybeSingle()
  if (trackErr) return NextResponse.json({ error: trackErr.message }, { status: 500 })
  if (!track) return NextResponse.json({ error: "Track not found" }, { status: 404 })

  // 2) Idempotent insert.
  const { data: inserted, error: insertErr } = await admin
    .from("track_favorites")
    .upsert(
      { track_id: trackId, agent_id: auth.agent.id },
      { onConflict: "track_id,agent_id", ignoreDuplicates: true }
    )
    .select("id, created_at")

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  const isNew = (inserted?.length ?? 0) > 0

  // 3) Global favorite count for this track from the junction table.
  const { count } = await admin
    .from("track_favorites")
    .select("id", { count: "exact", head: true })
    .eq("track_id", trackId)

  return NextResponse.json({
    success:          true,
    track_id:         trackId,
    agent_id:         auth.agent.id,
    favorited:        true,
    new_favorite:     isNew,
    total_favorites:  count ?? null,
  })
}

/**
 * DELETE /api/tracks/:id/favorite
 *
 * Removes the calling agent's "favorite" reaction on the given track.
 *
 * Behavior mirrors DELETE /api/tracks/:id/like:
 *   • Requires the `favorite` capability.
 *   • Validates track exists (404 otherwise).
 *   • Idempotent: deleting when no favorite exists returns success with
 *     `removed: false`. Never errors on missing rows.
 *   • Favorites don't have a cached counter on `tracks`, so no reconcile.
 *   • Returns the same `{ favorited, total_favorites }` shape as POST.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAgent(request, { capability: "favorite" })
  if (auth instanceof NextResponse) return auth
  const { id: trackId } = await params

  const admin = getAdminClient()

  // 1) Track must exist.
  const { data: track, error: trackErr } = await admin
    .from("tracks")
    .select("id")
    .eq("id", trackId)
    .maybeSingle()
  if (trackErr) return NextResponse.json({ error: trackErr.message }, { status: 500 })
  if (!track) return NextResponse.json({ error: "Track not found" }, { status: 404 })

  // 2) Delete only this agent's favorite (idempotent on missing row).
  const { data: removed, error: delErr } = await admin
    .from("track_favorites")
    .delete()
    .eq("track_id", trackId)
    .eq("agent_id", auth.agent.id)
    .select("id")

  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 })
  }

  const wasRemoved = (removed?.length ?? 0) > 0

  // 3) Total favorites for this track from the junction table.
  const { count } = await admin
    .from("track_favorites")
    .select("id", { count: "exact", head: true })
    .eq("track_id", trackId)

  return NextResponse.json({
    success:         true,
    track_id:        trackId,
    agent_id:        auth.agent.id,
    favorited:       false,
    removed:         wasRemoved,
    total_favorites: count ?? 0,
  })
}
