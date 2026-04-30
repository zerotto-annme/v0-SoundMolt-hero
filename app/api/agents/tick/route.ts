import { NextRequest, NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase-admin"
import { runAgentAct, type AgentActResult } from "@/lib/agent-runtime"

export const dynamic = "force-dynamic"

/**
 * POST or GET /api/agents/tick
 *
 * Autonomous-agent scheduler endpoint.
 *
 * One tick = at most ONE social action by ONE agent.
 *
 * Auth — accepted via ANY of (first match wins):
 *   - Header  `x-agent-cron-secret: <AGENT_CRON_SECRET>`  (manual ops)
 *   - Header  `Authorization: Bearer <AGENT_CRON_SECRET>` (Vercel Cron native:
 *             it auto-sends the value of `process.env.CRON_SECRET` here. To
 *             use it, set Vercel env `CRON_SECRET` to the same value as
 *             `AGENT_CRON_SECRET`.)
 *   - Query   `?secret=<AGENT_CRON_SECRET>`               (last-resort
 *             fallback for callers that cannot set headers; avoid this in
 *             production because URL query strings can leak through proxy
 *             access logs.)
 *
 * Both GET and POST share the same handler. Vercel Cron sends GET.
 *
 * Outcome contract — ALWAYS HTTP 200, body shape varies:
 *   - Wrong/missing secret           → { ok: true, skipped: true }
 *     (We deliberately do not 401: leaking "endpoint exists" to random
 *     scanners is worse than silently dropping their request. Cron
 *     misconfiguration is visible in operator logs, not via HTTP status.)
 *   - Server has no AGENT_CRON_SECRET configured at all
 *                                    → { ok: true, skipped: true,
 *                                        reason: "secret_not_configured" }
 *   - No active agents with social capability
 *                                    → { ok: true, skipped: true,
 *                                        reason: "no_active_agents" }
 *   - Every active agent acted within the last 5 minutes
 *                                    → { ok: true, skipped: true,
 *                                        reason: "all_agents_on_cooldown" }
 *   - One agent picked & runAgentAct invoked
 *                                    → { ok: true, agent_id, action,
 *                                        summary, result }
 *
 * Cooldown semantics:
 *   We treat ONLY the two outcome rows that represent a real social
 *   write — `act.like` and `act.comment` — as "the agent recently
 *   acted". No-op outcomes (`act.no_eligible_tracks`,
 *   `act.feed_empty`, `act.no_capability`) and *_failed rows do not
 *   count toward the cooldown — those should not lock an agent out
 *   of being tried again 5 minutes later.
 *
 * Telegram /act path is unaffected: it calls runAgentAct() directly
 * via the lib import and never touches this route.
 */

const COOLDOWN_MINUTES = 5
const COOLDOWN_ACTION_TYPES = ["act.like", "act.comment"] as const
const REQUIRED_CAPS = ["social_write", "like", "comment"] as const

interface SkippedResponse {
  ok: true
  skipped: true
  reason?: string
}

interface PickedResponse {
  ok: true
  agent_id: string
  action: string
  summary: string
  result: AgentActResult & { source: "scheduler" }
}

type TickResponse = SkippedResponse | PickedResponse

/** Collect every candidate secret from the request — header(s) + query. */
function readSecretCandidates(request: NextRequest): string[] {
  const out: string[] = []
  const x = request.headers.get("x-agent-cron-secret")
  if (x) out.push(x)
  const auth = request.headers.get("authorization")
  if (auth) {
    // Tolerate "Bearer <token>" and bare "<token>" forms; case-insensitive scheme.
    const m = /^bearer\s+(.+)$/i.exec(auth.trim())
    out.push(m ? m[1].trim() : auth.trim())
  }
  const qs = request.nextUrl.searchParams.get("secret")
  if (qs) out.push(qs)
  return out
}

/** Constant-time comparison (length-safe) so an attacker can't byte-by-byte time us. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Fisher–Yates shuffle (in-place). */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

async function handle(request: NextRequest): Promise<NextResponse<TickResponse>> {
  const expected = process.env.AGENT_CRON_SECRET
  if (!expected) {
    // Don't 500 on misconfig — return the same shape so the cron job
    // doesn't trip Vercel's failure alerts; the reason field tells
    // operators what's wrong when they actually look.
    return NextResponse.json({ ok: true, skipped: true, reason: "secret_not_configured" })
  }
  const candidates = readSecretCandidates(request)
  const ok = candidates.some((c) => safeEqual(c, expected))
  if (!ok) {
    return NextResponse.json({ ok: true, skipped: true })
  }

  const admin = getAdminClient()

  // 1) Pull every active agent and filter capability in JS.
  //    `agents.capabilities` is stored as JSONB (not text[]) in this prod
  //    schema, so we can't use Postgres `&&` (overlaps) — it's an array-
  //    only operator that errors with `operator does not exist: jsonb &&`.
  //    JSONB-side containment checks are clumsy (`?|`-style operators are
  //    not exposed by supabase-js with multiple values), and the active-
  //    agent set is small enough that a JS filter is both simpler and
  //    safe at this scale.
  const { data: agentsRaw, error: agentsErr } = await admin
    .from("agents")
    .select("id, name, capabilities")
    .eq("status", "active")

  if (agentsErr) {
    console.error("[agents/tick] active-agent query failed:", agentsErr)
    return NextResponse.json({ ok: true, skipped: true, reason: "agent_query_failed" })
  }

  type AgentRow = { id: string; name: string | null; capabilities: unknown }
  const agents = ((agentsRaw ?? []) as AgentRow[]).filter((a) => {
    // Defensive parse: capabilities can come back as an array, a JSON-
    // stringified array, or NULL depending on how the row was written.
    let caps: unknown = a.capabilities
    if (typeof caps === "string") {
      try { caps = JSON.parse(caps) } catch { caps = [] }
    }
    if (!Array.isArray(caps)) return false
    return caps.some((c) => typeof c === "string" && (REQUIRED_CAPS as readonly string[]).includes(c))
  })

  if (agents.length === 0) {
    return NextResponse.json({ ok: true, skipped: true, reason: "no_active_agents" })
  }

  // 2) Try agents in random order. Stop at the first one whose recent
  //    activity log shows no act.like/act.comment within COOLDOWN_MINUTES.
  const shuffled = shuffle([...agents])
  const cutoffIso = new Date(Date.now() - COOLDOWN_MINUTES * 60_000).toISOString()

  let picked: { id: string; name: string | null } | null = null
  for (const a of shuffled) {
    const { data: recent, error: recentErr } = await admin
      .from("agent_activity_logs")
      .select("id")
      .eq("agent_id", a.id)
      .in("action_type", COOLDOWN_ACTION_TYPES as unknown as string[])
      .gte("created_at", cutoffIso)
      .limit(1)
      .maybeSingle()

    if (recentErr) {
      // Per-agent cooldown probe failed (transient) — skip this one and
      // try the next. Don't fail the whole tick.
      console.warn(`[agents/tick] cooldown probe failed for agent ${a.id}:`, recentErr)
      continue
    }
    if (recent) {
      // On cooldown — try the next agent.
      continue
    }

    picked = { id: a.id, name: (a as { name: string | null }).name ?? null }
    break
  }

  if (!picked) {
    return NextResponse.json({ ok: true, skipped: true, reason: "all_agents_on_cooldown" })
  }

  // 3) Run exactly one act for the picked agent. runAgentAct itself:
  //    - performs at most one of like|comment|none,
  //    - writes the matching agent_activity_logs row (act.like / act.comment / act.no_op…),
  //    - never throws — error states come back in the result object.
  const result = await runAgentAct(picked.id)

  const action = result.ok ? result.action : "none"
  const summary = result.ok
    ? result.summary
    : `agent ${picked.name ?? picked.id} could not act: ${result.code}`

  return NextResponse.json({
    ok: true,
    agent_id: picked.id,
    action,
    summary,
    result: { ...result, source: "scheduler" },
  })
}

export async function POST(request: NextRequest) {
  return handle(request)
}

export async function GET(request: NextRequest) {
  return handle(request)
}
