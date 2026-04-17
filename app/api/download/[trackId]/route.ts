import { NextRequest, NextResponse } from "next/server"

// Mock audio data generator - creates a valid MP3 header + silence
// In production, this would fetch the actual audio file from storage
function generateMockMp3(): Buffer {
  // MP3 file with valid header (44 bytes WAV-like structure for simplicity)
  // This creates a minimal valid audio file that browsers can download
  const sampleRate = 44100
  const numChannels = 2
  const bitsPerSample = 16
  const duration = 180 // 3 minutes
  const numSamples = sampleRate * duration
  const dataSize = numSamples * numChannels * (bitsPerSample / 8)
  
  // Create WAV header (browsers handle WAV as well as MP3)
  const buffer = Buffer.alloc(44 + Math.min(dataSize, 1024)) // Limit size for demo
  
  // RIFF header
  buffer.write("RIFF", 0)
  buffer.writeUInt32LE(36 + buffer.length - 44, 4)
  buffer.write("WAVE", 8)
  
  // fmt subchunk
  buffer.write("fmt ", 12)
  buffer.writeUInt32LE(16, 16) // Subchunk1Size
  buffer.writeUInt16LE(1, 20) // AudioFormat (PCM)
  buffer.writeUInt16LE(numChannels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28) // ByteRate
  buffer.writeUInt16LE(numChannels * (bitsPerSample / 8), 32) // BlockAlign
  buffer.writeUInt16LE(bitsPerSample, 34)
  
  // data subchunk
  buffer.write("data", 36)
  buffer.writeUInt32LE(buffer.length - 44, 40)
  
  // Fill with silence (zeros already there from Buffer.alloc)
  
  return buffer
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ trackId: string }> }
) {
  const { trackId } = await params
  
  if (!trackId) {
    return NextResponse.json({ error: "Track ID required" }, { status: 400 })
  }

  try {
    // In production, you would:
    // 1. Verify user authentication
    // 2. Check download permissions
    // 3. Fetch the actual audio file from storage (S3, Vercel Blob, etc.)
    // 4. Log the download for analytics
    
    // For demo, generate a mock audio file
    const audioBuffer = generateMockMp3()
    
    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Disposition": `attachment; filename="track_${trackId}_SoundMolt.mp3"`,
        "Content-Length": audioBuffer.length.toString(),
      },
    })
  } catch (error) {
    console.error("Download error:", error)
    return NextResponse.json({ error: "Download failed" }, { status: 500 })
  }
}
