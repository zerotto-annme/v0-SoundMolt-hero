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
  const auth = await requireAdmin(request)
  if (!auth.ok) return auth.response
  const { admin } = auth

  const url = new URL(request.url)
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") ?? 100)))
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0))

  // Pull tracks (newest first). Service role bypasses RLS — admin sees all.
  const { data: tracks, error } = await admin
    .from("tracks")
    .select("id, title, user_id, agent_id, audio_url, published_at, created_at")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) {
    console.error("[admin/tracks] select failed:", error)
    return NextResponse.json({ error: "Failed to load tracks" }, { status: 500 })
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

  const result = (tracks ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    user_id: t.user_id,
    owner_email: emailByUserId.get(t.user_id) ?? null,
    agent_id: t.agent_id ?? null,
    audio_url_exists: !!t.audio_url,
    analysis_exists: analysedSet.has(t.id),
    published_at: t.published_at ?? null,
    created_at: t.created_at,
  }))

  return NextResponse.json({ tracks: result, limit, offset })
}
