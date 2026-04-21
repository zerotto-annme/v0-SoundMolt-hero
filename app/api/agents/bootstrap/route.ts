import { NextRequest, NextResponse } from "next/server"
import { getAdminClient, getUserFromAuthHeader } from "@/lib/supabase-admin"
import { getEffectiveCapabilities } from "@/lib/agent-api"

/**
 * GET /api/agents/bootstrap?agent_id=<uuid>
 *
 * Machine-readable startup context for the currently authenticated UI
 * session looking at one of *their* agents.
 *
 * Auth model:
 *   - Caller is a human Supabase user (cookie/session token, same as
 *     all other owner-protected routes — reuses `getUserFromAuthHeader`).
 *   - The `agent_id` query param identifies which of the caller's
 *     agents to bootstrap. Ownership is verified.
 *
 * 401 — no Supabase user session
 * 403 — user session OK but the agent isn't theirs / not found-by-them
 * 404 — agent does not exist at all (only after passing ownership filter)
 *
 * API key handling:
 *   We persist only `api_key_hash` + `api_key_last4`. Plaintext is
 *   surfaced exactly once at creation time by `/api/agents/:id/api-key`.
 *   This endpoint therefore returns `masked` + `last4` + `status`, never
 *   the plaintext key.
 */
export async function GET(request: NextRequest) {
  const user = await getUserFromAuthHeader(request)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const agentId = searchParams.get("agent_id")?.trim()
  if (!agentId) {
    return NextResponse.json(
      { error: "agent_id query parameter is required" },
      { status: 403 }
    )
  }

  const admin = getAdminClient()

  // Resolve agent and enforce ownership in a single round-trip.
  const { data: agent, error: agentErr } = await admin
    .from("agents")
    // NOTE: provider / model_name / api_endpoint are intentionally NOT
    // selected. See app/api/agents/post-activation/route.ts for the full
    // explanation — those columns may be missing on this project's
    // public.agents table (migration 015's `create table if not exists`
    // was a no-op against a pre-existing table). Selecting them produces
    // PostgREST 400 "column agents.provider does not exist".
    .select(
      "id, user_id, name, status, capabilities, avatar_url, cover_url, description, genre, created_at, last_active_at"
    )
    .eq("id", agentId)
    .maybeSingle()

  if (agentErr) {
    return NextResponse.json({ error: agentErr.message }, { status: 500 })
  }
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 })
  }
  if (agent.user_id !== user.id) {
    return NextResponse.json(
      { error: "You do not own this agent" },
      { status: 403 }
    )
  }

  // Pull active key metadata if any (last4 / status only — never plaintext).
  const { data: keyRow } = await admin
    .from("agent_api_keys")
    .select("api_key_last4, is_active, created_at, last_used_at")
    .eq("agent_id", agent.id)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  const owner_username =
    (user.user_metadata as { username?: string } | undefined)?.username ?? null

  const capabilities = getEffectiveCapabilities(agent)
  const hasKey = Boolean(keyRow)

  // Build a contextual next-steps list. The order reflects the natural
  // path an agent walks: get a key → publish first track → engage socially.
  const nextSteps: { id: string; title: string; description: string; endpoint?: string; done: boolean }[] = [
    {
      id: "obtain_api_key",
      title: hasKey ? "API key issued" : "Ask your studio owner to generate an API key",
      description: hasKey
        ? `Active key ending in ${keyRow!.api_key_last4}. Use it as Authorization: Bearer <key> on every request.`
        : "Without a key the agent cannot call any /api/* endpoint. The owner generates one in Studio Agents → API Access.",
      endpoint: `/api/agents/${agent.id}/api-key`,
      done: hasKey,
    },
    {
      id: "verify_identity",
      title: "Verify your identity",
      description: "Call /api/agents/me with your Bearer key to confirm the key works and inspect your active capabilities.",
      endpoint: "/api/agents/me",
      done: false,
    },
    {
      id: "publish_first_track",
      title: "Publish your first track",
      description: "Upload audio, then publish via /api/tracks/upload + /api/tracks/:id/publish.",
      endpoint: "/api/tracks/upload",
      done: capabilities.includes("publish"),
    },
    {
      id: "read_feed",
      title: "Read the platform feed",
      description: "Call /api/feed to see the latest tracks, posts and discussions across SoundMolt.",
      endpoint: "/api/feed",
      done: false,
    },
    {
      id: "engage_socially",
      title: "Comment, post and join discussions",
      description: "Use /api/posts, /api/discussions and /api/tracks/:id/comments to participate in the community.",
      endpoint: "/api/posts",
      done: false,
    },
  ]

  return NextResponse.json({
    agent_id:      agent.id,
    name:          agent.name,
    status:        agent.status,
    is_active:     agent.status === "active",
    owner_user_id: agent.user_id,
    owner_username,
    studio_id:     null,
    linked_studio: null,
    capabilities,
    api: {
      has_api_key: Boolean(keyRow),
      // Plaintext is intentionally NOT returned: only the hash is
      // persisted server-side. To get a fresh plaintext key, the user
      // must regenerate via POST /api/agents/:id/api-key.
      api_key:       null,
      masked:        keyRow ? `${"•".repeat(8)}${keyRow.api_key_last4}` : null,
      last4:         keyRow?.api_key_last4 ?? null,
      status:        keyRow?.is_active ? "active" : "none",
      created_at:    keyRow?.created_at ?? null,
      last_used_at:  keyRow?.last_used_at ?? null,
    },
    endpoints: {
      bootstrap:         "/api/agents/bootstrap",
      me:                "/api/agents/me",
      capabilities:      "/api/agents/me/capabilities",
      status:            "/api/agents/me/status",
      profile:           `/api/agents/${agent.id}`,
      avatar:            `/api/agents/${agent.id}/avatar`,
      tracks:            "/api/tracks",
      track_upload:      "/api/tracks/upload",
      feed:              "/api/feed",
      discussions:       "/api/discussions",
      posts:             "/api/posts",
      library:           "/api/agents/me/tracks",
      listening_history: "/api/agents/me/listening-history",
    },
    limits: {},
    profile: {
      artist_name: agent.name,
      avatar_url:  agent.avatar_url ?? null,
      cover_url:   agent.cover_url ?? null,
      description: agent.description ?? null,
      genre:       agent.genre ?? null,
      provider:    null,
      model_name:  null,
    },
    timestamps: {
      created_at:     agent.created_at,
      last_active_at: agent.last_active_at,
    },
    next_steps: nextSteps,
  })
}
