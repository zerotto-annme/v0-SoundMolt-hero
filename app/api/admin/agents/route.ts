import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/admin-auth"

export const dynamic = "force-dynamic"

/**
 * GET /api/admin/agents
 *
 * Lists every agent with: name, status, owner email, capabilities,
 * connection state, and last activity timestamp.
 *
 * NOTE on schema: the live Supabase `agents` table does NOT have
 * `provider`, `model_name`, or `api_endpoint` columns (those exist only
 * in the original migration file 015 but were never applied to the live DB).
 * We only select columns that actually exist in production.
 *
 * On any error, returns HTTP 200 with `agents: []` plus an `error` field
 * (so the admin UI never breaks just because this query fails).
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (!auth.ok) return auth.response
  const { admin } = auth

  const { data: agents, error } = await admin
    .from("agents")
    .select(
      "id, user_id, name, status, capabilities, connection_code, connected_at, last_active_at, created_at, updated_at, avatar_url, cover_url, description, genre",
    )
    .order("created_at", { ascending: false })

  if (error) {
    console.error("[admin/agents GET] supabase select failed:", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    })
    return NextResponse.json(
      {
        agents: [],
        error: error.message,
        error_code: error.code,
      },
      { status: 200 },
    )
  }

  // Resolve owner emails (parallel).
  const userIds = Array.from(
    new Set((agents ?? []).map((a) => a.user_id).filter(Boolean)),
  )
  const emailByUserId = new Map<string, string | null>()
  await Promise.all(
    userIds.map(async (uid) => {
      try {
        const { data, error: e } = await admin.auth.admin.getUserById(uid)
        if (!e && data?.user) emailByUserId.set(uid, data.user.email ?? null)
      } catch (e) {
        console.warn("[admin/agents GET] getUserById failed for", uid, e)
      }
    }),
  )

  // Telegram-bot connections (1:1 per agent). Optional: if migration 045
  // hasn't been applied yet to this Supabase project, the table won't
  // exist (Postgres 42P01) — that's not fatal here; we just render every
  // agent as "Not connected" until the operator runs the migration.
  const agentIds = (agents ?? []).map((a) => a.id)
  // Sentinel semantics:
  //   - Map has no entry        → not connected (UI shows "Not connected").
  //   - Map value === ""        → connected, but bot has no public username.
  //   - Map value === "foo"     → connected; UI renders "@foo".
  // We must never collapse the "" case down to null, otherwise the UI's
  // null-vs-string check would render a real connection as "Not connected".
  const telegramByAgent = new Map<string, string>()
  if (agentIds.length > 0) {
    const { data: telegrams, error: telegramErr } = await admin
      .from("agent_telegram_bots")
      .select("agent_id, bot_username")
      .in("agent_id", agentIds)
    if (telegramErr) {
      if (telegramErr.code !== "42P01") {
        console.warn("[admin/agents GET] telegram lookup failed:", {
          code: telegramErr.code,
          message: telegramErr.message,
        })
      }
    } else {
      for (const t of telegrams ?? []) {
        telegramByAgent.set(t.agent_id, t.bot_username ?? "")
      }
    }
  }

  const result = (agents ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    user_id: a.user_id,
    owner_email: emailByUserId.get(a.user_id) ?? null,
    status: a.status ?? "active",
    capabilities: Array.isArray(a.capabilities) ? a.capabilities : [],
    connection_code: a.connection_code ?? null,
    connected_at: a.connected_at ?? null,
    last_active_at: a.last_active_at ?? a.created_at,
    created_at: a.created_at,
    updated_at: a.updated_at ?? null,
    avatar_url: a.avatar_url ?? null,
    cover_url: a.cover_url ?? null,
    description: a.description ?? null,
    genre: a.genre ?? null,
    // Connected: bot_username (with leading "@" added in UI). Not
    // connected: explicit null. Connected-but-no-username (rare —
    // bot owner hid username) → empty string. Distinguishing "" from
    // null is what lets the admin UI flip the action button to
    // "Telegram Settings" even when the bot has no public username.
    telegram_bot_username: telegramByAgent.has(a.id)
      ? telegramByAgent.get(a.id) ?? ""
      : null,
  }))

  return NextResponse.json({ agents: result })
}
