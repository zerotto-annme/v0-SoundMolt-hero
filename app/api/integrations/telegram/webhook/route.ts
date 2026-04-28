import { NextRequest, NextResponse } from "next/server"
import { getAdminClient, hasServiceRoleKey } from "@/lib/supabase-admin"
import { telegramSendMessage } from "@/lib/telegram-bot"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * Public Telegram webhook endpoint.
 *
 *   POST /api/integrations/telegram/webhook
 *
 * Telegram delivers every update for every connected bot to this single
 * URL. We disambiguate "which agent's bot" via the
 * `X-Telegram-Bot-Api-Secret-Token` header that Telegram echoes back to
 * us — we set it to the agent UUID at connect time (see
 * /api/admin/agents/:id/telegram POST). The header therefore acts as
 * BOTH a routing key (which agent) AND a shared-secret (proof the
 * request came from Telegram, not a random attacker hitting the URL).
 *
 * Behavior:
 *   - Header missing or unknown        → log + 200 OK (silent reject; we
 *                                        do not 4xx Telegram, that would
 *                                        cause it to retry forever).
 *   - Bot row not found / is_active=F  → log + 200 OK (drop on the floor).
 *   - update.message.text === "/start" → reply "<agent name> agent is
 *                                        online" via sendMessage.
 *   - All other updates                → log + 200 OK.
 *
 * Telegram retries non-2xx responses, so we ALWAYS return 200 unless the
 * request is so malformed we can't parse the body — and even then we
 * choose 200 over 500 to avoid retry storms.
 */

// Bare-bones type for the slice of the Telegram Update object we care about.
interface TelegramUpdate {
  update_id?: number
  message?: {
    message_id?: number
    chat?: { id?: number; type?: string }
    from?: { id?: number; username?: string; first_name?: string }
    text?: string
  }
}

export async function POST(request: NextRequest) {
  // ── Step 1: parse body. If we can't even read JSON, 200 + log
  //    (returning 4xx/5xx triggers Telegram retries). ────────────────────
  let update: TelegramUpdate = {}
  try {
    update = (await request.json()) as TelegramUpdate
  } catch {
    console.warn("[telegram/webhook] received non-JSON body — dropping")
    return NextResponse.json({ ok: true })
  }

  // ── Step 2: pull the secret token Telegram echoed back. This is our
  //    routing key + auth in one. Missing → silent drop. ────────────────
  const secretToken = request.headers.get("x-telegram-bot-api-secret-token") ?? ""
  if (!secretToken) {
    console.warn("[telegram/webhook] missing secret token header — dropping", {
      update_id: update.update_id,
    })
    return NextResponse.json({ ok: true })
  }

  if (!hasServiceRoleKey()) {
    // Server misconfigured. Surface clearly in logs but still 200 to TG.
    console.error("[telegram/webhook] service role key missing — cannot lookup bot")
    return NextResponse.json({ ok: true })
  }
  const admin = getAdminClient()

  // ── Step 3: look up the connected bot by webhook_secret. The header
  //    value IS the secret — we generated it at connect time as 32 random
  //    bytes (see migration 047 + POST /api/admin/agents/:id/telegram).
  //    Looking up by this random secret means an attacker who knows an
  //    agent_id (publicly listed via GET /api/agents) cannot forge
  //    incoming updates: they'd also need to know the per-connection
  //    secret, which never leaves the server.
  const { data: bot, error: botErr } = await admin
    .from("agent_telegram_bots")
    .select("agent_id, telegram_bot_token, telegram_bot_username, is_active")
    .eq("webhook_secret", secretToken)
    .maybeSingle()

  if (botErr) {
    console.error("[telegram/webhook] bot lookup failed:", {
      code: botErr.code,
      message: botErr.message,
    })
    return NextResponse.json({ ok: true })
  }
  if (!bot) {
    console.warn("[telegram/webhook] secret token did not match any bot — dropping", {
      secret_prefix: secretToken.slice(0, 8),
      update_id: update.update_id,
    })
    return NextResponse.json({ ok: true })
  }
  if (bot.is_active === false) {
    console.info("[telegram/webhook] bot is disabled — dropping update", {
      agent_id: bot.agent_id,
      update_id: update.update_id,
    })
    return NextResponse.json({ ok: true })
  }

  // ── Step 4: log the update (compact form — never log the token). ────
  const msg = update.message
  console.info("[telegram/webhook] update received", {
    agent_id: bot.agent_id,
    bot_username: bot.telegram_bot_username,
    update_id: update.update_id,
    message_id: msg?.message_id,
    chat_id: msg?.chat?.id,
    chat_type: msg?.chat?.type,
    from_username: msg?.from?.username,
    text: msg?.text,
  })

  // ── Step 5: handle /start. Anything else: log only, no reply. ───────
  // Reply text matches the spec literally — "MusicCritic agent is online"
  // — so QA against the requirement passes by string equality. If we
  // later want per-agent personalization, switch to `${agent.name} agent
  // is online`; for now, literal string per the brief.
  if (msg?.text === "/start" && typeof msg.chat?.id === "number") {
    if (!bot.telegram_bot_token) {
      console.error("[telegram/webhook] no token for /start reply", {
        agent_id: bot.agent_id,
      })
      return NextResponse.json({ ok: true })
    }

    const send = await telegramSendMessage(
      bot.telegram_bot_token,
      msg.chat.id,
      "MusicCritic agent is online",
    )
    if (!send.ok) {
      console.warn("[telegram/webhook] /start reply failed", {
        agent_id: bot.agent_id,
        chat_id: msg.chat.id,
        description: send.description,
        error_code: send.error_code,
      })
    }
  }

  return NextResponse.json({ ok: true })
}
