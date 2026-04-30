import { NextRequest, NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase-admin"
import { runAgentTick } from "@/lib/agent-runtime"

export const dynamic = "force-dynamic"

/**
 * POST or GET /api/agent-runtime/tick
 *
 * Driven by Vercel Cron (`vercel.json` → `*\/5 * * * *`). Runs ONE
 * runtime tick per call.
 *
 * What "tick" means here is defined by `runAgentTick` in
 * `lib/agent-runtime.ts`. As of writing, it is the **read-only safety
 * tick**: it inspects the feed for the agent and writes either
 * `tick.feed_check` or `tick.skipped_no_feed` to `agent_activity_logs`.
 * It does not like, comment, publish, or otherwise mutate other users'
 * state — by design. This route never adds extra side effects on top
 * of what `runAgentTick` already does.
 *
 * Two invocation modes (both authenticated identically):
 *
 *   1. Cron / no body — picks one random `status='active'` agent and
 *      ticks it. Used by Vercel Cron, which cannot send a body.
 *   2. Manual ops — POST `{ "agent_id": "<uuid>" }` and tick that
 *      specific agent. Used for ad-hoc operator runs.
 *
 * Auth — accepted via ANY of (constant-time compare):
 *   - Header  `x-agent-cron-secret: <AGENT_CRON_SECRET>`     (manual ops)
 *   - Header  `Authorization: Bearer <AGENT_CRON_SECRET>`    (Vercel Cron
 *             native: it auto-sends `process.env.CRON_SECRET` here. To
 *             use it, set `CRON_SECRET` in Vercel to the same value as
 *             `AGENT_CRON_SECRET`.)
 *   - Query   `?secret=<AGENT_CRON_SECRET>`                  (last-resort
 *             fallback; query strings can leak through proxy access logs.)
 *
 * Always returns HTTP 200; the body's `ok` / `skipped` / `reason` fields
 * tell operators what happened. That keeps Vercel Cron failure alerts
 * from firing on routine no-ops (no active agents, no feed, etc.).
 *
 * Outcomes:
 *   - Wrong/missing secret → { ok: true, skipped: true }
 *   - No `AGENT_CRON_SECRET` env       → { ok: true, skipped: true,
 *                                          reason: "secret_not_configured" }
 *   - Cron mode, no active agents      → { ok: true, skipped: true,
 *                                          reason: "no_active_agents" }
 *   - Cron mode, agent picked + ticked → { ok, agent_id, action_type,
 *                                          picked_track, summary, log_id,
 *                                          source: "scheduler" }
 *   - Manual mode missing agent_id     → still 200, body is the same
 *                                          shape `runAgentTick` returns
 *                                          for `agent_not_found`.
 */

interface TickBody {
  agent_id?: string
}

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

/** Constant-time comparison so an attacker can't byte-by-byte time us. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Best-effort body parse: `runAgentTick` accepts an explicit agent_id. */
async function readAgentId(request: NextRequest): Promise<string | null> {
  // GET / no-body cron calls are normal — don't even try to parse JSON.
  if (request.method === "GET") return null
  const ct = request.headers.get("content-type") ?? ""
  if (!ct.includes("application/json")) return null
  try {
    const body = (await request.json()) as TickBody
    const id = (body.agent_id ?? "").trim()
    return id || null
  } catch {
    return null
  }
}

/** Fisher–Yates shuffle (in place). */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

async function handle(request: NextRequest): Promise<NextResponse> {
  const expected = process.env.AGENT_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ ok: true, skipped: true, reason: "secret_not_configured" })
  }
  const candidates = readSecretCandidates(request)
  const ok = candidates.some((c) => safeEqual(c, expected))
  if (!ok) {
    return NextResponse.json({ ok: true, skipped: true })
  }

  // Manual targeting wins when an agent_id is provided.
  const explicitId = await readAgentId(request)
  if (explicitId) {
    const result = await runAgentTick(explicitId)
    return NextResponse.json({ ...result, source: "scheduler" })
  }

  // Cron / no-body path — pick one random active agent.
  const admin = getAdminClient()
  const { data: agents, error: agentsErr } = await admin
    .from("agents")
    .select("id, name")
    .eq("status", "active")

  if (agentsErr) {
    console.error("[agent-runtime/tick] active-agent query failed:", agentsErr)
    return NextResponse.json({ ok: true, skipped: true, reason: "agent_query_failed" })
  }
  if (!agents || agents.length === 0) {
    return NextResponse.json({ ok: true, skipped: true, reason: "no_active_agents" })
  }

  const picked = shuffle([...agents])[0] as { id: string; name: string | null }
  const result = await runAgentTick(picked.id)
  return NextResponse.json({ ...result, source: "scheduler" })
}

export async function POST(request: NextRequest) {
  return handle(request)
}

export async function GET(request: NextRequest) {
  return handle(request)
}
