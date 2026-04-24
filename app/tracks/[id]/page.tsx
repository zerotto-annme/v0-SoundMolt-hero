import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { getAdminClient } from "@/lib/supabase-admin"
import { SEED_TRACKS } from "@/lib/seed-tracks"
import { CANONICAL_BASE_URL } from "@/lib/site"
import { TrackDetailPageClient, type ResolvedTrack } from "./track-detail-page-client"

// Public Share landing page for a single track.
//
// URL: /tracks/<id>
//   - id may be a Supabase tracks.id (UUID, e.g. 8bc58227-e6fd-4d21-…)
//   - id may be a seed-track id (e.g. seed_42)
//
// This page is INTENTIONALLY public — anyone with the canonical link
// (https://v0-sound-molt-hero-eight.vercel.app/tracks/<id>) must be able
// to open it without logging in. We therefore do NOT call requireAgent()
// here; we read directly from `public.tracks` (RLS already permits
// anonymous SELECT, but we use the admin client so we can also resolve
// the agent profile in a single round-trip).
//
// Render strategy:
//   - Server fetch → resolve a normalized ResolvedTrack shape
//   - Pass to a Client wrapper that mounts the existing TrackDetailModal
//   - 404 if no match in seed AND no match in DB
export const dynamic = "force-dynamic"

interface PageProps {
  params: Promise<{ id: string }>
}

async function resolveTrack(id: string): Promise<ResolvedTrack | null> {
  // 1) Seed lookup — IDs like "seed_42". Cheap, in-memory, no I/O.
  const seed = SEED_TRACKS.find((t) => t.id === id)
  if (seed) {
    return {
      id: seed.id,
      title: seed.title,
      agentName: seed.agentName,
      agentType: seed.agentType,
      agentLabel: seed.agentLabel,
      modelType: seed.modelType,
      modelProvider: seed.modelProvider,
      coverUrl: seed.coverUrl,
      duration: seed.duration,
      plays: seed.plays,
      likes: seed.likes,
      sourceType: "generated",
      downloadEnabled: true,
    }
  }

  // 2) Supabase lookup — real published tracks (UUID id).
  // Service-role client bypasses RLS so we can join the agent profile
  // (agents has owner-only RLS) in the same request.
  let admin
  try {
    admin = getAdminClient()
  } catch {
    // SUPABASE_SERVICE_ROLE_KEY missing → can't resolve DB tracks.
    return null
  }

  const { data: row, error } = await admin
    .from("tracks")
    .select(
      "id, title, style, description, audio_url, original_audio_url, stream_audio_url, cover_url, download_enabled, source_type, plays, likes, duration_seconds, created_at, agent_id"
    )
    .eq("id", id)
    .maybeSingle()

  if (error || !row) return null

  // Optional agent enrichment for display (name, model, provider).
  let agentName = "Unknown agent"
  let modelType = ""
  let modelProvider = ""
  if (row.agent_id) {
    const { data: agent } = await admin
      .from("agents")
      .select("name, model_name, provider")
      .eq("id", row.agent_id)
      .maybeSingle()
    if (agent) {
      agentName = agent.name ?? agentName
      modelType = agent.model_name ?? ""
      modelProvider = agent.provider ?? ""
    }
  }

  const sourceType: "generated" | "uploaded" =
    row.source_type === "generated" ? "generated" : "uploaded"

  return {
    id: row.id,
    title: row.title ?? "Untitled track",
    agentName,
    modelType,
    modelProvider,
    coverUrl: row.cover_url ?? "",
    duration:
      typeof row.duration_seconds === "number" ? row.duration_seconds : undefined,
    plays: typeof row.plays === "number" ? row.plays : 0,
    likes: typeof row.likes === "number" ? row.likes : 0,
    sourceType,
    downloadEnabled: row.download_enabled !== false,
    // Carry audio fields so the global player can stream when the user hits Play.
    audioUrl: row.stream_audio_url || row.audio_url || row.original_audio_url || undefined,
    originalAudioUrl: row.original_audio_url || row.audio_url || undefined,
    description: row.description ?? undefined,
    style: row.style ?? undefined,
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params
  const track = await resolveTrack(id)
  if (!track) {
    return {
      title: "Track not found — SoundMolt",
      description: "This track is no longer available on SoundMolt.",
    }
  }
  const title = `${track.title} by ${track.agentName} — SoundMolt`
  const description =
    track.description ||
    `Listen to "${track.title}" by ${track.agentName} on SoundMolt — the music platform for AI artists.`
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${CANONICAL_BASE_URL}/tracks/${track.id}`,
      images: track.coverUrl ? [{ url: track.coverUrl }] : undefined,
      type: "music.song",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: track.coverUrl ? [track.coverUrl] : undefined,
    },
  }
}

export default async function TrackPage({ params }: PageProps) {
  const { id } = await params
  const track = await resolveTrack(id)
  if (!track) notFound()
  return <TrackDetailPageClient track={track} />
}
