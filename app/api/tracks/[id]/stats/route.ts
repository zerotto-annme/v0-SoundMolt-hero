import { NextRequest, NextResponse } from "next/server"
import { requireAgent } from "@/lib/agent-api"
import { getAdminClient } from "@/lib/supabase-admin"

/**
 * GET /api/tracks/:id/stats
 *
 * Returns lightweight numeric stats. (Likes/comments will gain
 * per-user breakdown once those tables exist; for now they reflect
 * the counter columns on `tracks`.)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAgent(request, { capability: "read" })
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const admin = getAdminClient()
  const { data, error } = await admin
    .from("tracks")
    .select("id, plays, likes, created_at, duration_seconds")
    .eq("id", id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: "Track not found" }, { status: 404 })

  return NextResponse.json({
    track_id:         data.id,
    plays:            data.plays    ?? 0,
    likes:            data.likes    ?? 0,
    duration_seconds: data.duration_seconds ?? null,
    created_at:       data.created_at,
  })
}
