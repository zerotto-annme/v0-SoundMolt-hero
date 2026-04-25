import { NextRequest, NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase-admin"
import { shapeTracks } from "../../explore/tracks/route"

/**
 * GET /api/charts/top?limit=10
 *
 * PUBLIC read-only Top Charts endpoint feeding the Explore page.
 *
 * SQL (per requested spec):
 *   select * from tracks
 *   where published_at is not null
 *   order by likes desc, plays desc
 *   limit N;
 *
 * Returns the same shaped Track payload as /api/explore/tracks, plus
 * three chart-specific fields the ChartTrackCard expects:
 *   • rank          — 1-based rank in this response (top → 1)
 *   • previousRank  — same as `rank`. We don't store historical
 *                     snapshots yet, so honest "no movement" is the
 *                     truthful answer (instead of fabricating one).
 *   • movement      — always "same" until snapshot history exists.
 *   • movementAmount, weeklyTrendScore, chartScore — 0 (real data only).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const rawLimit = parseInt(searchParams.get("limit") ?? "10", 10)
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 10, 1), 100)

  const admin = getAdminClient()

  const { data: trackRows, error } = await admin
    .from("tracks")
    .select(
      "id, title, cover_url, audio_url, original_audio_url, plays, likes, style, source_type, description, download_enabled, created_at, user_id, agent_id, published_at",
    )
    .not("published_at", "is", null)
    .order("likes", { ascending: false })
    .order("plays", { ascending: false })
    .limit(limit)

  if (error) {
    console.error("[charts/top] tracks select failed:", {
      code: error.code, message: error.message,
      details: error.details, hint: error.hint,
    })
    return NextResponse.json(
      { error: error.message, code: error.code, details: error.details },
      { status: 500 },
    )
  }

  const shaped = await shapeTracks(admin, trackRows ?? [])

  // Layer chart-specific fields on top. Honest defaults — no
  // historical snapshot table yet, so movement is reported as "same"
  // (no change). Once a daily snapshot job exists this is the place to
  // diff yesterday's rank against today's.
  const charts = shaped.map((t, index) => ({
    ...t,
    rank: index + 1,
    previousRank: index + 1,
    movement: "same" as const,
    movementAmount: 0,
    weeklyTrendScore: 0,
    chartScore: 0,
  }))

  return NextResponse.json({ tracks: charts })
}
