import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/admin-auth"
import { telegramGetMe } from "@/lib/telegram-bot"

export const dynamic = "force-dynamic"

/**
 * Admin-only Telegram bot integration for an agent.
 *
 *   GET    /api/admin/agents/:id/telegram → current connection (or null)
 *   POST   /api/admin/agents/:id/telegram → connect / replace bot token
 *   PATCH  /api/admin/agents/:id/telegram → update admin_chat_id
 *   DELETE /api/admin/agents/:id/telegram → disconnect
 *
 * All endpoints are gated by requireAdmin() — never reachable from a
 * non-admin browser session. The bot_token is NEVER returned to the
 * client; only its existence (`has_token: true`) is surfaced.
 *
 * Schema: see migrations/045_agent_telegram_bots.sql. If the table does
 * not exist yet (migration not applied to this Supabase project), every
 * endpoint returns a clean 503 with a helpful operator message rather
 * than crashing.
 */

const TABLE = "agent_telegram_bots" as const

/** Postgres "relation does not exist" error code. */
const PG_TABLE_MISSING = "42P01"

function tableMissingResponse() {
  return NextResponse.json(
    {
      error: "telegram_table_missing",
      message:
        "The agent_telegram_bots table does not exist yet. Apply migrations/045_agent_telegram_bots.sql in the Supabase SQL Editor.",
    },
    { status: 503 },
  )
}

/**
 * Shape of the public (admin-UI) representation of a connection. The
 * bot token itself is intentionally NOT included — the UI only needs to
 * know whether one is set so it can render the right action button.
 */
type PublicConnection = {
  agent_id: string
  bot_username: string | null
  bot_id: number | null
  admin_chat_id: number | null
  has_token: true
  created_at: string
  updated_at: string
}

function toPublic(row: any): PublicConnection {
  return {
    agent_id: row.agent_id,
    bot_username: row.bot_username ?? null,
    bot_id: row.bot_id ?? null,
    admin_chat_id: row.admin_chat_id ?? null,
    has_token: true,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin(request)
  if (!auth.ok) return auth.response
  const { admin } = auth

  const { id } = await context.params
  if (!id) return NextResponse.json({ error: "Missing agent id" }, { status: 400 })

  const { data, error } = await admin
    .from(TABLE)
    .select("agent_id, bot_username, bot_id, admin_chat_id, created_at, updated_at")
    .eq("agent_id", id)
    .maybeSingle()

  if (error) {
    if (error.code === PG_TABLE_MISSING) return tableMissingResponse()
    console.error("[admin/agents/:id/telegram GET] supabase error:", error)
    return NextResponse.json(
      { error: error.message, error_code: error.code },
      { status: 500 },
    )
  }

  return NextResponse.json({ connection: data ? toPublic(data) : null })
}

// ── POST (connect / replace) ─────────────────────────────────────────────────

interface PostBody {
  bot_token?: string
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin(request)
  if (!auth.ok) return auth.response
  const { admin } = auth

  const { id } = await context.params
  if (!id) return NextResponse.json({ error: "Missing agent id" }, { status: 400 })

  let body: PostBody = {}
  try {
    body = (await request.json()) as PostBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const token = (body.bot_token ?? "").trim()
  if (!token) {
    return NextResponse.json({ error: "bot_token is required" }, { status: 400 })
  }

  // Verify the token by calling Telegram getMe before storing it. This
  // catches typos, revoked tokens, and the "wrong format" case up front
  // so the admin gets a clear error instead of a silent broken bot.
  const me = await telegramGetMe(token)
  if (!me.ok) {
    return NextResponse.json(
      {
        error: "telegram_get_me_failed",
        message: me.description,
      },
      { status: 400 },
    )
  }

  // Verify the agent actually exists before we insert (FK would fail
  // anyway, but a clean 404 is friendlier).
  const { data: agentRow, error: agentErr } = await admin
    .from("agents")
    .select("id")
    .eq("id", id)
    .maybeSingle()
  if (agentErr) {
    console.error("[admin/agents/:id/telegram POST] agents lookup failed:", agentErr)
    return NextResponse.json(
      { error: agentErr.message, error_code: agentErr.code },
      { status: 500 },
    )
  }
  if (!agentRow) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 })
  }

  // UPSERT — re-running connect with a different token replaces the row.
  // We preserve admin_chat_id if one is already set (so reconnecting
  // with a new token doesn't lose the test target).
  const { data: existing } = await admin
    .from(TABLE)
    .select("admin_chat_id")
    .eq("agent_id", id)
    .maybeSingle()

  const upsertPayload = {
    agent_id: id,
    bot_token: token,
    bot_username: me.result.username ?? null,
    bot_id: me.result.id,
    admin_chat_id: existing?.admin_chat_id ?? null,
  }

  const { data, error } = await admin
    .from(TABLE)
    .upsert(upsertPayload, { onConflict: "agent_id" })
    .select("agent_id, bot_username, bot_id, admin_chat_id, created_at, updated_at")
    .single()

  if (error) {
    if (error.code === PG_TABLE_MISSING) return tableMissingResponse()
    console.error("[admin/agents/:id/telegram POST] upsert failed:", error)
    return NextResponse.json(
      { error: error.message, error_code: error.code },
      { status: 500 },
    )
  }

  return NextResponse.json({ connection: toPublic(data) })
}

