import { NextRequest, NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase-admin"
import { shapeTracks } from "../../../explore/tracks/route"

/**
 * GET /api/agents/[id]/profile
 *
 * PUBLIC artist/agent detail endpoint feeding `/agents/[id]`.
 *
 * Lives at `[id]/profile` — NOT at `[id]` — because `/api/agents/[id]`
 * is the Bearer-authenticated agent self-management endpoint
 * (GET + PATCH for owner only). Public, unauthenticated detail reads
 * (the artist page) belong on a sibling path so the auth contract on
 * the existing endpoint stays intact.
 *
 * The `[id]` path param can refer to either:
 *   • an `agents.id` row (AI agent created on this platform), or
 *   • a `profiles.id` row (human user who uploaded their own tracks
 *     directly, not through an agent).
 *
 * We try agents first (the common case), then fall back to profiles.
 * The response shape is unified so the page only has to render one
 * payload regardless of which entity backed the URL.
 *
 * Returns:
 *   { entity: { id, kind: "agent"|"user", name, avatarUrl,
 *               coverUrl, description, genre }, tracks: Track[] }
 *
 *   404 when neither an agent nor a profile matches the id.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 })
  }

  const admin = getAdminClient()

  // 1) Agent path — most common when the link comes from a track card
  //    where `track.agentId` was non-null. Column list is restricted
  //    to what is guaranteed to exist on the live DB (verified via
  //    REST schema introspection — `provider`, `api_endpoint`, and
  //    `model_name` are NOT present on the live `agents` table even
  //    though migration 015 declares them).
  const { data: agentRow, error: agentErr } = await admin
    .from("agents")
    .select("id, name, avatar_url, cover_url, description, genre, status")
    .eq("id", id)
    .maybeSingle()

  if (agentErr) {
    console.error("[agents/:id/profile] agent select failed:", {
      code: agentErr.code, message: agentErr.message,
      details: agentErr.details, hint: agentErr.hint, id,
    })
    // fall through and try profiles — the id may still be a user id
  }

  if (agentRow) {
    const { data: trackRows, error: tracksErr } = await admin
      .from("tracks")
      .select(
        "id, title, cover_url, audio_url, original_audio_url, plays, likes, style, source_type, description, download_enabled, created_at, user_id, agent_id, published_at",
      )
      .eq("agent_id", id)
      .not("published_at", "is", null)
      .order("created_at", { ascending: false })
      .limit(200)

    if (tracksErr) {
      console.error("[agents/:id/profile] agent-tracks select failed:", tracksErr.message)
    }

    return NextResponse.json({
      entity: {
        id: agentRow.id as string,
        kind: "agent" as const,
        name: (agentRow as { name?: string }).name ?? "Agent",
        avatarUrl: (agentRow as { avatar_url?: string | null }).avatar_url ?? null,
        coverUrl: (agentRow as { cover_url?: string | null }).cover_url ?? null,
        description: (agentRow as { description?: string | null }).description ?? null,
        genre: (agentRow as { genre?: string | null }).genre ?? null,
      },
      tracks: await shapeTracks(admin, trackRows ?? []),
    })
  }

  // 2) Profile path — id refers to a human user who uploaded tracks
  //    directly (no agent).
  // NOTE: `profiles` has no `bio` column on the live DB (verified via
  // REST schema introspection). The available identity-ish columns
  // are `username`, `artist_name`, and `avatar_url`. We prefer
  // `artist_name` as the display name when set, falling back to
  // `username` so every uploader has something to show.
  const { data: profileRow, error: profileErr } = await admin
    .from("profiles")
    .select("id, username, artist_name, avatar_url")
    .eq("id", id)
    .maybeSingle()

  if (profileErr) {
    console.error("[agents/:id/profile] profile select failed:", profileErr.message)
  }

  if (profileRow) {
    const { data: trackRows, error: tracksErr } = await admin
      .from("tracks")
      .select(
        "id, title, cover_url, audio_url, original_audio_url, plays, likes, style, source_type, description, download_enabled, created_at, user_id, agent_id, published_at",
      )
      .eq("user_id", id)
      .is("agent_id", null)
      .not("published_at", "is", null)
      .order("created_at", { ascending: false })
      .limit(200)

    if (tracksErr) {
      console.error("[agents/:id/profile] user-tracks select failed:", tracksErr.message)
    }

    return NextResponse.json({
      entity: {
        id: profileRow.id as string,
        kind: "user" as const,
        name:
          (profileRow as { artist_name?: string | null }).artist_name ||
          (profileRow as { username?: string | null }).username ||
          "Uploaded Artist",
        avatarUrl: (profileRow as { avatar_url?: string | null }).avatar_url ?? null,
        coverUrl: null,
        description: null,
        genre: null,
      },
      tracks: await shapeTracks(admin, trackRows ?? []),
    })
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 })
}
