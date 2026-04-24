import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/admin-auth"

export const dynamic = "force-dynamic"

/**
 * GET /api/admin/health
 *
 * Returns lists of tracks with detectable problems:
 *   - missing audio_url (NULL or empty string)
 *   - missing analysis (no track_analysis row)
 *   - failed/empty analysis (results JSON is empty {} or summary is null)
 *
 * Caps each list at 100 rows for MVP — full pagination is a v2 concern.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (!auth.ok) return auth.response
  const { admin } = auth

  const LIMIT = 100

  // 1. tracks missing audio_url (NULL or empty)
  let missingAudio: Array<{
    id: string
    title: string
    created_at: string
    published_at: string | null
  }> = []
  {
    const { data, error } = await admin
      .from("tracks")
      .select("id, title, created_at, audio_url, published_at")
      .or("audio_url.is.null,audio_url.eq.")
      .order("created_at", { ascending: false })
      .limit(LIMIT)
    if (error) {
      console.error("[admin/health] missingAudio query failed:", error)
    } else {
      missingAudio = (data ?? []).map((r) => ({
        id: r.id,
        title: r.title,
        created_at: r.created_at,
        published_at: r.published_at ?? null,
      }))
    }
  }

  // 2. tracks missing analysis — fetch all track ids + all analysis track_ids,
  //    diff client-side. Fine for MVP (<= a few thousand rows).
  let missingAnalysis: Array<{
    id: string
    title: string
    created_at: string
    published_at: string | null
  }> = []
  try {
    const [{ data: allTracks, error: tErr }, { data: analysisRows, error: aErr }] =
      await Promise.all([
        admin
          .from("tracks")
          .select("id, title, created_at, published_at")
          .order("created_at", { ascending: false }),
        admin.from("track_analysis").select("track_id"),
      ])
    if (tErr) throw tErr
    if (aErr) throw aErr
    const analysed = new Set((analysisRows ?? []).map((r: { track_id: string }) => r.track_id))
    missingAnalysis = (allTracks ?? [])
      .filter((t) => !analysed.has(t.id))
      .slice(0, LIMIT)
      .map((t) => ({
        id: t.id,
        title: t.title,
        created_at: t.created_at,
        published_at: t.published_at ?? null,
      }))
  } catch (err) {
    console.error("[admin/health] missingAnalysis query failed:", err)
  }

  // 3. failed / empty analysis — track_analysis rows whose results JSON is
  //    empty (`{}`) AND summary is null. We pull recent rows and filter,
  //    again capped for MVP. After filtering we batch-fetch the parent
  //    tracks' published_at so the UI can render conditional "Hide"
  //    actions without a second roundtrip.
  let failedAnalysis: Array<{
    id: string
    track_id: string
    provider: string
    created_at: string
    published_at: string | null
  }> = []
  try {
    const { data, error } = await admin
      .from("track_analysis")
      .select("id, track_id, provider, results, summary, created_at")
      .order("created_at", { ascending: false })
      .limit(500)
    if (error) throw error
    const filtered = (data ?? [])
      .filter((r) => {
        // Treat an analysis row as failed/empty when EITHER side is
        // missing — a populated summary with empty results means the
        // analysis pipeline never produced a measurement, and an
        // unsummarised result blob means the post-processing failed.
        const emptyResults =
          r.results == null ||
          (typeof r.results === "object" && Object.keys(r.results).length === 0)
        const noSummary = r.summary == null || String(r.summary).trim() === ""
        return emptyResults || noSummary
      })
      .slice(0, LIMIT)

    // Batch-resolve published_at for all referenced tracks.
    const trackIds = Array.from(new Set(filtered.map((r) => r.track_id as string)))
    const publishedByTrack = new Map<string, string | null>()
    if (trackIds.length > 0) {
      const { data: trackRows, error: trErr } = await admin
        .from("tracks")
        .select("id, published_at")
        .in("id", trackIds)
      if (trErr) {
        console.error("[admin/health] failedAnalysis published_at lookup failed:", trErr)
      } else {
        for (const t of trackRows ?? []) {
          publishedByTrack.set(t.id as string, (t.published_at as string | null) ?? null)
        }
      }
    }

    failedAnalysis = filtered.map((r) => ({
      id: r.id,
      track_id: r.track_id,
      provider: r.provider,
      created_at: r.created_at,
      published_at: publishedByTrack.get(r.track_id as string) ?? null,
    }))
  } catch (err) {
    console.error("[admin/health] failedAnalysis query failed:", err)
  }

  return NextResponse.json({
    missing_audio_url: missingAudio,
    missing_analysis: missingAnalysis,
    failed_analysis: failedAnalysis,
  })
}
