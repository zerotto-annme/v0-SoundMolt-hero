import { NextRequest, NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase-admin"

/**
 * GET /api/explore/tracks?limit=200
 *
 * PUBLIC read-only endpoint feeding the /explore page's "All Tracks"
 * grid. Mirrors the shape returned by /api/me/likes?full=1 (and what
 * BrowseFeed builds inline) so the existing BrowseTrackCard component
 * can render it directly.
 *
 * Why a separate public endpoint instead of /api/tracks?
 *   `/api/tracks` requires Bearer agent authentication (agents-only
 *   integration surface). The Explore page is a public browser surface
 *   served unauthenticated, so it gets its own thin read endpoint that
 *   uses the admin client server-side and exposes nothing past the
 *   shaped Track payload.
 *
 * Returns:
 *   { tracks: Track[] }
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const rawLimit = parseInt(searchParams.get("limit") ?? "200", 10)
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 200, 1), 500)

  const admin = getAdminClient()

  // Only published tracks. We use `published_at IS NOT NULL` as the
  // visibility gate (same gate the agent publish flow sets). Drafts
  // and unpublished uploads do not appear on Explore.
  const { data: trackRows, error: tracksErr } = await admin
    .from("tracks")
    .select(
      "id, title, cover_url, audio_url, original_audio_url, plays, likes, style, source_type, description, download_enabled, created_at, user_id, agent_id, published_at",
    )
    .not("published_at", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (tracksErr) {
    console.error("[explore/tracks] tracks select failed:", {
      code: tracksErr.code, message: tracksErr.message,
      details: tracksErr.details, hint: tracksErr.hint,
    })
    return NextResponse.json(
      { error: tracksErr.message, code: tracksErr.code, details: tracksErr.details },
      { status: 500 },
    )
  }

  return NextResponse.json({ tracks: await shapeTracks(admin, trackRows ?? []) })
}

/**
 * Shape raw tracks rows into the front-end Track payload, joining
 * agent/profile identity and folding admin boost totals into the
 * displayed counters. Exported so /api/charts/top can reuse it.
 */
export async function shapeTracks(
  admin: ReturnType<typeof getAdminClient>,
  trackRows: Array<Record<string, unknown>>,
) {
  if (trackRows.length === 0) return []

  // Resolve agent identity for tracks that have agent_id.
  const agentIds = Array.from(
    new Set(
      trackRows
        .map((t) => t.agent_id as string | null)
        .filter((id): id is string => !!id),
    ),
  )
  const agentById: Record<string, { name: string; avatarUrl: string | null }> = {}
  if (agentIds.length > 0) {
    const { data: agents } = await admin
      .from("agents")
      .select("id, name, avatar_url")
      .in("id", agentIds)
    for (const a of agents ?? []) {
      agentById[a.id as string] = {
        name: (a as { name?: string }).name ?? "Agent",
        avatarUrl: (a as { avatar_url?: string | null }).avatar_url ?? null,
      }
    }
  }

  // Fall back to uploader profile when there's no agent.
  const userIds = Array.from(
    new Set(
      trackRows
        .map((t) => t.user_id as string | null)
        .filter((id): id is string => !!id),
    ),
  )
  const usernameById: Record<string, string> = {}
  const profileAvatarById: Record<string, string | null> = {}
  if (userIds.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, username, avatar_url")
      .in("id", userIds)
    for (const p of profiles ?? []) {
      usernameById[p.id as string] = (p as { username?: string }).username ?? "Uploaded Artist"
      profileAvatarById[p.id as string] =
        (p as { avatar_url?: string | null }).avatar_url ?? null
    }
  }

  // Fold in admin boosts so displayed counts match the rest of the
  // app. Degrades gracefully if track_boost_totals view is missing.
  const orderedIds = trackRows.map((t) => t.id as string)
  const boostByTrack: Record<
    string,
    { plays: number; likes: number; downloads: number }
  > = {}
  try {
    const { data: boostRows, error: boostErr } = await admin
      .from("track_boost_totals")
      .select("track_id, total_boost_plays, total_boost_likes, total_boost_downloads")
      .in("track_id", orderedIds)
    if (!boostErr) {
      for (const b of boostRows ?? []) {
        boostByTrack[b.track_id as string] = {
          plays: Number((b as { total_boost_plays?: number }).total_boost_plays ?? 0),
          likes: Number((b as { total_boost_likes?: number }).total_boost_likes ?? 0),
          downloads: Number((b as { total_boost_downloads?: number }).total_boost_downloads ?? 0),
        }
      }
    }
  } catch {
    // ignore — boost is purely additive
  }

  return trackRows.map((row) => {
    const id = row.id as string
    const boost = boostByTrack[id] ?? { plays: 0, likes: 0, downloads: 0 }
    const agentInfo = row.agent_id ? agentById[row.agent_id as string] : undefined
    const fallbackName =
      (row.user_id && usernameById[row.user_id as string]) || "Uploaded Artist"
    const artistName = agentInfo?.name || fallbackName
    const artistAvatar =
      agentInfo?.avatarUrl ??
      (row.user_id ? profileAvatarById[row.user_id as string] ?? null : null)
    return {
      id,
      title: (row as { title?: string }).title ?? "Untitled",
      agentName: artistName,
      modelType: agentInfo ? "Agent" : "Uploaded",
      modelProvider: agentInfo ? "agent" : "user",
      coverUrl: (row as { cover_url?: string }).cover_url || "",
      audioUrl:
        (row as { audio_url?: string }).audio_url ||
        (row as { original_audio_url?: string }).original_audio_url ||
        "",
      originalAudioUrl:
        (row as { original_audio_url?: string }).original_audio_url ||
        (row as { audio_url?: string }).audio_url ||
        "",
      plays: ((row as { plays?: number }).plays ?? 0) + boost.plays,
      likes: ((row as { likes?: number }).likes ?? 0) + boost.likes,
      downloads: boost.downloads, // tracks table has no downloads column
      style: (row as { style?: string }).style || "",
      sourceType:
        ((row as { source_type?: "uploaded" | "generated" }).source_type as
          | "uploaded"
          | "generated") || "uploaded",
      description: (row as { description?: string | null }).description || undefined,
      downloadEnabled: (row as { download_enabled?: boolean }).download_enabled,
      createdAt: new Date((row as { created_at: string }).created_at).getTime(),
      userId: (row.user_id as string | null) ?? null,
      agentId: (row.agent_id as string | null) ?? null,
      artistAvatarUrl: artistAvatar,
    }
  })
}
