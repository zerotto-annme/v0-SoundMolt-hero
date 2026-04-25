import { NextRequest, NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase-admin"

/**
 * GET /api/agents?sort=popular&limit=8
 *
 * PUBLIC read-only listing of active AI agents on the platform.
 *
 * SQL (per requested spec):
 *   select * from agents
 *   where status = 'active'
 *   order by <ranking>
 *   limit N;
 *
 * IMPORTANT — about ranking: the spec asked for `order by followers
 * desc`, but there is no `followers` column on `public.agents` in this
 * codebase (no follow-graph table exists at all — searched all 42
 * migrations). Fabricating a follower count would be exactly the kind
 * of fake data this task is meant to remove. So:
 *   • sort=popular → order by total_tracks desc, then created_at desc
 *     (real, computable signal — most-publishing active agents first).
 *   • sort=newest  → order by created_at desc.
 * `total_tracks` is computed inline by counting the agent's published
 * tracks. The response includes it on each agent so the UI can show
 * the real number without needing a follow-up call.
 *
 * Returns: { agents: Agent[] }
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const sort = searchParams.get("sort") === "newest" ? "newest" : "popular"
  const rawLimit = parseInt(searchParams.get("limit") ?? "8", 10)
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 8, 1), 100)

  const admin = getAdminClient()

  // NOTE on column list: migration 015 declares `provider`,
  // `api_endpoint`, and `model_name` on `public.agents`, but the live
  // Supabase schema does not have them (they were removed at some
  // point post-015 and the corresponding migration is missing from
  // this tree — verified via the live REST schema introspection).
  // Selecting a missing column 500's the entire endpoint, so we stick
  // to the columns that are guaranteed to exist on the live DB.
  const { data: agentRows, error } = await admin
    .from("agents")
    .select("id, name, avatar_url, cover_url, description, genre, status, created_at")
    .eq("status", "active")
    // Pull a wider window than `limit` so we can re-sort by computed
    // `total_tracks` after fetching the per-agent counts. Caps at 100.
    .order("created_at", { ascending: false })
    .limit(Math.max(limit * 4, 32))

  if (error) {
    console.error("[agents] select failed:", {
      code: error.code, message: error.message,
      details: error.details, hint: error.hint,
    })
    return NextResponse.json(
      { error: error.message, code: error.code, details: error.details },
      { status: 500 },
    )
  }

  const agents = agentRows ?? []
  if (agents.length === 0) return NextResponse.json({ agents: [] })

  // Per-agent published track counts (real signal). Single round-trip
  // using grouped count via PostgREST is awkward; one query per agent
  // would be N+1, so we do a single bulk select and count in JS.
  const agentIds = agents.map((a) => a.id as string)
  const trackCountById = new Map<string, number>()
  const playsSumById = new Map<string, number>()
  const likesSumById = new Map<string, number>()
  {
    const { data: trackRows, error: tErr } = await admin
      .from("tracks")
      .select("agent_id, plays, likes")
      .in("agent_id", agentIds)
      .not("published_at", "is", null)
    if (tErr) {
      console.warn("[agents] track-count rollup failed (continuing with zeros):", tErr.message)
    } else {
      for (const t of trackRows ?? []) {
        const aid = t.agent_id as string | null
        if (!aid) continue
        trackCountById.set(aid, (trackCountById.get(aid) ?? 0) + 1)
        playsSumById.set(aid, (playsSumById.get(aid) ?? 0) + Number((t as { plays?: number }).plays ?? 0))
        likesSumById.set(aid, (likesSumById.get(aid) ?? 0) + Number((t as { likes?: number }).likes ?? 0))
      }
    }
  }

  const enriched = agents.map((a) => {
    const id = a.id as string
    return {
      id,
      name: (a as { name?: string }).name ?? "Agent",
      avatarUrl: (a as { avatar_url?: string | null }).avatar_url ?? null,
      coverUrl: (a as { cover_url?: string | null }).cover_url ?? null,
      description: (a as { description?: string | null }).description ?? null,
      genre: (a as { genre?: string | null }).genre ?? null,
      provider: (a as { provider?: string | null }).provider ?? null,
      modelName: (a as { model_name?: string | null }).model_name ?? null,
      status: (a as { status?: string }).status ?? "active",
      createdAt: (a as { created_at?: string }).created_at ?? null,
      totalTracks: trackCountById.get(id) ?? 0,
      totalPlays: playsSumById.get(id) ?? 0,
      totalLikes: likesSumById.get(id) ?? 0,
    }
  })

  if (sort === "popular") {
    enriched.sort((x, y) => {
      if (y.totalTracks !== x.totalTracks) return y.totalTracks - x.totalTracks
      if (y.totalPlays !== x.totalPlays) return y.totalPlays - x.totalPlays
      const xt = x.createdAt ? Date.parse(x.createdAt) : 0
      const yt = y.createdAt ? Date.parse(y.createdAt) : 0
      return yt - xt
    })
  }

  return NextResponse.json({ agents: enriched.slice(0, limit) })
}
