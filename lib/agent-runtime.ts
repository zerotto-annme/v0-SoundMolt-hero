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
import { likeTrack, createTrackComment } from "./agent-actions"

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

// ─── runAgentAct types ────────────────────────────────────────────────

export type AgentActChoice = "like" | "comment" | "none"

export interface ActPickedTrack {
  id: string
  title: string | null
  user_id: string | null
}

export interface ActOk {
  ok: true
  agent_id: string
  /** Which action the runtime actually performed (or 'none' on no-op). */
  action: AgentActChoice
  /** The track the action targeted, or null when action === 'none'. */
  picked_track: ActPickedTrack | null
  /** For action='comment', the exact body the agent wrote. */
  comment_body?: string | null
  /** Stable machine code explaining no-ops ('no_capability', 'no_eligible_tracks', …). */
  code:
    | "liked"
    | "commented"
    | "no_capability"
    | "no_eligible_tracks"
    | "feed_empty"
  /** Human-readable line for the Telegram bot to relay back. */
  summary: string
  /** Id of the agent_activity_logs row we just wrote. */
  log_id: string | null
}

export interface ActError {
  ok: false
  agent_id: string
  code:
    | "agent_not_found"
    | "agent_inactive"
    | "feed_query_failed"
    | "reactions_query_failed"
    | "action_failed"
    | "log_write_failed"
  message: string
}

export type AgentActResult = ActOk | ActError

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

// ─── Act ──────────────────────────────────────────────────────────────

/**
 * Short, neutral, music-focused comment templates. Deliberately:
 *   • short (one sentence, no questions, no @-mentions, no links)
 *   • opinion-less about the artist as a person
 *   • specific to a musical element so it can't be mistaken for a bot ping
 *
 * The pool is small on purpose — adding many near-duplicates would not
 * make the bot less spammy, just less obvious. The picker uses a stable
 * (agent_id + track_id)-derived index so re-running /act on the same
 * pair would write the same line, but the duplicate-check above prevents
 * that ever happening for real.
 */
const SAFE_COMMENT_POOL = [
  "Nice atmosphere. The mix feels clean.",
  "Strong groove. The intro works well.",
  "Interesting texture. I'd keep building this idea.",
  "Solid arrangement. The transitions land.",
  "Warm sound. The low-end sits well.",
  "Good direction. Curious where this goes.",
] as const

function pickComment(agentId: string, trackId: string): string {
  // Tiny, dependency-free string hash → deterministic per (agent, track).
  // Using FNV-1a-style folding; collisions are fine, only need uniform spread.
  const seed = `${agentId}:${trackId}`
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return SAFE_COMMENT_POOL[h % SAFE_COMMENT_POOL.length]!
}

/**
 * Run one bounded social action for an agent.
 *
 * Algorithm:
 *  1. Verify agent exists and is active (mirrors runAgentTick).
 *  2. Pull the 20 freshest PUBLISHED tracks (`published_at IS NOT NULL`).
 *  3. Drop the agent's own tracks (by user_id OR agent_id).
 *  4. Look up which of those candidate tracks the agent has already
 *     liked / commented on (one indexed query per junction table).
 *  5. Pick the action by capability priority — `like` first (cheaper,
 *     idempotent), then `comment` / `social_write`.
 *  6. Walk the candidates in feed order; first one that hasn't already
 *     received the chosen action becomes the target.
 *  7. Execute exactly ONE action through the same `lib/agent-actions.ts`
 *     helpers the public agent routes use, so DB state matches what
 *     POST /api/tracks/:id/like and POST /api/tracks/:id/comment produce.
 *  8. Always write a single agent_activity_logs row describing the
 *     outcome (action='liked' / 'commented' / 'no-op with reason').
 *
 * Strict no-spam guarantee: at most ONE write to track_likes OR
 * track_comments per call. Never both.
 *
 * Concurrency safety: the comment path also relies on the partial
 * unique index added by migration 049
 * (uq_track_comments_agent_track_toplevel) so that two tightly-spaced
 * /act calls cannot both pass the "already commented?" SELECT and
 * insert duplicate rows. The race resolves to SQLSTATE 23505 on the
 * losing side, which we translate into the same friendly
 * "already_engaged" response the runtime would give for sequential
 * duplicates.
 */
export async function runAgentAct(agentId: string): Promise<AgentActResult> {
  try {
    return await runAgentActImpl(agentId)
  } catch (err) {
    // Belt-and-braces: every expected failure is already returned as a
    // structured ActError, but unexpected runtime exceptions (Supabase
    // client crashes, OOM during JSON, etc.) would otherwise bubble up
    // to the Telegram webhook handler. The webhook has its own outer
    // catch, but giving the runtime its own structured error means
    // non-webhook callers (the admin /api/agent-runtime/tick endpoint
    // and any future cron) get the same uniform contract.
    console.error("[agent-runtime] runAgentAct unhandled error:", err)
    return {
      ok: false,
      agent_id: agentId,
      code: "action_failed",
      message: err instanceof Error ? err.message : "unknown runtime error",
    }
  }
}

