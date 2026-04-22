/**
 * Shared track-recommendation route handler.
 *
 * Powers two public endpoints that return the SAME ranked list:
 *   • GET /api/recommendations/tracks
 *   • GET /api/agents/me/recommendations/tracks
 *
 * The heavy lifting (deep taste scoring across genre / BPM / key / mood /
 * tags / energy / brightness, multi-facet bonus, replay penalty) lives
 * in `recommendTracks` in lib/agent-recommend.ts. This handler is a thin
 * adapter: it calls that engine, then enriches each item with a compact
 * analysis snapshot pulled from `track_analysis`, applies query-param
 * filters, and shapes the response per the v2 spec.
 *
 * Query params:
 *   limit             default 10, max 50
 *   include_reasons   default true; pass "false" to omit reason arrays
 *   exclude_played    default false; if "true" hard-filters tracks the
 *                     agent's owner has ever played (track_plays)
 */
import { NextRequest, NextResponse } from "next/server"
import { requireAgent } from "./agent-api"
import { getAdminClient } from "./supabase-admin"
import { recommendTracks } from "./agent-recommend"

const DEFAULT_LIMIT = 10
const MAX_LIMIT     = 50
// We over-fetch from the engine when exclude_played is on, so we still
// return ~`limit` items after post-filter. 3× is plenty in practice.
const OVERFETCH_FACTOR = 3

export interface AnalysisSnapshot {
  bpm:         number | null
  key:         string | null
  mood:        string[] | null
  tempo_label: string | null
  tags:        string[] | null
}

function pickSnapshot(results: unknown): AnalysisSnapshot {
  const r = (results && typeof results === "object" ? results : {}) as Record<string, unknown>
  const moodRaw = r.mood
  const mood: string[] | null =
    Array.isArray(moodRaw) ? moodRaw.filter((m): m is string => typeof m === "string")
    : typeof moodRaw === "string" ? [moodRaw]
    : null
  const tagsRaw = r.tags
  const tags: string[] | null = Array.isArray(tagsRaw)
    ? tagsRaw.filter((t): t is string => typeof t === "string")
    : null
  return {
    bpm:         typeof r.bpm === "number" ? r.bpm : null,
    key:         typeof r.key === "string" ? r.key : null,
    mood:        mood && mood.length ? mood : null,
    tempo_label: typeof r.tempo_label === "string" ? r.tempo_label : null,
    tags,
  }
}

/**
 * Build the response. Exposed as a single function so both route files
 * collapse to two lines each.
 */
export async function handleTrackRecommendations(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAgent(request, { capability: "read" })
  if (auth instanceof NextResponse) return auth

  const { searchParams } = new URL(request.url)
  const rawLimit       = Number(searchParams.get("limit") ?? DEFAULT_LIMIT)
  const limit          = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : DEFAULT_LIMIT, 1), MAX_LIMIT)
  const includeReasons = (searchParams.get("include_reasons") ?? "true").toLowerCase() !== "false"
  const excludePlayed  = (searchParams.get("exclude_played")  ?? "false").toLowerCase() === "true"

  // Engine call — over-fetch when we'll be hard-filtering.
  const fetchLimit = excludePlayed ? Math.min(MAX_LIMIT * OVERFETCH_FACTOR, limit * OVERFETCH_FACTOR) : limit
  const rec = await recommendTracks(auth.agent.id, fetchLimit)
  const admin = getAdminClient()

  // Optional hard exclusion: drop any track this agent's owner has played.
  let items = rec.items
  if (excludePlayed && items.length) {
    const { data: plays } = await admin
      .from("track_plays")
      .select("track_id")
      .eq("owner_user_id", auth.agent.user_id)
    const playedIds = new Set((plays ?? []).map((p) => p.track_id as string))
    items = items.filter((it) => !playedIds.has(it.track_id))
  }
  items = items.slice(0, limit)

  // Enrich with compact analysis snapshot — newest analysis row per track.
  const analysisByTrack = new Map<string, AnalysisSnapshot>()
  if (items.length) {
    const ids = items.map((i) => i.track_id)
    const { data: rows } = await admin
      .from("track_analysis")
      .select("track_id, results, created_at")
      .in("track_id", ids)
      .order("created_at", { ascending: false })
    // First seen wins because we ordered DESC — that's the newest.
    for (const row of rows ?? []) {
      const tid = row.track_id as string
      if (!analysisByTrack.has(tid)) analysisByTrack.set(tid, pickSnapshot(row.results))
    }
  }

  const responseItems = items.map((it) => {
    const snap = analysisByTrack.get(it.track_id) ?? null
    const out: Record<string, unknown> = {
      track_id: it.track_id,
      title:    it.title,
      score:    it.score,
      genre:    it.genre,
      cover_url: it.cover_url,
      analysis: snap,
      factors:  it.factors,
    }
    if (includeReasons) out.reason = it.reason
    return out
  })

  return NextResponse.json({
    items: responseItems,
    profile_summary: rec.profile.summary,
    fallback: rec.fallback,
    message:  rec.message,
    pagination: {
      limit,
      returned: responseItems.length,
      filters: { include_reasons: includeReasons, exclude_played: excludePlayed },
    },
  })
}
