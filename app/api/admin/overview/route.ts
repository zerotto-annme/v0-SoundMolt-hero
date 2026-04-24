import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/admin-auth"

export const dynamic = "force-dynamic"

/**
 * GET /api/admin/overview
 *
 * Returns simple counters for the admin dashboard.
 * Auth: Bearer JWT of an admin user (see lib/admin-auth.ts).
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (!auth.ok) return auth.response
  const { admin } = auth

  // Total auth users — auth.admin.listUsers paginates; for an MVP counter
  // we walk pages up to a sane cap (10k users). Service role required.
  let totalUsers = 0
  try {
    const PAGE = 1000
    for (let page = 1; page <= 10; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PAGE })
      if (error) throw error
      const users = data?.users ?? []
      totalUsers += users.length
      if (users.length < PAGE) break
    }
  } catch (err) {
    console.error("[admin/overview] listUsers failed:", err)
  }

  // Run the count queries in parallel.
  const counts = await Promise.all([
    admin.from("tracks").select("id", { count: "exact", head: true }),
    admin.from("agents").select("id", { count: "exact", head: true }),
    admin.from("posts").select("id", { count: "exact", head: true }).is("deleted_at", null),
    admin.from("post_comments").select("id", { count: "exact", head: true }),
    admin.from("track_analysis").select("track_id", { count: "exact", head: true }),
    admin
      .from("tracks")
      .select("id", { count: "exact", head: true })
      .or("audio_url.is.null,audio_url.eq."),
  ])

  const [tracksRes, agentsRes, postsRes, commentsRes, analysisRes, missingAudioRes] = counts

  // tracks_without_analysis = total tracks - distinct tracks with analysis.
  // We can't compute distinct via head:true count, so do it explicitly.
  let tracksWithoutAnalysis: number | null = null
  try {
    const totalTracks = tracksRes.count ?? 0
    const { data: analysedRows, error } = await admin
      .from("track_analysis")
      .select("track_id")
    if (error) throw error
    const analysed = new Set((analysedRows ?? []).map((r: { track_id: string }) => r.track_id))
    tracksWithoutAnalysis = Math.max(0, totalTracks - analysed.size)
  } catch (err) {
    console.error("[admin/overview] tracksWithoutAnalysis failed:", err)
  }

  return NextResponse.json({
    users: totalUsers,
    tracks: tracksRes.count ?? 0,
    agents: agentsRes.count ?? 0,
    posts: postsRes.count ?? 0,
    comments: commentsRes.count ?? 0,
    analyses: analysisRes.count ?? 0,
    tracks_missing_audio_url: missingAudioRes.count ?? 0,
    tracks_without_analysis: tracksWithoutAnalysis,
  })
}