async function runAgentActImpl(agentId: string): Promise<AgentActResult> {
  if (!agentId || typeof agentId !== "string") {
    return { ok: false, agent_id: agentId, code: "agent_not_found", message: "agent_id is required" }
  }

  const admin = getAdminClient()

  // 1) Agent lookup — need user_id (for ownership skip + comment author)
  //    and capabilities (for the priority decision).
  const { data: agent, error: agentErr } = await admin
    .from("agents")
    .select("id, name, status, user_id, capabilities")
    .eq("id", agentId)
    .maybeSingle()

  if (agentErr) {
    console.error("[agent-runtime] act agent lookup failed:", agentErr)
    return { ok: false, agent_id: agentId, code: "agent_not_found", message: agentErr.message }
  }
  if (!agent) {
    return { ok: false, agent_id: agentId, code: "agent_not_found", message: "Agent does not exist" }
  }
  if (agent.status && agent.status !== "active") {
    return {
      ok: false,
      agent_id: agentId,
      code: "agent_inactive",
      message: `Agent status is "${agent.status}", expected "active"`,
    }
  }
  if (!agent.user_id) {
    // Comments require owner_user_id (NOT NULL on track_comments).
    return {
      ok: false,
      agent_id: agentId,
      code: "agent_inactive",
      message: "Agent has no owner user_id; cannot author comments.",
    }
  }

  const caps = (agent.capabilities ?? []) as string[]
  const canLike    = caps.length === 0 || caps.includes("like")
  const canComment = caps.length === 0 || caps.includes("comment") || caps.includes("social_write")

  if (!canLike && !canComment) {
    const log = await logAgentActivity({
      agentId,
      actionType: "act.no_capability",
      result: { capabilities: caps },
    })
    return {
      ok: true,
      agent_id: agentId,
      action: "none",
      picked_track: null,
      code: "no_capability",
      summary: "Agent has neither 'like' nor 'comment'/'social_write' capability — nothing to do.",
      log_id: log.ok ? log.log.id : null,
    }
  }

  // 2) Candidate feed: published only, freshest first, bounded window.
  //    20 is enough headroom for the duplicate-skip filter on a single
  //    /act call without inflating payload.
  const { data: tracks, error: feedErr } = await admin
    .from("tracks")
    .select("id, title, user_id, agent_id, published_at, created_at")
    .not("published_at", "is", null)
    .order("created_at", { ascending: false })
    .limit(20)

  if (feedErr) {
    console.error("[agent-runtime] act feed query failed:", feedErr)
    await logAgentActivity({
      agentId,
      actionType: "act.feed_query_failed",
      result: { error: feedErr.message, code: feedErr.code ?? null },
    }).catch(() => {})
    return { ok: false, agent_id: agentId, code: "feed_query_failed", message: feedErr.message }
  }

  // 3) Filter out the agent's own work (both linkage paths).
  const candidates = (tracks ?? []).filter(
    (t) => t.user_id !== agent.user_id && t.agent_id !== agent.id,
  )

  if (candidates.length === 0) {
    const log = await logAgentActivity({
      agentId,
      actionType: "act.feed_empty",
      result: { feed_size: tracks?.length ?? 0 },
    })
    return {
      ok: true,
      agent_id: agentId,
      action: "none",
      picked_track: null,
      code: "feed_empty",
      summary: "No fresh tracks from other artists in the feed right now.",
      log_id: log.ok ? log.log.id : null,
    }
  }

  const candidateIds = candidates.map((t) => t.id)

  // 4) Reactions already produced by THIS agent for the candidate window.
  //    Two narrowly-scoped queries (`agent_id = ? AND track_id IN (...)`)
  //    keep the planner on the existing indexes.
  const [likedRes, commentedRes] = await Promise.all([
    admin
      .from("track_likes")
      .select("track_id")
      .eq("agent_id", agentId)
      .in("track_id", candidateIds),
    admin
      .from("track_comments")
      .select("track_id")
      .eq("agent_id", agentId)
      .in("track_id", candidateIds),
  ])

  if (likedRes.error || commentedRes.error) {
    const err = likedRes.error ?? commentedRes.error!
    console.error("[agent-runtime] act reactions query failed:", err)
    return { ok: false, agent_id: agentId, code: "reactions_query_failed", message: err.message }
  }

  const alreadyLiked     = new Set((likedRes.data     ?? []).map((r) => r.track_id))
  const alreadyCommented = new Set((commentedRes.data ?? []).map((r) => r.track_id))

  // 5) Action priority: like first (cheap + idempotent), comment second.
  //    Walk the candidates in feed order so we always target the freshest
  //    eligible track for the chosen action.
  let chosen: { track: typeof candidates[number]; action: "like" | "comment" } | null = null

  if (canLike) {
    const t = candidates.find((c) => !alreadyLiked.has(c.id))
    if (t) chosen = { track: t, action: "like" }
  }
  if (!chosen && canComment) {
    const t = candidates.find((c) => !alreadyCommented.has(c.id))
    if (t) chosen = { track: t, action: "comment" }
  }

  if (!chosen) {
    const log = await logAgentActivity({
      agentId,
      actionType: "act.no_eligible_tracks",
      result: {
        feed_size:           tracks?.length ?? 0,
        candidate_count:     candidates.length,
        already_liked:       alreadyLiked.size,
        already_commented:   alreadyCommented.size,
        capabilities:        caps,
      },
    })
    return {
      ok: true,
      agent_id: agentId,
      action: "none",
      picked_track: null,
      code: "no_eligible_tracks",
      summary: "Agent has already engaged with every fresh track in the feed.",
      log_id: log.ok ? log.log.id : null,
    }
  }

  // 6) Execute exactly one action via the shared agent-actions helpers.
  const ref = { agentId, ownerUserId: agent.user_id }

  if (chosen.action === "like") {
    const result = await likeTrack(ref, { trackId: chosen.track.id })
    if (!result.ok) {
      console.error("[agent-runtime] act like failed:", { status: result.status, error: result.error })
      await logAgentActivity({
        agentId,
        actionType: "act.like_failed",
        targetType: "track",
        targetId: chosen.track.id,
        result: { error: result.error, status: result.status, code: result.code ?? null },
      }).catch(() => {})
      return { ok: false, agent_id: agentId, code: "action_failed", message: result.error }
    }

    const log = await logAgentActivity({
      agentId,
      actionType: "act.like",
      targetType: "track",
      targetId: chosen.track.id,
      result: {
        track_title: chosen.track.title ?? null,
        new_like:    result.data.new_like,
        total_likes: result.data.total_likes,
      },
    })
    if (!log.ok) {
      // The DB write succeeded; just lost the audit row. Still surface
      // success to the caller so the user sees the action took effect.
      console.error("[agent-runtime] act.like succeeded but log failed:", log.error)
    }

    return {
      ok: true,
      agent_id: agentId,
      action: "like",
      picked_track: {
        id: chosen.track.id,
        title: chosen.track.title ?? null,
        user_id: chosen.track.user_id ?? null,
      },
      code: "liked",
      summary: `Liked track: ${chosen.track.title ?? "(untitled)"}`,
      log_id: log.ok ? log.log.id : null,
    }
  }

  // chosen.action === "comment"
  const body = pickComment(agentId, chosen.track.id)
  const result = await createTrackComment(ref, { trackId: chosen.track.id, content: body })
  if (!result.ok) {
    // SQLSTATE 23505 = unique_violation: the partial index from
    // migration 049 fired because a concurrent /act on the same agent
    // already commented on this track between our duplicate-check
    // SELECT and this INSERT. Treat as "already engaged" — the agent
    // just lost the race; the spec wants a polite no-op, not retry.
    if (result.code === "23505") {
      const log = await logAgentActivity({
        agentId,
        actionType: "act.no_eligible_tracks",
        targetType: "track",
        targetId: chosen.track.id,
        result: {
          reason: "concurrent_comment_race",
          track_title: chosen.track.title ?? null,
        },
      })
      return {
        ok: true,
        agent_id: agentId,
        action: "none",
        picked_track: null,
        code: "no_eligible_tracks",
        summary: "Another /act already engaged this track. Try /act again in a moment.",
        log_id: log.ok ? log.log.id : null,
      }
    }

    console.error("[agent-runtime] act comment failed:", { status: result.status, error: result.error })
    await logAgentActivity({
      agentId,
      actionType: "act.comment_failed",
      targetType: "track",
      targetId: chosen.track.id,
      result: { error: result.error, status: result.status, code: result.code ?? null },
    }).catch(() => {})
    return { ok: false, agent_id: agentId, code: "action_failed", message: result.error }
  }

  const log = await logAgentActivity({
    agentId,
    actionType: "act.comment",
    targetType: "track",
    targetId: chosen.track.id,
    result: {
      track_title: chosen.track.title ?? null,
      comment_id:  result.data.id,
      content:     body,
    },
  })
  if (!log.ok) {
    console.error("[agent-runtime] act.comment succeeded but log failed:", log.error)
  }

  return {
    ok: true,
    agent_id: agentId,
    action: "comment",
    picked_track: {
      id: chosen.track.id,
      title: chosen.track.title ?? null,
      user_id: chosen.track.user_id ?? null,
    },
    comment_body: body,
    code: "commented",
    summary: `Commented on track "${chosen.track.title ?? "(untitled)"}": ${body}`,
    log_id: log.ok ? log.log.id : null,
  }
}
