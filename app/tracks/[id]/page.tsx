import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { createClient } from "@supabase/supabase-js"
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

// Public Supabase client used as a TRACK-fetch fallback when the
// service-role key isn't configured (e.g. a Vercel project that only
// has NEXT_PUBLIC_* env vars wired up). RLS on public.tracks already
// permits "public can read all tracks", so anon is sufficient to load
// the track itself. Agent enrichment still needs service-role because
// public.agents has owner-only RLS — we degrade gracefully when it's
// unavailable rather than 404'ing the whole page.
function getPublicClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return null
  return createClient(url, anon, { auth: { persistSession: false } })
}

const TRACK_FIELDS =
  "id, title, style, description, audio_url, original_audio_url, stream_audio_url, cover_url, download_enabled, source_type, plays, likes, duration_seconds, created_at, agent_id, user_id"

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
  //
  // Resilience: try service-role admin client first (full access, also
  // unlocks agent enrichment), but fall back to the public anon client
  // when SUPABASE_SERVICE_ROLE_KEY isn't configured. RLS on public.tracks
  // permits anonymous SELECT, so the track itself loads either way. This
  // makes the share link work on Vercel projects that only have the
  // NEXT_PUBLIC_* env vars (a common v0.app / preview deployment state).
  let admin: ReturnType<typeof getAdminClient> | null = null
  try {
    admin = getAdminClient()
  } catch {
    admin = null
  }

  const trackClient = admin ?? getPublicClient()
  if (!trackClient) {
    // Neither service-role nor anon credentials available — environment
    // is fundamentally misconfigured. Log so it shows up in server logs.
    console.error(
      "[/tracks/[id]] Cannot resolve track: missing both SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_ANON_KEY"
    )
    return null
  }

  const { data: row, error } = await trackClient
    .from("tracks")
    .select(TRACK_FIELDS)
    .eq("id", id)
    .maybeSingle()

  if (error) {
    console.warn(
      `[/tracks/[id]] Supabase lookup failed for ${id} (using ${admin ? "service-role" : "anon"} client):`,
      error.message
    )
    return null
  }
  if (!row) return null

  // Optional agent enrichment — requires service-role because public.agents
  // has owner-only RLS. Degrade silently if not available; the track still
  // renders with a placeholder agent name rather than 404'ing.
  let agentName = "Unknown agent"
  let modelType = ""
  let modelProvider = ""
  if (row.agent_id && admin) {
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
    // Owner — surfaces the AI Producer Review button on this share page
    // when the viewer is the track owner. Public viewers see no change
    // (the modal hides the control unless user.id === track.userId).
    userId: row.user_id ?? null,
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
