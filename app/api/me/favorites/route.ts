import { NextRequest, NextResponse } from "next/server"
import { getAdminClient, getUserFromAuthHeader } from "@/lib/supabase-admin"

/**
 * GET /api/me/favorites
 *
 * Returns the calling user's favorited tracks. Two modes:
 *
 *   • Default — `{ ids: string[] }` for cheap hydration of the
 *     FavoritesProvider's in-memory Set so the toggle button has the
 *     right state on first paint.
 *   • `?full=1` — `{ tracks: Track[] }` joined to `tracks` + `agents` /
 *     `profiles` so the /favorites page can render real cards. Mirrors
 *     the GET /api/me/likes shape so consumer pages can be near-identical.
 *
 * Auth: Supabase user JWT in `Authorization: Bearer <jwt>`.
 */
export async function GET(request: NextRequest) {
  const user = await getUserFromAuthHeader(request)
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const full = searchParams.get("full") === "1"
  const rawLimit = parseInt(searchParams.get("limit") ?? "100", 10)
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 100, 1), 500)

  const admin = getAdminClient()

  const { data, error } = await admin
    .from("track_favorites")
    .select("track_id, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) {
    console.error("[me/favorites GET] select failed:", {
      code: error.code, message: error.message,
      details: error.details, hint: error.hint, user: user.id,
    })
    return NextResponse.json(
      { error: error.message, code: error.code, details: error.details },
      { status: 500 }
    )
  }

  const orderedIds = (data ?? []).map((r) => r.track_id as string)

  if (!full) {
    return NextResponse.json({ ids: orderedIds })
  }

  if (orderedIds.length === 0) {
    return NextResponse.json({ tracks: [] })
  }

  // Pull track payloads. Same SELECT as /api/me/likes — note: the
  // `tracks` table has no `downloads` column.
  const { data: trackRows, error: tracksErr } = await admin
    .from("tracks")
    .select(
      "id, title, cover_url, audio_url, original_audio_url, plays, likes, style, source_type, description, download_enabled, created_at, user_id, agent_id"
    )
    .in("id", orderedIds)

  if (tracksErr) {
    console.error("[me/favorites GET] tracks select failed:", {
      code: tracksErr.code, message: tracksErr.message,
      details: tracksErr.details, hint: tracksErr.hint, user: user.id,
    })
    return NextResponse.json(
      { error: tracksErr.message, code: tracksErr.code, details: tracksErr.details },
      { status: 500 }
    )
  }

  const trackById = new Map<string, (typeof trackRows)[number]>()
  for (const t of trackRows ?? []) trackById.set(t.id as string, t)

  const agentIds = Array.from(
    new Set(
      (trackRows ?? [])
        .map((t) => t.agent_id as string | null)
        .filter((id): id is string => !!id)
    )
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

  const userIds = Array.from(
    new Set(
      (trackRows ?? [])
        .map((t) => t.user_id as string | null)
        .filter((id): id is string => !!id)
    )
  )

  // Display-name map from profiles.username (per spec). For profiles
  // missing a username we look up auth.users for an email-prefix
  // fallback so we never surface "Uploaded Artist" when a real
  // identity exists.
  const usernameById: Record<string, string> = {}
  const profileAvatarById: Record<string, string | null> = {}
  if (userIds.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, username, avatar_url")
      .in("id", userIds)
    for (const p of profiles ?? []) {
      const nm = (p as { username?: string | null }).username || null
      if (nm) usernameById[p.id as string] = nm
      profileAvatarById[p.id as string] = (p as { avatar_url?: string | null }).avatar_url ?? null
    }
  }
  const emailPrefixById: Record<string, string> = {}
  for (const uid of userIds.filter((u) => !usernameById[u])) {
    try {
      const { data: authRes } = await admin.auth.admin.getUserById(uid)
      const email = authRes?.user?.email ?? null
      if (email && email.includes("@")) emailPrefixById[uid] = email.split("@")[0]
    } catch {
      // ignore — falls back to "Uploaded Artist"
    }
  }

  // Boost-fold (graceful if view absent — see /api/me/likes).
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

  const tracks = orderedIds
    .map((id) => trackById.get(id))
    .filter((t): t is NonNullable<typeof t> => !!t)
    .map((row) => {
      const boost = boostByTrack[row.id as string] ?? { plays: 0, likes: 0, downloads: 0 }
      const agentInfo = row.agent_id ? agentById[row.agent_id as string] : undefined
      const fallbackName =
        (row.user_id &&
          (usernameById[row.user_id as string] || emailPrefixById[row.user_id as string])) ||
        "Uploaded Artist"
      const artistName = agentInfo?.name || fallbackName
      const artistAvatar =
        agentInfo?.avatarUrl ?? (row.user_id ? profileAvatarById[row.user_id as string] ?? null : null)
      return {
        id: row.id as string,
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
        downloads: ((row as { downloads?: number }).downloads ?? 0) + boost.downloads,
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

  return NextResponse.json({ tracks })
}
