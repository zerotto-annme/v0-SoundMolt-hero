import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// A real music MP3 at any bitrate will be at least this large.
// Broken lamejs output is typically 600 B – 2 KB.
const MIN_MP3_BYTES = 10 * 1024 // 10 KB

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ trackId: string }> }
) {
  const { trackId } = await params

  if (!trackId) {
    return NextResponse.json({ error: "Track ID required" }, { status: 400 })
  }

  try {
    // select("*") so the query works even if migration 006 hasn't been applied
    const { data: track, error: dbError } = await supabase
      .from("tracks")
      .select("*")
      .eq("id", trackId)
      .single()

    if (dbError) {
      console.error(`[download] DB error for track ${trackId}:`, dbError.message)
      return NextResponse.json({ error: "Track not found" }, { status: 404 })
    }
    if (!track) {
      return NextResponse.json({ error: "Track not found" }, { status: 404 })
    }

    if (track.download_enabled === false) {
      return NextResponse.json({ error: "Downloads disabled for this track" }, { status: 403 })
    }

    // ── Debug: log all available URL fields ─────────────────────────────────
    console.log(`[download] Track ${trackId} — URL fields:`)
    console.log(`  original_audio_url : ${track.original_audio_url ?? "(null)"}`)
    console.log(`  audio_url          : ${track.audio_url ?? "(null)"}`)
    console.log(`  stream_audio_url   : ${track.stream_audio_url ?? "(null)"}`)

    // ── Source priority: original_audio_url → audio_url (NEVER stream_audio_url) ──
    // stream_audio_url may contain a broken transcoded file from the lamejs era.
    // original_audio_url and audio_url always point to the real uploaded source.
    const fileUrl: string | null =
      track.original_audio_url ||  // Best: explicitly stored original
      track.audio_url ||            // Legacy: the upload URL stored in the base column
      null

    if (!fileUrl) {
      console.error(`[download] No usable audio URL for track ${trackId}`)
      return NextResponse.json({ error: "No audio file found for this track" }, { status: 404 })
    }

    console.log(`[download] Chosen URL: ${fileUrl}`)

    // Fetch the file from Supabase Storage
    const fileResponse = await fetch(fileUrl, { cache: "no-store" })

    console.log(`[download] Storage HTTP status: ${fileResponse.status}`)
    const storageContentType = fileResponse.headers.get("content-type") || ""
    console.log(`[download] Storage content-type: ${storageContentType}`)

    if (!fileResponse.ok) {
      return NextResponse.json(
        { error: `Storage fetch failed: ${fileResponse.status}` },
        { status: 502 }
      )
    }

    const fileBuffer = await fileResponse.arrayBuffer()
    console.log(`[download] Blob size: ${fileBuffer.byteLength} bytes`)

    // Reject obviously empty files
    if (fileBuffer.byteLength < 512) {
      console.error(`[download] File is empty or near-empty (${fileBuffer.byteLength} bytes)`)
      return NextResponse.json(
        { error: "Audio file appears empty or corrupt" },
        { status: 502 }
      )
    }

    // Reject tiny MP3s — these are the broken lamejs artifacts (1–2 KB)
    const isMp3 =
      storageContentType.includes("mpeg") ||
      storageContentType.includes("mp3") ||
      fileUrl.toLowerCase().split("?")[0].endsWith(".mp3")

    if (isMp3 && fileBuffer.byteLength < MIN_MP3_BYTES) {
      console.error(
        `[download] MP3 too small (${fileBuffer.byteLength} bytes < ${MIN_MP3_BYTES}) ` +
        `— likely a broken transcoded artifact. Rejecting.`
      )
      return NextResponse.json(
        {
          error:
            "This track's audio file appears corrupt (broken MP3 conversion). " +
            "Please re-upload the original file.",
          bytes: fileBuffer.byteLength,
        },
        { status: 502 }
      )
    }

    // Determine content-type for the response
    const contentType =
      track.original_mime_type ||
      (storageContentType.startsWith("audio/") ? storageContentType : null) ||
      guessContentType(fileUrl)

    // Determine download filename
    let ext: string
    if (track.original_filename) {
      ext = track.original_filename.split(".").pop()?.toLowerCase() || "wav"
    } else {
      ext = extensionFromMime(contentType) || extensionFromUrl(fileUrl)
    }

    const safeTitle = (track.title || "track")
      .replace(/[^a-zA-Z0-9_\-. ]/g, "_")
      .replace(/\s+/g, "_")
      .trim()
    const filename = `${safeTitle}_SoundMolt.${ext}`

    console.log(`[download] Serving: "${filename}" | ${contentType} | ${fileBuffer.byteLength} bytes`)

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": fileBuffer.byteLength.toString(),
        "Cache-Control": "private, no-cache",
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
  return ["wav", "mp3", "flac", "aac", "ogg", "m4a"].includes(ext || "") ? ext! : "wav"
}

function extensionFromMime(mime: string): string {
  const base = mime.split(";")[0].trim()
  const map: Record<string, string> = {
    "audio/wav": "wav", "audio/x-wav": "wav",
    "audio/mpeg": "mp3", "audio/mp3": "mp3",
    "audio/flac": "flac", "audio/x-flac": "flac",
    "audio/aac": "aac",
    "audio/ogg": "ogg",
    "audio/mp4": "m4a", "audio/x-m4a": "m4a",
  }
  return map[base] || "wav"
}
