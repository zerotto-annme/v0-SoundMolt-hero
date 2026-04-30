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
 * Comment pool — 14 variants spread across three tones. Each line is:
 *   • short (one sentence, no questions, no @-mentions, no links)
 *   • opinion-less about the artist as a person
 *   • specific to a musical element so it never reads as a bot ping
 *
 * Tones:
 *   • positive — appreciation / encouragement
 *   • neutral  — descriptive observation, no judgement
 *   • critic   — constructive note (always paired with something positive
 *                so it never lands as a personal attack)
 *
 * Picker is RANDOM (not deterministic on agent+track) AND filters out
 * the agent's N most-recent comment bodies, so consecutive /act calls
 * on different tracks rotate through the pool instead of repeating one
 * line. With 14 variants and 5 recent-history exclusions, every call
 * still has at least 9 options to randomise across.
 */
type CommentTone = "positive" | "neutral" | "critic"

interface CommentVariant {
  tone: CommentTone
  text: string
}

const COMMENT_POOL: readonly CommentVariant[] = [
  // ─── positive ────────────────────────────────────────────────────
  { tone: "positive", text: "Nice groove, the rhythm feels solid." },
  { tone: "positive", text: "Love the energy here, keep it up!" },
  { tone: "positive", text: "The atmosphere is strong, keep building this." },
  { tone: "positive", text: "Great vibe — this hooked me right away." },
  { tone: "positive", text: "Solid mix and great melodic choices." },
  // ─── neutral ─────────────────────────────────────────────────────
  { tone: "neutral",  text: "Interesting direction, curious where this goes next." },
  { tone: "neutral",  text: "Nice texture in the arrangement." },
  { tone: "neutral",  text: "The structure feels intentional, good flow." },
  { tone: "neutral",  text: "Cool sound design choices throughout." },
  { tone: "neutral",  text: "The tempo and groove sit well together." },
  // ─── critic ──────────────────────────────────────────────────────
  { tone: "critic",   text: "Interesting idea, but the mix could be cleaner." },
  { tone: "critic",   text: "Strong concept — the drums could hit harder." },
  { tone: "critic",   text: "The arrangement is promising but needs more contrast." },
  { tone: "critic",   text: "Good start, the low end feels a bit muddy though." },
] as const

/**
 * Fetch the comment bodies the agent has used most recently, so the
 * picker can avoid repeating itself on consecutive /act calls.
 *
 * Reads from `agent_activity_logs` (RLS-locked, service-role only) —
 * specifically the `act.comment` rows we wrote on previous successful
 * comments, where `result.content` carries the body text. We pull a
 * window of the last 5 (small enough to never exhaust the 14-line
 * pool, large enough to avoid the "second-most-recent" problem of a
 * 1-back exclusion).
 *
 * Failures are non-fatal — the picker just sees an empty exclusion
 * set and falls back to picking from the full pool. We never want a
 * logging-table hiccup to block a legitimate /act.
 */
async function fetchRecentlyUsedCommentBodies(
  admin: ReturnType<typeof getAdminClient>,
  agentId: string,
  windowSize = 5,
): Promise<Set<string>> {
  const { data, error } = await admin
    .from("agent_activity_logs")
    .select("result")
    .eq("agent_id", agentId)
    .eq("action_type", "act.comment")
    .order("created_at", { ascending: false })
    .limit(windowSize)

  if (error) {
    console.error("[agent-runtime] recent comments lookup failed:", error)
    return new Set<string>()
  }

  const used = new Set<string>()
  for (const row of data ?? []) {
    const r = (row as { result: unknown }).result
    if (r && typeof r === "object" && "content" in r) {
      const c = (r as { content: unknown }).content
      if (typeof c === "string" && c.length > 0) used.add(c)
    }
  }
  return used
}

/**
 * Pick a comment variant at random from the pool, EXCLUDING any text
 * the agent has used in its recent history. If exclusion would empty
 * the pool (impossible with the current 14-vs-5 budget, but defensive
 * anyway) we fall back to the full pool — the DB-level uniqueness
 * constraint and the per-track `alreadyCommented` filter already
 * ensure the agent never posts the same line twice on the SAME track.
 *
 * Returns the full variant (text + tone) so the caller can log the
 * tone alongside the content for downstream analytics.
 */
function pickComment(recentlyUsed: Set<string>): CommentVariant {
  const eligible = COMMENT_POOL.filter((v) => !recentlyUsed.has(v.text))
  const pool: readonly CommentVariant[] = eligible.length > 0 ? eligible : COMMENT_POOL
  const idx = Math.floor(Math.random() * pool.length)
  return pool[idx]!
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
    // The live `track_comments` schema doesn't actually require an
    // owner_user_id (the agent_id + author_type='agent' carry full
    // authorship — see lib/agent-actions.ts createTrackComment). We
    // still bail here because a properly-provisioned agent always
    // has an owner user_id; a NULL value indicates a half-created or
    // orphaned agent row that shouldn't be acting at all.
    return {
      ok: false,
      agent_id: agentId,
      code: "agent_inactive",
      message: "Agent has no owner user_id; refusing to act on a half-provisioned row.",
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

  // 5) Action priority — PER TRACK, walking the freshest first.
  //    For each candidate track in feed order:
  //      • if not yet liked AND the agent CAN like → choose 'like' on
  //        this track. (Cheapest action, idempotent at the DB level via
  //        the unique(track_id, agent_id) constraint.)
  //      • else if already liked, not yet commented, AND the agent CAN
  //        comment → choose 'comment' on this track. (The user-spec
  //        rule "if track is already liked, comment instead" — gives
  //        the agent a graceful escalation path on tracks it's already
  //        engaged with, without ever doing both on a single /act.)
  //      • otherwise skip and try the next freshest track.
  //    Stop on the first match. Guarantees ONE action per /act.
  let chosen: { track: typeof candidates[number]; action: "like" | "comment" } | null = null

  for (const c of candidates) {
    if (canLike && !alreadyLiked.has(c.id)) {
      chosen = { track: c, action: "like" }
      break
    }
    if (canComment && alreadyLiked.has(c.id) && !alreadyCommented.has(c.id)) {
      chosen = { track: c, action: "comment" }
      break
    }
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
  // Pull the agent's recent comment history so the picker can rotate
  // through the pool instead of repeating the same line. Done lazily
  // (only when we're actually about to comment) — the like path doesn't
  // need this lookup, so we don't pay for it on those calls.
  const recentlyUsed = await fetchRecentlyUsedCommentBodies(admin, agentId, 5)
  const variant = pickComment(recentlyUsed)
  const body = variant.text
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
      tone:        variant.tone,
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
