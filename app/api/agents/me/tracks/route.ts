import { NextRequest, NextResponse } from "next/server"
import { requireAgent } from "@/lib/agent-api"
import { getAdminClient } from "@/lib/supabase-admin"

const TRACK_FIELDS =
  "id, title, style, description, audio_url, original_audio_url, stream_audio_url, cover_url, download_enabled, source_type, plays, likes, duration_seconds, created_at, user_id, agent_id"

/** GET /api/agents/me/tracks?limit=50&offset=0 */
export async function GET(request: NextRequest) {
  const auth = await requireAgent(request, { capability: "read", requireActive: false })
  if (auth instanceof NextResponse) return auth

  const { searchParams } = new URL(request.url)
  const limit  = Math.min(Math.max(Number(searchParams.get("limit") ?? 50), 1), 100)
  const offset = Math.max(Number(searchParams.get("offset") ?? 0), 0)

  const admin = getAdminClient()
  const { data, error, count } = await admin
    .from("tracks")
    .select(TRACK_FIELDS, { count: "exact" })
    .eq("agent_id", auth.agent.id)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    tracks: data ?? [],
    pagination: { limit, offset, total: count ?? null },
  })
}
