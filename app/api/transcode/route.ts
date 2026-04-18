import { NextRequest, NextResponse } from "next/server"
import { spawn } from "child_process"
import { writeFile, readFile, unlink, mkdir } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"
import { randomUUID } from "crypto"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""

function runFfmpeg(inputPath: string, outputPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [
      "-i", inputPath,
      "-b:a", "192k",    // 192 kbps MP3
      "-ar", "44100",    // Normalize sample rate
      "-ac", "2",        // Stereo
      "-map_metadata", "-1", // Strip metadata to reduce size
      "-id3v2_version", "3",
      "-y",              // Overwrite output
      outputPath,
    ]

    let stderr = ""
    const proc = spawn("ffmpeg", args)

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stderr)
      } else {
        reject(new Error(`ffmpeg exited with code ${code}:\n${stderr.slice(-2000)}`))
      }
    })

    proc.on("error", (err) => {
      reject(new Error(`ffmpeg spawn failed: ${err.message}`))
    })
  })
}

export async function POST(request: NextRequest) {
  let inputPath: string | null = null
  let outputPath: string | null = null

  try {
    const body = await request.json()
    const { wavUrl, userId, timestamp } = body as {
      wavUrl: string
      userId: string
      timestamp: number
    }

    if (!wavUrl || !userId || !timestamp) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    // Security: only accept URLs from our own Supabase instance
    if (SUPABASE_URL && !wavUrl.startsWith(SUPABASE_URL)) {
      return NextResponse.json({ error: "URL not from allowed origin" }, { status: 403 })
    }

    console.log(`[transcode] Fetching WAV from: ${wavUrl}`)

    // Fetch the WAV from Supabase Storage (public bucket, no auth needed)
    const wavResponse = await fetch(wavUrl)
    if (!wavResponse.ok) {
      return NextResponse.json(
        { error: `Failed to fetch source audio: ${wavResponse.status} ${wavResponse.statusText}` },
        { status: 502 }
      )
    }

    const wavBuffer = Buffer.from(await wavResponse.arrayBuffer())
    console.log(`[transcode] WAV fetched: ${wavBuffer.length} bytes (${(wavBuffer.length / 1024 / 1024).toFixed(2)} MB)`)

    if (wavBuffer.length < 1024) {
      return NextResponse.json(
        { error: "Source WAV file is too small or empty" },
        { status: 400 }
      )
    }

    // Write WAV to temp file
    const id = randomUUID()
    const tmpDir = tmpdir()
    inputPath = join(tmpDir, `sm_${id}_input.wav`)
    outputPath = join(tmpDir, `sm_${id}_output.mp3`)

    await writeFile(inputPath, wavBuffer)
    console.log(`[transcode] Wrote WAV to temp: ${inputPath}`)

    // Run ffmpeg
    console.log(`[transcode] Starting ffmpeg transcoding at 192kbps...`)
    const ffmpegLog = await runFfmpeg(inputPath, outputPath)
    console.log(`[transcode] ffmpeg completed`)

    // Read and validate the MP3 output
    const mp3Buffer = await readFile(outputPath)
    console.log(`[transcode] MP3 output: ${mp3Buffer.length} bytes (${(mp3Buffer.length / 1024).toFixed(1)} KB)`)

    const MIN_VALID_BYTES = 10 * 1024 // 10 KB minimum for a real MP3
    if (mp3Buffer.length < MIN_VALID_BYTES) {
      console.error(
        `[transcode] MP3 too small (${mp3Buffer.length} bytes) — transcoding likely failed. ffmpeg log:\n${ffmpegLog}`
      )
      return NextResponse.json(
        {
          error: "Transcoded MP3 is too small to be valid",
          outputBytes: mp3Buffer.length,
        },
        { status: 500 }
      )
    }

    console.log(
      `[transcode] Success: ${(wavBuffer.length / 1024 / 1024).toFixed(2)} MB WAV → ` +
      `${(mp3Buffer.length / 1024).toFixed(1)} KB MP3`
    )

    // Return the MP3 bytes directly — client will upload to Supabase Storage
    return new NextResponse(mp3Buffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": mp3Buffer.length.toString(),
        "Cache-Control": "no-store",
      },
    })
  } catch (err) {
    console.error("[transcode] Unexpected error:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Transcoding failed" },
      { status: 500 }
    )
  } finally {
    // Always clean up temp files
    for (const p of [inputPath, outputPath]) {
      if (p) {
        unlink(p).catch(() => {}) // Non-fatal if already gone
      }
    }
  }
}
