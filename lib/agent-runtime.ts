/**
 * Agent Runtime — minimal safe action loop.
 *
 * One entry point per "tick" of work for an agent. Currently the tick
 * does the smallest defensible thing: read the latest feed, pick a
 * single eligible track, and log a structured record into
 * agent_activity_logs. NO comments are written, NO likes are recorded,
 * NO posts are created — this layer exists so the Telegram bot's /act
 * command, the autonomy scheduler, and any future cron-like trigger
 * all share the same code path.
 *
 * Adding a new "action capability" to the runtime is intentionally
 * easy: extend `runAgentTick` (or add a sibling function) and log the
 * outcome via `logAgentActivity`. The runtime is server-only — every
 * call uses `getAdminClient()` which bypasses RLS, so callers MUST
 * gate this behind their own auth checks (admin-only HTTP route, or
 * a server-side caller with a verified agent context such as the
 * Telegram webhook handler).
 */

import { getAdminClient } from "./supabase-admin"

// ─── Types ────────────────────────────────────────────────────────────

export interface AgentActivityLogInput {
  agentId: string
  actionType: string
  targetType?: string | null
  targetId?: string | null
  result?: Record<string, unknown> | null
}

export interface AgentActivityLog {
  id: string
  agent_id: string
  action_type: string
  target_type: string | null
  target_id: string | null
  result: Record<string, unknown> | null
  created_at: string
}

export interface TickResult {
  ok: true
  agent_id: string
  action_type: string
  /** The track the runtime selected, or null if no eligible feed item. */
  picked_track: { id: string; title: string | null; user_id: string | null } | null
  /** Human-readable line the caller can show to a user (Telegram /act). */
  summary: string
  /** Id of the agent_activity_logs row we just wrote. */
  log_id: string
}

export interface TickError {
  ok: false
  agent_id: string
  /** Stable machine identifier for the failure mode. */
  code:
    | "agent_not_found"
    | "agent_inactive"
    | "feed_query_failed"
    | "log_write_failed"
  /** Operator-readable message; safe to show to admins, never includes secrets. */
  message: string
}

// ─── Logger ───────────────────────────────────────────────────────────

/**
 * Append a single row to public.agent_activity_logs.
 *
 * Always uses the service-role client because:
 *   - The table has RLS ON with zero policies (locked down).
 *   - Every legitimate caller is server-side (admin route or webhook).
 *
 * Never throws — failures are returned in the `{ ok: false }` branch so
 * the caller can decide whether the parent action should still succeed
 * (the Telegram bot would prefer to send the user SOMETHING even if the
 * audit insert fails).
 */
export async function logAgentActivity(
  input: AgentActivityLogInput,
): Promise<{ ok: true; log: AgentActivityLog } | { ok: false; error: string; code?: string }> {
  const admin = getAdminClient()
  const { data, error } = await admin
    .from("agent_activity_logs")
    .insert({
      agent_id:    input.agentId,
      action_type: input.actionType,
      target_type: input.targetType ?? null,
      target_id:   input.targetId ?? null,
      result:      input.result ?? null,
    })
    .select("id, agent_id, action_type, target_type, target_id, result, created_at")
    .single()

  if (error || !data) {
    console.error("[agent-runtime] logAgentActivity failed:", {
      agent_id: input.agentId,
      action_type: input.actionType,
      message: error?.message,
      code: error?.code,
    })
    return { ok: false, error: error?.message ?? "log_insert_failed", code: error?.code }
  }
  return { ok: true, log: data as AgentActivityLog }
}

// ─── Tick ─────────────────────────────────────────────────────────────

/**
 * Run one tick for a specific agent.
 *
 * Steps:
 *  1. Verify the agent exists and is active. If not, log nothing and
 *     return a structured error (the caller decides what to surface).
 *  2. Fetch the most recent published tracks (small bounded window —
 *     we only need a handful to pick from).
 *  3. Filter out tracks the agent itself authored — picking your own
 *     track on a "feed check" would be both useless and confusing.
 *  4. If something eligible remains, take the most recent one as the
 *     picked track. Log action_type='tick.feed_check'.
 *  5. If nothing is eligible, log action_type='tick.skipped_no_feed'.
 *
 * Deliberately does NOT take any social action (no like, no comment,
 * no publish). Per the runtime brief, this layer is "minimal safe":
 * any action that mutates other users' state must go through an
 * explicit, capability-gated handler.
 */
