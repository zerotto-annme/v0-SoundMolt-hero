import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ trackId: string }> }
) {
  const { trackId } = await params

  if (!trackId) {
    return NextResponse.json({ error: "Track ID required" }, { status: 400 })
  }

  try {
    // Fetch track metadata from database
    const { data: track, error: dbError } = await supabase
      .from("tracks")
      .select("id, title, audio_url, original_audio_url, original_filename, original_mime_type, download_enabled")
      .eq("id", trackId)
      .single()

    if (dbError || !track) {
      return NextResponse.json({ error: "Track not found" }, { status: 404 })
    }

    // Respect download permission set by track owner
    if (track.download_enabled === false) {
      return NextResponse.json({ error: "Downloads disabled for this track" }, { status: 403 })
    }

    // Use original file if available, fall back to audio_url (stream/legacy)
    const fileUrl = track.original_audio_url || track.audio_url
    if (!fileUrl) {
      return NextResponse.json({ error: "Audio file not found" }, { status: 404 })
    }

    // Fetch the actual file from Supabase Storage
    const fileResponse = await fetch(fileUrl)
    if (!fileResponse.ok) {
      return NextResponse.json({ error: "Failed to fetch audio file" }, { status: 502 })
    }

    const fileBuffer = await fileResponse.arrayBuffer()

    // Validate file is non-empty
    if (fileBuffer.byteLength < 100) {
      return NextResponse.json({ error: "Audio file appears to be empty or corrupt" }, { status: 502 })
    }

    // Determine content type
    const contentType =
      track.original_mime_type ||
      fileResponse.headers.get("content-type") ||
      guessContentType(fileUrl)

    // Build a clean filename for the download
    const safeTitle = (track.title || "track").replace(/[^a-zA-Z0-9_\-. ]/g, "_").trim()
    const ext = track.original_filename
      ? track.original_filename.split(".").pop()
      : extensionFromMime(contentType)
    const filename = `${safeTitle}_SoundMolt.${ext}`

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": fileBuffer.byteLength.toString(),
        "Cache-Control": "private, no-cache",
      },
    })
  } catch (error) {
    console.error("Download error:", error)
    return NextResponse.json({ error: "Download failed" }, { status: 500 })
  }
}

function guessContentType(url: string): string {
  const lower = url.toLowerCase()
  if (lower.includes(".wav")) return "audio/wav"
  if (lower.includes(".mp3")) return "audio/mpeg"
  if (lower.includes(".flac")) return "audio/flac"
  if (lower.includes(".aac")) return "audio/aac"
  if (lower.includes(".ogg")) return "audio/ogg"
  if (lower.includes(".m4a")) return "audio/mp4"
  return "audio/mpeg"
}

function extensionFromMime(mime: string): string {
  const map: Record<string, string> = {
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/flac": "flac",
    "audio/x-flac": "flac",
    "audio/aac": "aac",
    "audio/ogg": "ogg",
    "audio/mp4": "m4a",
  }
  return map[mime] || "wav"
}
