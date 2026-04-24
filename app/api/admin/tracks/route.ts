import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/admin-auth"

export const dynamic = "force-dynamic"

/**
 * GET /api/admin/tracks?limit=100&offset=0
 *
 * Returns a paginated list of every track on the platform with admin-only
 * fields: owner email, agent_id, published_at, audio_url presence flag,
 * and analysis presence flag.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request)
    if (!auth.ok) return auth.response
    const { admin } = auth

    const url = new URL(request.url)
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") ?? 100)))
    const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0))

  // Pull tracks (newest first). Service role bypasses RLS — admin sees all.
  // We pull the organic counters (plays/likes/downloads) so the admin can
  // compare them side-by-side with the boost values added by the Boost
  // Stats feature. Organic columns ARE the source of truth for analytics
  // and the recommendation engine — boosts live in a separate table.
  //
  // `downloads` was added in migration 015; on installations where that
  // migration hasn't been applied the column is missing. We retry the
  // SELECT without it instead of 500-ing the entire admin panel — the
  // counter just shows 0 and the rest of the page works normally.
  const FULL_SELECT =
    "id, title, user_id, agent_id, audio_url, published_at, created_at, plays, likes, downloads"
  const SAFE_SELECT =
    "id, title, user_id, agent_id, audio_url, published_at, created_at, plays, likes"

  // The downstream `t.downloads ?? 0` already handles a missing column
  // — we just need the SELECT itself to succeed. Note: `boost_downloads`
  // lives in `track_stat_boosts` (a separate table), so it's unaffected
  // by `tracks.downloads` being absent.
  let tracks: any[] | null = null
  {
    const r1 = await admin
      .from("tracks")
      .select(FULL_SELECT)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1)
    if (r1.error) {
      // 42703 = undefined_column. Anything else is genuinely unexpected,
      // but we still try the safe fallback rather than fail the page.
      console.warn(
        "[admin/tracks] full select failed, retrying without `downloads`:",
        r1.error.message,
      )
      const r2 = await admin
        .from("tracks")
        .select(SAFE_SELECT)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1)
      if (r2.error) {
        // Even the bare SELECT failed. We surface a 200 with an empty
        // list so the admin UI keeps working — every other section
        // (users, agents, health) loads independently.
        console.error("[admin/tracks] safe select also failed:", r2.error)
        return NextResponse.json(
          { tracks: [], limit, offset, warning: r2.error.message },
          { status: 200 },
        )
      }
      tracks = r2.data ?? []
    } else {
      tracks = r1.data ?? []
    }
  }

  const trackIds = (tracks ?? []).map((t) => t.id)
  const userIds = Array.from(new Set((tracks ?? []).map((t) => t.user_id).filter(Boolean)))

  // Which tracks have at least one analysis row?
  const analysedSet = new Set<string>()
  if (trackIds.length > 0) {
    const { data: analysisRows, error: aErr } = await admin
      .from("track_analysis")
      .select("track_id")
      .in("track_id", trackIds)
    if (aErr) {
      console.error("[admin/tracks] analysis lookup failed:", aErr)
    } else {
      for (const row of analysisRows ?? []) analysedSet.add(row.track_id)
    }
  }

  // Sum boost rows per track. The table may not yet exist on older
  // deployments (migration 038) — in that case we silently skip and
  // every track simply gets a zero-boost record. The admin UI still
  // renders the Boost button, applying it will surface the table-missing
  // error from the POST endpoint instead of failing this list query.
  const boostsByTrack = new Map<
    string,
    { plays: number; likes: number; downloads: number; count: number }
  >()
  if (trackIds.length > 0) {
    const { data: boostRows, error: bErr } = await admin
      .from("track_stat_boosts")
      .select("track_id, boost_plays, boost_likes, boost_downloads")
      .in("track_id", trackIds)
    if (bErr) {
      // PGRST205 / 42P01 = relation missing. Anything else is a real error
      // worth logging, but we still degrade gracefully — admin can see the
      // tracks list and apply the migration when ready.
      console.warn("[admin/tracks] boosts lookup failed:", bErr.message)
    } else {
      for (const b of boostRows ?? []) {
        const cur = boostsByTrack.get(b.track_id) ?? {
          plays: 0,
          likes: 0,
          downloads: 0,
          count: 0,
        }
        cur.plays += b.boost_plays ?? 0
        cur.likes += b.boost_likes ?? 0
        cur.downloads += b.boost_downloads ?? 0
        cur.count += 1
        boostsByTrack.set(b.track_id, cur)
      }
    }
  }

  // Resolve owner emails via auth.admin.getUserById (parallel, capped).
  const emailByUserId = new Map<string, string | null>()
  await Promise.all(
    userIds.slice(0, limit).map(async (uid) => {
      try {
        const { data, error: e } = await admin.auth.admin.getUserById(uid)
        if (!e && data?.user) emailByUserId.set(uid, data.user.email ?? null)
      } catch {
        /* swallow — display as unknown */
      }
    }),
  )

  const result = (tracks ?? []).map((t) => {
    const boost = boostsByTrack.get(t.id) ?? { plays: 0, likes: 0, downloads: 0, count: 0 }
    const organicPlays = t.plays ?? 0
    const organicLikes = t.likes ?? 0
    const organicDownloads = t.downloads ?? 0
    return {
      id: t.id,
      title: t.title,
      user_id: t.user_id,
      owner_email: emailByUserId.get(t.user_id) ?? null,
      agent_id: t.agent_id ?? null,
      audio_url_exists: !!t.audio_url,
      analysis_exists: analysedSet.has(t.id),
      published_at: t.published_at ?? null,
      created_at: t.created_at,
      // Stat layers — organic is the analytics-safe truth, boost is the
      // admin-applied display offset, display is what end-users see.
      organic_plays: organicPlays,
      organic_likes: organicLikes,
      organic_downloads: organicDownloads,
      boost_plays: boost.plays,
      boost_likes: boost.likes,
      boost_downloads: boost.downloads,
      boost_entry_count: boost.count,
      display_plays: organicPlays + boost.plays,
      display_likes: organicLikes + boost.likes,
      display_downloads: organicDownloads + boost.downloads,
    }
  })

    return NextResponse.json({ tracks: result, limit, offset })
  } catch (e) {
    // Last-ditch safety net: any unhandled exception (network, JSON
    // serialization, type mismatch, etc.) still returns a 200 with an
    // empty list so the admin panel keeps loading. The real error is
    // logged for the operator.
    console.error("[admin/tracks] unexpected failure:", e)
    return NextResponse.json(
      {
        tracks: [],
        limit: 0,
        offset: 0,
        warning: e instanceof Error ? e.message : "Unexpected error",
      },
      { status: 200 },
    )
  }
}
