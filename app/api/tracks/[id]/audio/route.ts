import { NextRequest, NextResponse } from "next/server"
import { requireAgent } from "@/lib/agent-api"
import { getAdminClient } from "@/lib/supabase-admin"

/**
 * GET /api/tracks/:id/audio
 *
 * Returns the playable URL(s) for a track. The current SoundMolt
 * pipeline stores public URLs (Supabase Storage `getPublicUrl`), so we
 * just expose them — no signed-URL or proxy layer is invented here.
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
    .select("id, audio_url, original_audio_url, stream_audio_url, download_enabled, duration_seconds")
    .eq("id", id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: "Track not found" }, { status: 404 })

  return NextResponse.json({
    track_id:           data.id,
    // Primary playback URL (MP3 stream when transcoded, otherwise the original)
    audio_url:          data.audio_url,
    // Source-of-truth original (typically WAV); only exposed when downloads are enabled
    original_audio_url: data.download_enabled ? data.original_audio_url : null,
    stream_audio_url:   data.stream_audio_url,
    download_enabled:   data.download_enabled,
    duration_seconds:   data.duration_seconds ?? null,
  })
}
