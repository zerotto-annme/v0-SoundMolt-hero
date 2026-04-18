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
    // Use select("*") so query never fails if audio pipeline columns
    // (original_audio_url, original_filename, etc.) haven't been migrated yet
    const { data: track, error: dbError } = await supabase
      .from("tracks")
      .select("*")
      .eq("id", trackId)
      .single()

    if (dbError) {
      console.error(`[download] DB error for track ${trackId}:`, dbError.message)
      return NextResponse.json(
        { error: "Track not found", detail: dbError.message },
        { status: 404 }
      )
    }
    if (!track) {
      console.error(`[download] Track ${trackId} not in DB`)
      return NextResponse.json({ error: "Track not found" }, { status: 404 })
    }

    // Respect download permission set by track owner
    if (track.download_enabled === false) {
      return NextResponse.json({ error: "Downloads disabled for this track" }, { status: 403 })
    }

    // Source priority: original_audio_url > audio_url
    const fileUrl: string | null = track.original_audio_url || track.audio_url || null
    if (!fileUrl) {
      console.error(`[download] No audio URL found for track ${trackId}`)
      return NextResponse.json({ error: "No audio file found for this track" }, { status: 404 })
    }

    console.log(`[download] Fetching track ${trackId} from: ${fileUrl}`)

    // Fetch the actual file from Supabase Storage
    const fileResponse = await fetch(fileUrl, { cache: "no-store" })

    console.log(`[download] Storage response: ${fileResponse.status} ${fileResponse.statusText}`)
    console.log(`[download] Storage content-type: ${fileResponse.headers.get("content-type")}`)

    if (!fileResponse.ok) {
      console.error(`[download] Storage fetch failed: ${fileResponse.status}`)
      return NextResponse.json(
        { error: `Storage fetch failed: ${fileResponse.status} ${fileResponse.statusText}` },
        { status: 502 }
      )
    }

    const fileBuffer = await fileResponse.arrayBuffer()
    console.log(`[download] Fetched ${fileBuffer.byteLength} bytes`)

    // Guard against empty or suspiciously tiny responses
    if (fileBuffer.byteLength < 512) {
      console.error(`[download] File too small (${fileBuffer.byteLength} bytes) — likely corrupt or empty`)
      return NextResponse.json(
        { error: "Audio file appears empty or corrupt", bytes: fileBuffer.byteLength },
        { status: 502 }
      )
    }

    // Determine content-type: prefer stored mime, then infer from storage headers, then from URL
    const rawContentType = fileResponse.headers.get("content-type") || ""
    const contentType: string =
      track.original_mime_type ||
      (rawContentType.startsWith("audio/") || rawContentType.startsWith("application/octet") ? rawContentType : null) ||
      guessContentType(fileUrl)

    // Determine file extension: prefer stored original filename, then mime, then URL
    let ext: string
    if (track.original_filename) {
      ext = track.original_filename.split(".").pop()?.toLowerCase() || "wav"
    } else {
      ext = extensionFromMime(contentType) || extensionFromUrl(fileUrl)
    }

    // Build download filename
    const safeTitle = (track.title || "track")
      .replace(/[^a-zA-Z0-9_\-. ]/g, "_")
      .replace(/\s+/g, "_")
      .trim()
    const filename = `${safeTitle}_SoundMolt.${ext}`

    console.log(`[download] Serving ${filename} (${contentType}, ${fileBuffer.byteLength} bytes)`)

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": fileBuffer.byteLength.toString(),
        "Cache-Control": "private, no-cache",
        // Expose headers to browser JS (needed to read Content-Disposition via fetch)
        "Access-Control-Expose-Headers": "Content-Disposition, Content-Type, Content-Length",
      },
    })
  } catch (error) {
    console.error("[download] Unexpected error:", error)
    return NextResponse.json({ error: "Download failed unexpectedly" }, { status: 500 })
  }
}

function guessContentType(url: string): string {
  const lower = url.toLowerCase().split("?")[0]
  if (lower.endsWith(".wav")) return "audio/wav"
  if (lower.endsWith(".mp3")) return "audio/mpeg"
  if (lower.endsWith(".flac")) return "audio/flac"
  if (lower.endsWith(".aac")) return "audio/aac"
  if (lower.endsWith(".ogg")) return "audio/ogg"
  if (lower.endsWith(".m4a")) return "audio/mp4"
  return "audio/wav"
}

function extensionFromUrl(url: string): string {
  const path = url.toLowerCase().split("?")[0]
  const ext = path.split(".").pop()
  const known = ["wav", "mp3", "flac", "aac", "ogg", "m4a"]
  return known.includes(ext || "") ? ext! : "wav"
}

function extensionFromMime(mime: string): string {
  const base = mime.split(";")[0].trim()
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
    "audio/x-m4a": "m4a",
  }
  return map[base] || "wav"
}
