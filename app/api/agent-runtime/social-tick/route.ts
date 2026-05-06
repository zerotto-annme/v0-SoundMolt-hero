import { NextRequest, NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase-admin"
import { runAgentSocialTick } from "@/lib/agent-runtime"

export const dynamic = "force-dynamic"

/**
 * POST or GET /api/agent-runtime/social-tick
 *
 * Driven by Vercel Cron (`vercel.json` → `*\/10 * * * *`). Performs at
 * most ONE social action (like or fallback comment) per call.
 *
 * Internally delegates to `runAgentSocialTick` in `lib/agent-runtime.ts`,
 * which itself wraps the existing `runAgentAct` (used by Telegram
 * `/act`) — meaning this endpoint never duplicates a like or a comment;
 * the actual DB mutation happens exactly once inside `runAgentAct`.
 *
 * Auth: identical pattern to `/api/agent-runtime/tick` (read-only sibling).
 *   - Header  `x-agent-cron-secret: <AGENT_CRON_SECRET>`
 *   - Header  `Authorization: Bearer <AGENT_CRON_SECRET>` (Vercel Cron)
 *   - Query   `?secret=<AGENT_CRON_SECRET>`                (last-resort)
 *
 * Two invocation modes:
 *   1. Cron / no body — picks one random `status='active'` agent.
 *   2. Manual — POST `{ "agent_id": "<uuid>" }` for a specific agent.
 *
 * Cooldown: `runAgentSocialTick` enforces a 5-minute window across both
 * `act.*` (Telegram /act) and `social_tick.*` action types so the cron
 * and the bot never double-engage on the same minute.
 *
 * Always returns HTTP 200; the body's `action_type` / `reason` tells
 * operators what happened. Outcomes:
 *   - Wrong/missing secret  → { ok: true, skipped: true,
 *                               reason: "invalid_or_missing_secret" }
 *   - No env secret         → { ok: true, skipped: true,
 *                               reason: "secret_not_configured" }
 *   - No active agents      → { ok: true, skipped: true,
 *                               reason: "no_active_agents" }
 *   - Cooldown active       → { ok: true, source: "scheduler",
 *                               agent_id, action_type: "social_tick.skipped",
 *                               reason: "cooldown_active" }
 *   - Liked / commented     → { ok: true, source: "scheduler", agent_id,
 *                               action_type: "social_tick.like"|"social_tick.comment",
 *                               track_id }
 */

interface SocialTickBody {
  agent_id?: string
}

function readSecretCandidates(request: NextRequest): string[] {
  const out: string[] = []
  const x = request.headers.get("x-agent-cron-secret")
  if (x) out.push(x)
  const auth = request.headers.get("authorization")
  if (auth) {
    const m = /^bearer\s+(.+)$/i.exec(auth.trim())
    out.push(m ? m[1].trim() : auth.trim())
  }
  const qs = request.nextUrl.searchParams.get("secret")
  if (qs) out.push(qs)
  return out
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function readAgentId(request: NextRequest): Promise<string | null> {
  if (request.method === "GET") return null
  const ct = request.headers.get("content-type") ?? ""
  if (!ct.includes("application/json")) return null
  try {
    const body = (await request.json()) as SocialTickBody
    const id = (body.agent_id ?? "").trim()
    return id || null
  } catch {
    return null
  }
}

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
    return NextResponse.json({ ok: true, skipped: true, reason: "invalid_or_missing_secret" })
  }

  const explicitId = await readAgentId(request)
  if (explicitId) {
    const result = await runAgentSocialTick(explicitId)
    return NextResponse.json(result)
  }

  const admin = getAdminClient()
  const { data: agents, error: agentsErr } = await admin
    .from("agents")
    .select("id")
    .eq("status", "active")

  if (agentsErr) {
    console.error("[agent-runtime/social-tick] active-agent query failed:", agentsErr)
    return NextResponse.json({ ok: true, skipped: true, reason: "agent_query_failed" })
  }
  if (!agents || agents.length === 0) {
    return NextResponse.json({ ok: true, skipped: true, reason: "no_active_agents" })
  }

  const picked = shuffle([...agents])[0] as { id: string }
  const result = await runAgentSocialTick(picked.id)
  return NextResponse.json(result)
}

export async function POST(request: NextRequest) {
  return handle(request)
}

export async function GET(request: NextRequest) {
  return handle(request)
}
