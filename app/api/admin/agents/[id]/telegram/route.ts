import { NextRequest, NextResponse } from "next/server"
import { randomBytes } from "node:crypto"
import { requireAdmin } from "@/lib/admin-auth"
import {
  telegramGetMe,
  telegramSetWebhook,
  telegramDeleteWebhook,
} from "@/lib/telegram-bot"

export const dynamic = "force-dynamic"

/**
 * Admin-only Telegram bot integration for an agent.
 *
 *   GET    /api/admin/agents/:id/telegram → current connection (or null)
 *   POST   /api/admin/agents/:id/telegram → connect / replace bot token
 *   PATCH  /api/admin/agents/:id/telegram → toggle `is_active` for the bot
 *   DELETE /api/admin/agents/:id/telegram → disconnect
 *
 * All endpoints are gated by requireAdmin() — never reachable from a
 * non-admin browser session. The telegram_bot_token is NEVER returned to
 * the client; only its existence (`has_token: true`) is surfaced.
 *
 * Schema: see migrations/046_agent_telegram_bots_v2.sql. If the table
 * does not exist yet (migration not applied to this Supabase project),
 * every endpoint returns a clean 503 with a helpful operator message
 * rather than crashing.
 */

const TABLE = "agent_telegram_bots" as const

/** Postgres "relation does not exist" error code. */
const PG_TABLE_MISSING = "42P01"

/** Columns we always want back from a SELECT — never includes the token. */
const PUBLIC_COLUMNS =
  "id, agent_id, telegram_bot_id, telegram_bot_username, webhook_status, is_active, created_at, updated_at" as const

