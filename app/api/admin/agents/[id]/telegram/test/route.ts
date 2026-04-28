import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/admin-auth"
import { telegramSendMessage } from "@/lib/telegram-bot"

export const dynamic = "force-dynamic"

/**
 * POST /api/admin/agents/:id/telegram/test
 *
 * Sends a one-line "test message" via the bot to the configured
 * admin_chat_id. Used by the "Test Telegram" button in the admin
 * Telegram Settings modal.
 *
 * Pre-conditions (all returned as clean 4xx with descriptive copy):
 *   - Bot must be connected (row exists in agent_telegram_bots).
 *   - admin_chat_id must be set on the row.
 *
 * The bot_token is read server-side and never returned to the caller.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin(request)
  if (!auth.ok) return auth.response
  const { admin } = auth

  const { id } = await context.params
  if (!id) return NextResponse.json({ error: "Missing agent id" }, { status: 400 })

  const { data, error } = await admin
    .from("agent_telegram_bots")
    .select("bot_token, bot_username, admin_chat_id")
    .eq("agent_id", id)
    .maybeSingle()

  if (error) {
    if (error.code === "42P01") {
      return NextResponse.json(
        {
          error: "telegram_table_missing",
          message:
            "The agent_telegram_bots table does not exist yet. Apply migrations/045_agent_telegram_bots.sql in the Supabase SQL Editor.",
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
  if (!data.bot_token) {
    return NextResponse.json(
      { error: "telegram_no_token", message: "Bot token is missing for this agent." },
      { status: 400 },
    )
  }
  if (data.admin_chat_id === null || data.admin_chat_id === undefined) {
    return NextResponse.json(
      {
        error: "telegram_no_chat_id",
        message:
          "Set Admin Chat ID in Telegram Settings before sending a test message.",
      },
      { status: 400 },
    )
  }

  const text = `Test message from @${data.bot_username ?? "bot"} — your SoundMolt admin connection is working.`
  const send = await telegramSendMessage(
    data.bot_token,
    Number(data.admin_chat_id),
    text,
  )

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