export async function runAgentTick(agentId: string): Promise<TickResult | TickError> {
  if (!agentId || typeof agentId !== "string") {
    return { ok: false, agent_id: agentId, code: "agent_not_found", message: "agent_id is required" }
  }

  const admin = getAdminClient()

  // 1) Look up the agent (status + user_id needed for the eligibility filter).
  const { data: agent, error: agentErr } = await admin
    .from("agents")
    .select("id, name, status, user_id")
    .eq("id", agentId)
    .maybeSingle()

  if (agentErr) {
    console.error("[agent-runtime] tick agent lookup failed:", agentErr)
    return { ok: false, agent_id: agentId, code: "agent_not_found", message: agentErr.message }
  }
  if (!agent) {
    return { ok: false, agent_id: agentId, code: "agent_not_found", message: "Agent does not exist" }
  }
  // 'pending' is the only known non-active state at the time of writing
  // (see migration 023). We still allow the tick when status is unset
  // because legacy rows from before 023 may have NULL.
  if (agent.status && agent.status !== "active") {
    return {
      ok: false,
      agent_id: agentId,
      code: "agent_inactive",
      message: `Agent status is "${agent.status}", expected "active"`,
    }
  }

  // 2) Pull a bounded window of recent published tracks. We grab a few
  //    more than 1 so the eligibility filter (skip-self) has options.
  const { data: tracks, error: feedErr } = await admin
    .from("tracks")
    .select("id, title, user_id, agent_id, created_at")
    .order("created_at", { ascending: false })
    .limit(10)

  if (feedErr) {
    console.error("[agent-runtime] tick feed query failed:", feedErr)
    // Best-effort log of the failure so the operator sees it in the
    // activity log (not just in the server console).
    await logAgentActivity({
      agentId,
      actionType: "tick.feed_check",
      result: { error: feedErr.message, code: feedErr.code ?? null },
    }).catch(() => {})
    return { ok: false, agent_id: agentId, code: "feed_query_failed", message: feedErr.message }
  }

  // 3) Filter out the agent's own tracks (by both user_id and agent_id —
  //    tracks can be authored by either, depending on creation path).
  const eligible = (tracks ?? []).filter(
    (t) => t.user_id !== agent.user_id && t.agent_id !== agent.id,
  )

  // 4 / 5) Pick the freshest eligible track, or log a no-op skip.
  if (eligible.length === 0) {
    const log = await logAgentActivity({
      agentId,
      actionType: "tick.skipped_no_feed",
      result: { feed_size: tracks?.length ?? 0, eligible: 0 },
    })
    if (!log.ok) {
      return { ok: false, agent_id: agentId, code: "log_write_failed", message: log.error }
    }
    return {
      ok: true,
      agent_id: agentId,
      action_type: "tick.skipped_no_feed",
      picked_track: null,
      summary: "Feed had no new tracks for this agent to inspect.",
      log_id: log.log.id,
    }
  }

  const picked = eligible[0]
  const log = await logAgentActivity({
    agentId,
    actionType: "tick.feed_check",
    targetType: "track",
    targetId: picked.id,
    result: {
      track_title: picked.title ?? null,
      track_user_id: picked.user_id ?? null,
      track_agent_id: picked.agent_id ?? null,
      picked_at: new Date().toISOString(),
    },
  })
  if (!log.ok) {
    return { ok: false, agent_id: agentId, code: "log_write_failed", message: log.error }
  }

  return {
    ok: true,
    agent_id: agentId,
    action_type: "tick.feed_check",
    picked_track: { id: picked.id, title: picked.title ?? null, user_id: picked.user_id ?? null },
    summary: `Checked feed and selected track: ${picked.title ?? "(untitled)"}`,
    log_id: log.log.id,
  }
}
