"use client"

/**
 * Browser-side WAV → MP3 transcoder using lamejs.
 * Uses Web Audio API to decode the source, then lamejs to encode MP3.
 * Only runs client-side (AudioContext is not available in SSR).
 */

function floatToInt16(float32: Float32Array): Int16Array {
  const out = new Int16Array(float32.length)
  for (let i = 0; i < float32.length; i++) {
    const clamped = Math.max(-1, Math.min(1, float32[i]))
    out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
  }
  return out
}

/**
 * Transcode an audio File (any format the browser can decode) to MP3.
 * @param file - Source audio file
 * @param kbps - MP3 bitrate (default 192)
 * @param onProgress - Optional callback with 0-100 progress
 * @returns MP3 Blob
 */
export async function transcodeToMp3(
  file: File,
  kbps = 192,
  onProgress?: (pct: number) => void
): Promise<Blob> {
  // Read the raw bytes
  const arrayBuffer = await file.arrayBuffer()

  // Decode audio using the Web Audio API
  const audioCtx = new AudioContext()
  let audioBuffer: AudioBuffer
  try {
    audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
  } finally {
    await audioCtx.close()
  }

  const numChannels = Math.min(audioBuffer.numberOfChannels, 2)
  const sampleRate = audioBuffer.sampleRate
  const leftF32 = audioBuffer.getChannelData(0)
  const rightF32 = numChannels > 1 ? audioBuffer.getChannelData(1) : audioBuffer.getChannelData(0)

  // Dynamically import lamejs (CommonJS) to avoid SSR issues
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lamejsMod: any = await import("lamejs")
  // Handle both ESM-wrapped and raw CJS default exports
  const Mp3Encoder = lamejsMod.Mp3Encoder ?? lamejsMod.default?.Mp3Encoder
  if (!Mp3Encoder) throw new Error("lamejs Mp3Encoder not found")

  const encoder = new Mp3Encoder(numChannels, sampleRate, kbps)

  const BLOCK = 1152 // lamejs internal block size
  const chunks: Int8Array[] = []
  const totalSamples = leftF32.length
  const totalBlocks = Math.ceil(totalSamples / BLOCK)

  for (let b = 0; b < totalBlocks; b++) {
    const start = b * BLOCK
    const end = Math.min(start + BLOCK, totalSamples)
    const leftChunk = floatToInt16(leftF32.subarray(start, end))
    const rightChunk = floatToInt16(rightF32.subarray(start, end))

    const mp3buf: Int8Array =
      numChannels > 1
        ? encoder.encodeBuffer(leftChunk, rightChunk)
        : encoder.encodeBuffer(leftChunk)

    if (mp3buf.length > 0) chunks.push(mp3buf)

    if (onProgress && b % 200 === 0) {
      onProgress(Math.round((b / totalBlocks) * 90)) // 0-90 during encoding
    }

    // Yield to the event loop every 500 blocks so the UI doesn't freeze
    if (b % 500 === 0 && b > 0) {
      await new Promise((r) => setTimeout(r, 0))
    }
  }

  const tail = encoder.flush()
  if (tail.length > 0) chunks.push(tail)

  onProgress?.(100)

  return new Blob(chunks, { type: "audio/mpeg" })
}

/** Returns true if the file is a WAV that should be transcoded. */
export function isWav(file: File): boolean {
  const ext = file.name.split(".").pop()?.toLowerCase()
  return (
    ext === "wav" ||
    file.type === "audio/wav" ||
    file.type === "audio/x-wav"
  )
}
