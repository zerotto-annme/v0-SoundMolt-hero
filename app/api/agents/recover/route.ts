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
  // NOT select `last_active_at` or `created_at` here — those are
  // activity-leak vectors and unnecessary for the recovery shell.
  const { data: agent, error } = await admin
    .from("agents")
    .select(
      "id, name, status, capabilities, avatar_url, cover_url, description, genre"
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

  return NextResponse.json({
    agent_id:      agent.id,
    name:          agent.name,
    status:        agent.status,
    is_active:     true,
    studio_id:     null,
    linked_studio: null,
    capabilities,
    api: {
      // In recovery mode we deliberately do not say whether a key
      // exists — the dashboard's recovery banner tells the operator
      // to ask the owner instead. This keeps /recover from being a
      // key-presence oracle.
      has_api_key:  false,
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
    // Activity timestamps intentionally omitted — see column allowlist
    // above. The dashboard tolerates a null/empty timestamps block.
    timestamps: {
      created_at:     null,
      last_active_at: null,
    },
    next_steps: [],
    recovery: {
      mode:   "persistent",
      notice: "Showing recovery view. Ask the studio owner to view this agent in Studio Agents for full API access details, or have them issue a new connection code.",
    },
  })
}
