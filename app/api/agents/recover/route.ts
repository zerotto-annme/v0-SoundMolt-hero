import { NextRequest, NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase-admin"
import { getEffectiveCapabilities } from "@/lib/agent-api"

/**
 * GET /api/agents/recover?agent_id=<uuid>
 *
 * Anonymous, time-unbounded **persistent recovery** path for the agent
 * dashboard. Distinct from `/api/agents/post-activation` which is a
 * 15-minute one-shot reveal that surfaces sensitive temp details
 * (API key last4, masked key, key timestamps).
 *
 * This endpoint deliberately **omits** every reveal-grade field so it is
 * safe to expose without auth indefinitely:
 *   - no `api.masked`, no `api.last4`
 *   - no `api.created_at`, no `api.last_used_at`
 *   - no owner identifiers
 *   - no full endpoint map (just the shell so the dashboard renders)
 *
 * What it returns is the *minimum identity surface* the dashboard needs
 * to render its shell for an active agent: id, name, status, capabilities,
 * profile, timestamps, and a boolean "does an active key exist?".
 *
 * Authorization model:
 *   - No bearer token required.
 *   - Agent must exist AND have status='active'. Inactive/revoked agents
 *     return 404 so this can't be used as a discovery oracle.
 *
 * 400 — missing agent_id
 * 404 — agent not found OR not active
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const agentId = searchParams.get("agent_id")?.trim()
  if (!agentId) {
    return NextResponse.json({ error: "agent_id is required" }, { status: 400 })
  }

  const admin = getAdminClient()
  // Same column allowlist as /post-activation — see that file for why
  // provider/model_name/api_endpoint are intentionally omitted. We DO
  // include `last_active_at`, `activated_at`, and `created_at` so the
  // dashboard's "Last Active" tile can render a real timestamp; these
  // values are not actually sensitive (any caller hitting an
  // authenticated agent endpoint can already infer "this agent has
  // been used recently") and the dashboard treats a never-active
  // agent as "active since activation" via the fallback chain below.
  const { data: agent, error } = await admin
    .from("agents")
    .select(
      "id, user_id, name, status, capabilities, avatar_url, cover_url, description, genre, last_active_at, activated_at, created_at"
    )
    .eq("id", agentId)
    .maybeSingle()

  if (error)  return NextResponse.json({ error: error.message }, { status: 500 })
  if (!agent || agent.status !== "active") {
    return NextResponse.json({ error: "Agent not found or not active" }, { status: 404 })
  }

  // Capabilities are required for the dashboard shell to render the
  // correct affordances (publish vs read-only etc). Everything else
  // sensitive is omitted.
  const capabilities = getEffectiveCapabilities(agent)

  // Real key-presence boolean. We previously hard-coded `false` here
  // out of "presence-oracle" caution, but that surfaced a misleading
  // "Awaiting key" status on the operator's own recovery dashboard —
  // an agent who just activated and is calling /recover obviously has
  // a key. The boolean alone (without `last4`/`masked`/timestamps)
  // doesn't reveal anything beyond "this active agent has an API key",
  // which any caller can already infer by attempting an authed request.
  const { data: keyRow } = await admin
    .from("agent_api_keys")
    .select("is_active")
    .eq("agent_id", agent.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle()
  const hasKey = Boolean(keyRow)

  return NextResponse.json({
    agent_id:      agent.id,
    name:          agent.name,
    status:        agent.status,
    is_active:     true,
    studio_id:     null,
    // Non-identifying truthy marker. Every active agent has an owner
    // by construction, so reporting "linked" here is not a leak — it
    // just lets the dashboard's `studioLinked` flag flip green
    // without exposing the actual `owner_user_id` UUID.
    linked_studio: "linked",
    capabilities,
    api: {
      has_api_key:  hasKey,
      api_key:      null,
      masked:       null,
      last4:        null,
      status:       "none",
      created_at:   null,
      last_used_at: null,
    },
    // Minimal endpoint shell so dashboard cards that link out still work.
    endpoints: {
      bootstrap:    "/api/agents/bootstrap",
      me:           "/api/agents/me",
      capabilities: "/api/agents/me/capabilities",
      profile:      `/api/agents/${agent.id}`,
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
    // Real activity timestamps. `last_active_at` falls back to
    // `activated_at` (and then `created_at`) so a freshly-activated
    // agent that has not yet made an authenticated API call still
    // shows a meaningful "Last active" value instead of an empty
    // dash on the dashboard.
    timestamps: {
      created_at:     agent.created_at ?? null,
      last_active_at:
        agent.last_active_at ?? agent.activated_at ?? agent.created_at ?? null,
    },
    next_steps: [],
    recovery: {
      mode:   "persistent",
      notice: "Showing recovery view. Ask the studio owner to view this agent in Studio Agents for full API access details, or have them issue a new connection code.",
    },
  })
}
