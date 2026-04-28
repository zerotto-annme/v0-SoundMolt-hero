import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/admin-auth"
import { telegramSendMessage } from "@/lib/telegram-bot"

export const dynamic = "force-dynamic"

/**
 * POST /api/admin/agents/:id/telegram/test
 *
 * Sends a one-line "test message" via the agent's connected bot to a
 * chat id supplied by the admin in the request body.
 *
 * Why the chat id is a request-time parameter (not stored on the row):
 * the v2 schema introduced in migrations/046_agent_telegram_bots_v2.sql
 * intentionally drops the `admin_chat_id` column. Each test send picks
 * its own destination chat id — admin types (or pastes) it in the
 * Settings modal at the moment of clicking "Test Telegram".
 *
 * Body:
 *   { chat_id: number | string }   // integer or string-encoded integer
 *
 * Pre-conditions (all returned as clean 4xx with descriptive copy):
 *   - Bot must be connected (row exists in agent_telegram_bots).
 *   - The connection must have a stored telegram_bot_token.
 *   - chat_id must be a valid integer.
 *
 * The telegram_bot_token is read server-side and never returned to the
 * caller.
 */

interface TestBody {
  chat_id?: number | string | null
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

  // Parse & validate chat_id from the request body.
  let body: TestBody = {}
  try {
    body = (await request.json()) as TestBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  if (body.chat_id === undefined || body.chat_id === null || body.chat_id === "") {
    return NextResponse.json(
      {
        error: "chat_id_required",
        message: "Provide a Telegram chat_id (integer) to send the test message to.",
      },
      { status: 400 },
    )
  }
  const rawChatId =
    typeof body.chat_id === "number" ? body.chat_id : Number(String(body.chat_id).trim())
  if (!Number.isFinite(rawChatId) || !Number.isInteger(rawChatId)) {
    return NextResponse.json(
      { error: "chat_id_invalid", message: "chat_id must be an integer." },
      { status: 400 },
    )
  }

  // Read the bot token + username for this agent (admin-only).
  const { data, error } = await admin
    .from("agent_telegram_bots")
    .select("telegram_bot_token, telegram_bot_username, is_active")
    .eq("agent_id", id)
    .maybeSingle()

  if (error) {
    if (error.code === "42P01") {
      return NextResponse.json(
        {
          error: "telegram_table_missing",
          message:
            "The agent_telegram_bots table does not exist yet. Apply migrations/046_agent_telegram_bots_v2.sql in the Supabase SQL Editor.",
        },
        { status: 503 },
      )
    }
    console.error("[admin/agents/:id/telegram/test POST] lookup failed:", error)
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
  if (!data.telegram_bot_token) {
    return NextResponse.json(
      { error: "telegram_no_token", message: "Bot token is missing for this agent." },
      { status: 400 },
    )
  }
  if (data.is_active === false) {
    return NextResponse.json(
      {
        error: "telegram_inactive",
        message: "Bot is currently disabled. Re-enable it in Telegram Settings before testing.",
      },
      { status: 400 },
    )
  }

  const text = `Test message from @${data.telegram_bot_username ?? "bot"} — your SoundMolt admin connection is working.`
  const send = await telegramSendMessage(data.telegram_bot_token, rawChatId, text)

  if (!send.ok) {
    return NextResponse.json(
      {
        error: "telegram_send_failed",
        message: send.description,
      },
      { status: 502 },
    )
  }

  return NextResponse.json({ ok: true, message_id: send.result.message_id })
}
