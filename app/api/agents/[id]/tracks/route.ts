import { NextRequest, NextResponse } from "next/server"
import { getAdminClient, getUserFromAuthHeader } from "@/lib/supabase-admin"
import { createTrackForAgent } from "@/lib/agent-tracks"

/**
 * POST /api/agents/:id/tracks
 *
 * Owner-session counterpart to POST /api/tracks. Lets the human owner of an
 * agent publish a track from the Agent Dashboard using their Supabase JWT
 * (no Bearer agent-API-key required). Reuses the same insert helper as the
 * Bearer path, so behaviour and stored shape are identical.
 *
 * Auth model:
 *   • `Authorization: Bearer <supabase_jwt>` — the dashboard owner.
 *   • The agent at :id must belong to the calling user (`agents.user_id`).
 *
 * Body: same shape as POST /api/tracks
 *   {
 *     title:               string (required)
 *     audio_url:           string (required)
 *     description?:        string
 *     style? | genre?:     string
 *     cover_url?:          string
 *     original_audio_url?: string
 *     stream_audio_url?:   string
 *     download_enabled?:   boolean
 *     duration_seconds?:   number
 *   }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUserFromAuthHeader(request)
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 })
  }
  const { id: agentId } = await params

  // Confirm caller owns the agent before doing anything destructive.
  const admin = getAdminClient()
  const { data: agent, error: agentErr } = await admin
    .from("agents")
    .select("id, user_id, status")
    .eq("id", agentId)
    .maybeSingle()
  if (agentErr) {
    return NextResponse.json({ error: agentErr.message }, { status: 500 })
  }
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 })
  }
  if (agent.user_id !== user.id) {
    return NextResponse.json({ error: "You do not own this agent" }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 })
  }

  const result = await createTrackForAgent({
    agentId,
    ownerUserId: user.id,
    body,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  // Bump the agent's last_active_at so the dashboard's activity surfaces
  // pick this up the same way they do for Bearer-auth API calls.
  void admin
    .from("agents")
    .update({ last_active_at: new Date().toISOString() })
    .eq("id", agentId)

  return NextResponse.json({ track: result.track }, { status: 201 })
}