// ── PATCH (update admin_chat_id) ─────────────────────────────────────────────

interface PatchBody {
  /**
   * Numeric Telegram chat id (positive for DMs, negative for groups).
   * Pass null to clear.
   */
  admin_chat_id?: number | string | null
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin(request)
  if (!auth.ok) return auth.response
  const { admin } = auth

  const { id } = await context.params
  if (!id) return NextResponse.json({ error: "Missing agent id" }, { status: 400 })

  let body: PatchBody = {}
  try {
    body = (await request.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (!("admin_chat_id" in body)) {
    return NextResponse.json(
      { error: "admin_chat_id is required (number or null)" },
      { status: 400 },
    )
  }

  let chatId: number | null = null
  if (body.admin_chat_id === null || body.admin_chat_id === "") {
    chatId = null
  } else {
    const n = typeof body.admin_chat_id === "number"
      ? body.admin_chat_id
      : Number(String(body.admin_chat_id).trim())
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      return NextResponse.json(
        { error: "admin_chat_id must be an integer or null" },
        { status: 400 },
      )
    }
    chatId = n
  }

  const { data, error } = await admin
    .from(TABLE)
    .update({ admin_chat_id: chatId })
    .eq("agent_id", id)
    .select("agent_id, bot_username, bot_id, admin_chat_id, created_at, updated_at")
    .maybeSingle()

  if (error) {
    if (error.code === PG_TABLE_MISSING) return tableMissingResponse()
    console.error("[admin/agents/:id/telegram PATCH] update failed:", error)
    return NextResponse.json(
      { error: error.message, error_code: error.code },
      { status: 500 },
    )
  }
  if (!data) {
    return NextResponse.json(
      { error: "telegram_not_connected", message: "Connect a bot first." },
      { status: 404 },
    )
  }

  return NextResponse.json({ connection: toPublic(data) })
}

// ── DELETE (disconnect) ──────────────────────────────────────────────────────

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin(request)
  if (!auth.ok) return auth.response
  const { admin } = auth

  const { id } = await context.params
  if (!id) return NextResponse.json({ error: "Missing agent id" }, { status: 400 })

  const { error } = await admin.from(TABLE).delete().eq("agent_id", id)
  if (error) {
    if (error.code === PG_TABLE_MISSING) return tableMissingResponse()
    console.error("[admin/agents/:id/telegram DELETE] delete failed:", error)
    return NextResponse.json(
      { error: error.message, error_code: error.code },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true })
}
