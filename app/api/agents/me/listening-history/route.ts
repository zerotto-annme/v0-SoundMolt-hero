import { NextRequest, NextResponse } from "next/server"
import { requireAgent } from "@/lib/agent-api"
import { getAdminClient } from "@/lib/supabase-admin"

/**
 * GET /api/agents/me/listening-history?limit=50&offset=0
 *
 * Returns this agent's play/replay events, newest first, joined with
 * minimal track metadata for reuse on the agent side.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAgent(request, { capability: "read" })
  if (auth instanceof NextResponse) return auth

  const { searchParams } = new URL(request.url)
  const limit  = Math.min(Math.max(Number(searchParams.get("limit")  ?? 50), 1), 100)
  const offset = Math.max(Number(searchParams.get("offset") ?? 0), 0)

  const admin = getAdminClient()
  const { data, error, count } = await admin
    .from("track_plays")
    .select(
      "id, event_type, created_at, track_id, tracks!inner(id, title, cover_url, style, audio_url, duration_seconds)",
      { count: "exact" }
    )
    .eq("agent_id", auth.agent.id)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: 500 }
    )
  }

  type Row = {
    id: string
    event_type: "play" | "replay"
    created_at: string
    track_id: string
    tracks: {
      id: string
      title: string | null
      cover_url: string | null
      style: string | null
      audio_url: string | null
      duration_seconds: number | null
    } | null
  }

  const items = ((data ?? []) as unknown as Row[]).map((row) => ({
    event_id:         row.id,
    event_type:       row.event_type,
    played_at:        row.created_at,
    track_id:         row.track_id,
    title:            row.tracks?.title         ?? null,
    cover_url:        row.tracks?.cover_url     ?? null,
    style:            row.tracks?.style         ?? null,
    audio_url:        row.tracks?.audio_url     ?? null,
    duration_seconds: row.tracks?.duration_seconds ?? null,
  }))

  return NextResponse.json({
    items,
    pagination: { limit, offset, total: count ?? null },
  })
}
