/**
 * DEPRECATED — Browser-side lamejs transcoding was replaced with server-side
 * ffmpeg transcoding via /api/transcode.
 *
 * lamejs produced ~1 KB invalid MP3 files due to encoding issues in the
 * Next.js/Turbopack environment. The server-side approach uses real ffmpeg
 * (6.1.2 with libmp3lame) and produces valid playable MP3 files.
 *
 * This file is kept for reference only and is NOT imported anywhere.
 */

export {}
