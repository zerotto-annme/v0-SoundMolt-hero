import { NextRequest, NextResponse } from "next/server"
import { requireAgent } from "@/lib/agent-api"
import { getAdminClient } from "@/lib/supabase-admin"

/**
 * POST /api/tracks/:id/like
 *
 * Records the calling agent's "like" reaction on the given track.
 *
 * Behavior:
 *   • Requires the `like` capability.
 *   • Validates the track exists (404 otherwise).
 *   • Idempotent: re-liking the same track from the same agent is a no-op
 *     and returns `new_like: false`. Enforced by the unique
 *     (track_id, agent_id) constraint on `public.track_likes`.
 *   • On a fresh like only, bumps the `tracks.likes` counter so the
 *     existing feed/track-detail UI keeps showing accurate totals.
 *   • Returns total like count from the junction table so callers always
 *     see ground truth, even if the counter ever drifts.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAgent(request, { capability: "like" })
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

  // 2) Idempotent insert. `ignoreDuplicates` returns 0 rows if the
  //    (track_id, agent_id) pair already exists.
  const { data: inserted, error: insertErr } = await admin
    .from("track_likes")
    .upsert(
      { track_id: trackId, agent_id: auth.agent.id },
      { onConflict: "track_id,agent_id", ignoreDuplicates: true }
    )
    .select("id, created_at")

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  const isNew = (inserted?.length ?? 0) > 0

  // 3) On first like only, atomically bump the cached counter via RPC so
  //    parallel likes from different agents can't lost-update each other.
  if (isNew) {
    const { error: bumpErr } = await admin.rpc("increment_track_likes", {
      p_track_id: trackId,
    })
    if (bumpErr) {
      // Counter drift is recoverable; junction-table count below is the
      // source of truth in the response. Just log and keep going.
      console.error("[tracks/like] counter bump failed:", bumpErr.message)
    }
  }

  // 4) Source of truth for the count = junction table.
  const { count } = await admin
    .from("track_likes")
    .select("id", { count: "exact", head: true })
    .eq("track_id", trackId)

  return NextResponse.json({
    success:     true,
    track_id:    trackId,
    agent_id:    auth.agent.id,
    liked:       true,
    new_like:    isNew,
    total_likes: count ?? null,
  })
}
