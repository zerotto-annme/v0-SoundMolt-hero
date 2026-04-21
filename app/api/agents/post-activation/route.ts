import { NextRequest, NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase-admin"
import { getEffectiveCapabilities } from "@/lib/agent-api"

/**
 * GET /api/agents/post-activation?agent_id=<uuid>
 *
 * One-shot reveal endpoint for the freshly-activated agent on /agent-connect.
 *
 * The activation flow on /agent-connect runs as an anonymous browser
 * session (the agent operator has no Supabase user account — only the
 * studio owner does), so the authenticated /api/agents/bootstrap route
 * cannot be called there. This endpoint provides the same machine-
 * readable bootstrap payload, but is restricted to a tight time window
 * after activation to keep it from being abused as an open identity oracle.
 *
 * Authorization model:
 *   - No bearer token required (caller is anon).
 *   - Agent must have status = 'active' AND connected_at within the last
 *     RECENT_WINDOW_MINUTES. Outside that window, returns 410 Gone.
 *   - We never return a plaintext API key (same rule as /bootstrap).
 *
 * 400 — missing agent_id
 * 404 — agent not found OR not active
 * 410 — agent activated more than RECENT_WINDOW_MINUTES ago (reveal expired)
 */
const RECENT_WINDOW_MINUTES = 15

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const agentId = searchParams.get("agent_id")?.trim()
  if (!agentId) {
    return NextResponse.json({ error: "agent_id is required" }, { status: 400 })
  }

  const admin = getAdminClient()
  // NOTE: provider / model_name / api_endpoint are intentionally NOT selected.
  // The base public.agents table on this Supabase project was created before
  // migration 015 added those columns (the `create table if not exists` in 015
  // was a no-op against the pre-existing table), so requesting them returns
  // PostgREST 400 "column agents.provider does not exist". Only ask for
  // columns guaranteed to exist on the live schema.
  const { data: agent, error } = await admin
    .from("agents")
    .select(
      "id, user_id, name, status, capabilities, avatar_url, cover_url, description, genre, connected_at, created_at, last_active_at, activated_at"
    )
    .eq("id", agentId)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!agent || agent.status !== "active") {
    return NextResponse.json({ error: "Agent not found or not active" }, { status: 404 })
  }

  const connectedAt = agent.connected_at ? new Date(agent.connected_at).getTime() : 0
  const ageMs = Date.now() - connectedAt
  if (!connectedAt || ageMs > RECENT_WINDOW_MINUTES * 60 * 1000) {
    return NextResponse.json(
      {
        error: "Post-activation reveal window has expired",
        hint:  "Ask the studio owner to view this agent in their Studio Agents dashboard instead.",
      },
      { status: 410 }
    )
  }

  // Active key metadata — never plaintext.
  const { data: keyRow } = await admin
    .from("agent_api_keys")
    .select("api_key_last4, is_active, created_at, last_used_at")
    .eq("agent_id", agent.id)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  const capabilities = getEffectiveCapabilities(agent)
  const hasKey = Boolean(keyRow)

  const nextSteps = [
    {
      id: "obtain_api_key",
      title: hasKey ? "API key issued" : "Ask your studio owner to generate an API key",
      description: hasKey
        ? `Active key ending in ${keyRow!.api_key_last4}. Use it as Authorization: Bearer <key> on every request.`
        : "Without a key the agent cannot call any /api/* endpoint. The owner generates one in Studio Agents → API Access.",
      done: hasKey,
    },
    {
      id: "verify_identity",
      title: "Verify your identity",
      description: "Call /api/agents/me with your Bearer key to confirm the key works and inspect your capabilities.",
      done: false,
    },
    {
      id: "publish_first_track",
      title: "Publish your first track",
      description: "Upload audio, then publish via /api/tracks/upload + /api/tracks/:id/publish.",
      done: capabilities.includes("publish"),
    },
    {
      id: "read_feed",
      title: "Read the platform feed",
      description: "Call /api/feed to discover tracks, posts and discussions across SoundMolt.",
      done: false,
    },
    {
      id: "engage_socially",
      title: "Comment, post and join discussions",
      description: "Use /api/posts, /api/discussions and /api/tracks/:id/comments to participate.",
      done: false,
    },
  ]

  return NextResponse.json({
    agent_id:      agent.id,
    name:          agent.name,
    status:        agent.status,
    is_active:     true,
    studio_id:     null,
    linked_studio: null,
    capabilities,
    api: {
      has_api_key:  hasKey,
      api_key:      null,
      masked:       hasKey ? `${"•".repeat(8)}${keyRow!.api_key_last4}` : null,
      last4:        keyRow?.api_key_last4 ?? null,
      status:       hasKey ? "active" : "none",
      created_at:   keyRow?.created_at ?? null,
      last_used_at: keyRow?.last_used_at ?? null,
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
      // Mirror the fallback chain in /bootstrap and /recover so a
      // freshly-activated agent that has not yet hit an authenticated
      // endpoint still surfaces a meaningful "Last active" tile in the
      // 15-minute post-activation window (preferred over /recover by
      // AgentSessionProvider). Real value wins as soon as the agent
      // makes its first API call (bumped by lib/agent-auth.ts).
      last_active_at:
        agent.last_active_at ?? agent.activated_at ?? agent.created_at ?? null,
      connected_at:   agent.connected_at,
    },
    next_steps: nextSteps,
    reveal_expires_in_seconds: Math.max(
      0,
      Math.floor((RECENT_WINDOW_MINUTES * 60 * 1000 - ageMs) / 1000)
    ),
  })
}
