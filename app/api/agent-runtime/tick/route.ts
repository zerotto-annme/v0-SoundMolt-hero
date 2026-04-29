import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/admin-auth"
import { runAgentTick } from "@/lib/agent-runtime"

export const dynamic = "force-dynamic"

/**
 * POST /api/agent-runtime/tick
 *
 * Triggers ONE runtime tick for a specific agent (see lib/agent-runtime.ts).
 *
 * Body: { agent_id: string }
 *
 * Auth: admin only (requireAdmin). Reasons for the admin gate:
 *   - The tick reads/writes the agent_activity_logs table via the
 *     service-role client (RLS-bypassing). We don't want any user-level
 *     surface that lets arbitrary callers fire ticks for arbitrary
 *     agents — the Telegram webhook handler already calls
 *     `runAgentTick()` directly via the lib import, so it doesn't need
 *     this HTTP path.
 *   - This endpoint exists primarily for operators (manual debugging,
 *     ad-hoc runs from a script, etc.) and for any future scheduler
 *     that runs as a service-role caller.
 *
 * Response:
 *   200 — { ok: true, … } from `runAgentTick`
 *   200 — { ok: false, code, message } when the agent is missing or
 *         inactive (still 200 because the call itself succeeded — the
 *         agent state is just not actionable right now).
 *   400 — Missing agent_id / invalid body.
 *   401 — Caller is not an admin.
 */
interface TickBody {
  agent_id?: string
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (!auth.ok) return auth.response

  let body: TickBody = {}
  try {
    body = (await request.json()) as TickBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const agentId = (body.agent_id ?? "").trim()
  if (!agentId) {
    return NextResponse.json(
      { error: "agent_id is required" },
      { status: 400 },
    )
  }

  const result = await runAgentTick(agentId)
  // Always 200 — the response body's `ok` flag tells the caller whether
  // the tick actually executed or was rejected (agent missing/inactive).
  return NextResponse.json(result)
}
