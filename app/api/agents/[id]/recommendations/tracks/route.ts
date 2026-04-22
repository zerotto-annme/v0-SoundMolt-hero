/**
 * GET /api/agents/[id]/recommendations/tracks
 *
 * Owner-session counterpart to /api/agents/me/recommendations/tracks.
 * The Agent Dashboard (and any other JWT-authenticated owner UI) calls
 * this to render its "Recommended for you" panel — the bearer-token
 * agent-API path requires an API key the dashboard never re-receives.
 *
 * Auth: Supabase JWT in `Authorization: Bearer <jwt>`. The caller MUST
 *       own the agent (agent.user_id === auth.uid).
 *
 * Same query params and same response shape as the bearer route — both
 * delegate to `buildTrackRecommendations` so behaviour stays identical.
 */
import { NextRequest, NextResponse } from "next/server"
import { getAdminClient, getUserFromAuthHeader } from "@/lib/supabase-admin"
import { buildTrackRecommendations } from "@/lib/recommend-route"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUserFromAuthHeader(request)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { id: agentId } = await params

  const admin = getAdminClient()
  const { data: agent, error } = await admin
    .from("agents")
    .select("id, user_id")
    .eq("id", agentId)
    .maybeSingle()
  if (error)  return NextResponse.json({ error: error.message }, { status: 500 })
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 })
  if (agent.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const payload = await buildTrackRecommendations(agent.id, agent.user_id, searchParams)
  return NextResponse.json(payload)
}