function tableMissingResponse() {
  return NextResponse.json(
    {
      error: "telegram_table_missing",
      message:
        "The agent_telegram_bots table does not exist yet. Apply migrations/046_agent_telegram_bots_v2.sql in the Supabase SQL Editor.",
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
  id: string
  agent_id: string
  telegram_bot_id: number | null
  telegram_bot_username: string | null
  webhook_status: string
  is_active: boolean
  has_token: true
  created_at: string
  updated_at: string
}

function toPublic(row: any): PublicConnection {
  return {
    id: row.id,
    agent_id: row.agent_id,
    telegram_bot_id: row.telegram_bot_id ?? null,
    telegram_bot_username: row.telegram_bot_username ?? null,
    webhook_status: row.webhook_status ?? "pending",
    is_active: row.is_active ?? true,
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
    .select(PUBLIC_COLUMNS)
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
  // We preserve the existing `is_active` flag (so a deactivated bot stays
  // deactivated when its token is replaced); webhook_status resets to
  // 'pending' because rotating the token invalidates any prior webhook.
  //
  // CONCURRENCY CAVEAT: this is read-then-upsert, so a PATCH that toggles
  // `is_active` between this SELECT and the UPSERT below would be lost.
  // Acceptable for now — the entire surface is admin-only (effectively
  // single-writer) and the UI never fires both at once. If a future
  // multi-admin workflow needs a stronger guarantee, move this into a
  // single-statement Postgres function (RPC) that does the UPSERT with
  // `COALESCE((SELECT is_active …), TRUE)` in one shot.
  const { data: existing } = await admin
    .from(TABLE)
    .select("is_active")
    .eq("agent_id", id)
    .maybeSingle()

  // Generate a fresh random secret for THIS connection. We send it to
  // Telegram as `secret_token`; Telegram echoes it back in the
  // X-Telegram-Bot-Api-Secret-Token header on every update, and the
  // public webhook handler uses it as both the routing key (which agent)
  // AND a shared secret (proof the request really came from Telegram).
  // 32 random bytes → 64 hex chars, well under Telegram's 256-char limit
  // and inside its allowed [A-Za-z0-9_-] charset.
  //
  // Rotated on every connect/replace — there's no need to preserve the
  // old secret, and rotating it cleanly invalidates any forged requests
  // an attacker might have built up against the previous value.
  const webhookSecret = randomBytes(32).toString("hex")

  const upsertPayload = {
    agent_id: id,
    telegram_bot_token: token,
    telegram_bot_username: me.result.username ?? null,
    telegram_bot_id: me.result.id,
    webhook_status: "pending",
    webhook_secret: webhookSecret,
    is_active: existing?.is_active ?? true,
  }

  const { data, error } = await admin
    .from(TABLE)
    .upsert(upsertPayload, { onConflict: "agent_id" })
    .select(PUBLIC_COLUMNS)
    .single()

  if (error) {
    if (error.code === PG_TABLE_MISSING) return tableMissingResponse()
    console.error("[admin/agents/:id/telegram POST] upsert failed:", error)
    return NextResponse.json(
      { error: error.message, error_code: error.code },
      { status: 500 },
    )
  }

  // ── Register the Telegram webhook for this bot. ────────────────────────
  // The webhook URL is the SAME path for every connected bot — we route
  // updates to the right agent at delivery time using Telegram's
  // `secret_token` mechanism (it gets echoed back to us as the
  // X-Telegram-Bot-Api-Secret-Token header). We pass the random
  // `webhookSecret` we just generated: it doubles as the routing key
  // (look up the bot row by `webhook_secret = <header>`) AND a shared
  // secret that proves the request really came from Telegram. Critical:
  // we deliberately do NOT use agent_id here — agent ids are listed
  // publicly via GET /api/agents, so anyone could forge updates against
  // /api/integrations/telegram/webhook by guessing a UUID.
  //
  // We DO NOT fail the connect if setWebhook errors — the bot row is
  // already saved, the admin UI will show webhook_status='failed', and
  // the user can retry without losing their token. Telegram's most
  // common reasons for setWebhook failures are non-HTTPS URLs and
  // unreachable hosts — both of which are environment issues, not user
  // input issues.
  const webhookUrl = `${request.nextUrl.origin}/api/integrations/telegram/webhook`
  const setRes = await telegramSetWebhook(token, webhookUrl, webhookSecret)
  const newStatus = setRes.ok ? "active" : "failed"
  if (!setRes.ok) {
    console.warn("[admin/agents/:id/telegram POST] setWebhook failed", {
      agent_id: id,
      url: webhookUrl,
      description: setRes.description,
      error_code: setRes.error_code,
    })
  }

  // Persist the resolved status. If this UPDATE itself fails we still
  // return the row from the previous upsert — webhook_status will just
  // show as 'pending' and the admin can retry.
  const { data: updated } = await admin
    .from(TABLE)
    .update({ webhook_status: newStatus })
    .eq("agent_id", id)
    .select(PUBLIC_COLUMNS)
    .maybeSingle()

  return NextResponse.json({ connection: toPublic(updated ?? data) })
}

// ── PATCH (toggle is_active or update webhook_status) ────────────────────────
//
// The previous schema stored `admin_chat_id` and PATCH was used to write
// it. The v2 schema drops that column entirely (test messages now take
// chat_id as a one-shot POST body — see /test route), so PATCH is now
// repurposed for the two genuinely mutable fields on this row:
//   - `is_active`        (boolean) — admin can disable a bot without
//                                    deleting the row + token.
//   - `webhook_status`   (string)  — for future webhook plumbing.
//
// Either or both may be sent in a single PATCH; sending neither is a 400.

interface PatchBody {
  is_active?: boolean | null
  webhook_status?: string | null
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

  const update: Record<string, unknown> = {}
  if ("is_active" in body) {
    if (typeof body.is_active !== "boolean") {
      return NextResponse.json(
        { error: "is_active must be a boolean" },
        { status: 400 },
      )
    }
    update.is_active = body.is_active
  }
  if ("webhook_status" in body) {
    if (body.webhook_status !== null && typeof body.webhook_status !== "string") {
      return NextResponse.json(
        { error: "webhook_status must be a string or null" },
        { status: 400 },
      )
    }
    update.webhook_status = body.webhook_status ?? "pending"
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { error: "PATCH body must include is_active and/or webhook_status" },
      { status: 400 },
    )
  }

  const { data, error } = await admin
    .from(TABLE)
    .update(update)
    .eq("agent_id", id)
    .select(PUBLIC_COLUMNS)
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

  // Best-effort: tear down the Telegram-side webhook before we drop our
  // row, so Telegram stops trying to deliver updates to a bot we no
  // longer know about. We need the token for this — fetch it first.
  // Failure here is non-fatal: even if Telegram refuses, the local row
  // delete must still proceed (the operator's intent was "disconnect").
  const { data: existing } = await admin
    .from(TABLE)
    .select("telegram_bot_token")
    .eq("agent_id", id)
    .maybeSingle()
  if (existing?.telegram_bot_token) {
    const del = await telegramDeleteWebhook(existing.telegram_bot_token)
    if (!del.ok) {
      console.warn("[admin/agents/:id/telegram DELETE] deleteWebhook failed", {
        agent_id: id,
        description: del.description,
        error_code: del.error_code,
      })
    }
  }

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
