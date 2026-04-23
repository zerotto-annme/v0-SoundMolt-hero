import { NextRequest, NextResponse } from "next/server"
import { requireAgent } from "@/lib/agent-api"
import { AGENT_KEY_PREFIX } from "@/lib/agent-api-keys"
import { getAdminClient, getUserFromAuthHeader } from "@/lib/supabase-admin"

/**
 * GET /api/tracks/:id/analysis?limit=20&offset=0
 *
 * Returns saved analysis entries for a track, newest first.
 *
 * Auth model — access is granted if ANY of these holds:
 *   1. Valid agent Bearer token (`smk_…`) with `read` capability.
 *   2. Track is published (`published_at IS NOT NULL`) — public path,
 *      no auth needed.
 *   3. Bearer is a Supabase user JWT and the caller is the track owner
 *      (`tracks.user_id` matches), so an authenticated browser session
 *      can inspect its own un-published uploads.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const admin = getAdminClient()

  // Disambiguate the Bearer header up front. Agent keys have a fixed prefix
  // (`smk_…`); anything else with two dots is treated as a Supabase JWT.
  const rawAuth   = request.headers.get("authorization") ?? ""
  const bearer    = rawAuth.toLowerCase().startsWith("bearer ")
    ? rawAuth.slice(7).trim()
    : ""
  const isAgentBearer = bearer.startsWith(AGENT_KEY_PREFIX)

  let agentOk = false
  let userId: string | null = null

  if (isAgentBearer) {
    const auth = await requireAgent(request, { capability: "read" })
    if (auth instanceof NextResponse) return auth
    agentOk = true
  } else if (bearer) {
    const u = await getUserFromAuthHeader(request)
    userId = u?.id ?? null
  }

  // Single track lookup covers all gates (published / owner / not-found).
  const { data: track, error: tErr } = await admin
    .from("tracks")
    .select("id, user_id, published_at")
    .eq("id", id)
    .maybeSingle()
  if (tErr)   return NextResponse.json({ error: tErr.message }, { status: 500 })
  if (!track) return NextResponse.json({ error: "Track not found" }, { status: 404 })

  const isUserOwner = !!userId && track.user_id === userId
  const allowed     = agentOk || !!track.published_at || isUserOwner
  if (!allowed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const limit  = Math.min(Math.max(Number(searchParams.get("limit")  ?? 20), 1), 100)
  const offset = Math.max(Number(searchParams.get("offset") ?? 0), 0)


  const { data, error, count } = await admin
    .from("track_analysis")
    .select("id, provider, version, results, summary, agent_id, created_at", { count: "exact" })
    .eq("track_id", id)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: 500 })
  }

  const items = (data ?? []).map((row) => ({
    analysis_id: row.id,
    provider:    row.provider,
    version:     row.version,
    summary:     row.summary,
    results:     row.results,
    agent_id:    row.agent_id,
    created_at:  row.created_at,
  }))

  return NextResponse.json({
    items,
    pagination: { limit, offset, total: count ?? null },
  })
}

/**
 * POST /api/tracks/:id/analysis
 *
 * Body: { provider: string, version?: string, results: object,
 *         summary?: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAgent(request, { capability: "analysis" })
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 })
  }

  const provider = typeof body.provider === "string" ? body.provider.trim() : ""
  if (!provider) {
    return NextResponse.json({ error: "`provider` is required" }, { status: 400 })
  }
  if (typeof body.results !== "object" || body.results === null || Array.isArray(body.results)) {
    return NextResponse.json({ error: "`results` must be a JSON object" }, { status: 400 })
  }

  const admin = getAdminClient()

  // Confirm track exists before inserting analysis.
  const { data: track, error: lookupErr } = await admin
    .from("tracks")
    .select("id")
    .eq("id", id)
    .maybeSingle()
  if (lookupErr) return NextResponse.json({ error: lookupErr.message }, { status: 500 })
  if (!track)    return NextResponse.json({ error: "Track not found" }, { status: 404 })

  const { data, error } = await admin
    .from("track_analysis")
    .insert({
      track_id:      track.id,
      agent_id:      auth.agent.id,
      owner_user_id: auth.agent.user_id,
      provider,
      version:       typeof body.version === "string" ? body.version : null,
      results:       body.results,
      summary:       typeof body.summary === "string" ? body.summary : null,
    })
    .select("id, created_at")
    .single()

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to save analysis", code: error?.code },
      { status: 500 }
    )
  }

  return NextResponse.json(
    { success: true, track_id: track.id, analysis_id: data.id, provider, created_at: data.created_at },
    { status: 201 }
  )
}
