/**
 * Tiny wrapper around the Telegram Bot API.
 *
 * Only exposes the two methods we actually use from the admin Telegram
 * integration (getMe + sendMessage). Both are typed defensively because
 * the Telegram payload shape is well-documented but not officially typed
 * for Node.
 *
 * SERVER-ONLY: this file must never be imported from a "use client"
 * component. Bot tokens are server-side secrets; leaking them to the
 * browser would let anyone hijack the bot.
 */

const TELEGRAM_API_BASE = "https://api.telegram.org"

/** Common Telegram Bot API response envelope. */
export type TelegramResult<T> =
  | { ok: true; result: T }
  | { ok: false; description: string; error_code?: number }

export interface TelegramBotInfo {
  id: number
  is_bot: boolean
  first_name: string
  username?: string
  can_join_groups?: boolean
  can_read_all_group_messages?: boolean
  supports_inline_queries?: boolean
}

export interface TelegramMessage {
  message_id: number
  date: number
  chat: { id: number; type: string }
  text?: string
}

/**
 * Low-level call to https://api.telegram.org/bot<TOKEN>/<method>.
 *
 * Wraps fetch with a 10-second timeout (Telegram is usually < 1s; longer
 * means the API itself or our network is degraded and we should fail
 * loud rather than block the admin UI).
 *
 * Returns the raw Telegram envelope. The caller decides how to handle
 * { ok: false } responses (which can carry meaningful error codes like
 * 401 invalid token / 400 chat not found).
 */
async function callTelegram<T>(
  token: string,
  method: string,
  params?: Record<string, unknown>,
): Promise<TelegramResult<T>> {
  if (!token || typeof token !== "string") {
    return { ok: false, description: "missing_bot_token" }
  }
  // Basic format guard. Real Telegram tokens look like "123456789:AA...".
  // We only check for the colon — Telegram itself will reject malformed
  // tokens with 401, so this is a friendly early-exit, not a hard guard.
  if (!token.includes(":")) {
    return { ok: false, description: "malformed_bot_token" }
  }

  const url = `${TELEGRAM_API_BASE}/bot${token}/${method}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: params ? JSON.stringify(params) : undefined,
      signal: controller.signal,
    })
    clearTimeout(timeout)
    // Telegram always returns JSON, even for 4xx/5xx. Parse defensively.
    const json = (await res.json().catch(() => null)) as TelegramResult<T> | null
    if (!json) {
      return { ok: false, description: `telegram_invalid_response_${res.status}` }
    }
    return json
  } catch (err: any) {
    clearTimeout(timeout)
    if (err?.name === "AbortError") {
      return { ok: false, description: "telegram_request_timeout" }
    }
    return { ok: false, description: err?.message || "telegram_request_failed" }
  }
}

/**
 * Validate a token and resolve the bot's identity.
 *
 * Used at connect time to (a) prove the token is real and (b) fetch the
 * bot username so the admin UI can show "@bot_username" in the table
 * without re-querying Telegram on every render.
 */
export async function telegramGetMe(token: string): Promise<TelegramResult<TelegramBotInfo>> {
  return callTelegram<TelegramBotInfo>(token, "getMe")
}

/**
 * Send a plain text message via the bot to a specific chat.
 *
 * `chat_id` is BIGINT in our schema — pass through as a number. Negative
 * ids are valid (group/supergroup chats).
 */
export async function telegramSendMessage(
  token: string,
  chatId: number,
  text: string,
): Promise<TelegramResult<TelegramMessage>> {
  return callTelegram<TelegramMessage>(token, "sendMessage", {
    chat_id: chatId,
    text,
  })
}

/**
 * Register a webhook URL with Telegram for this bot.
 *
 *   POST https://api.telegram.org/bot<TOKEN>/setWebhook
 *
 * `secretToken` (optional, A-Z/a-z/0-9/_-, 1..256 chars) is sent back to
 * us by Telegram as the `X-Telegram-Bot-Api-Secret-Token` header on
 * every incoming update. We use it to (a) prove the request really came
 * from Telegram and (b) identify which connected bot the update is for.
 * Callers MUST pass a high-entropy server-generated value (e.g. 32
 * random bytes hex) — never agent_id or any other publicly-known id,
 * because the secret_token IS the auth surface for the public webhook.
 *
 * Returns Telegram's raw envelope. `result === true` on success.
 */
export async function telegramSetWebhook(
  token: string,
  url: string,
  secretToken?: string,
): Promise<TelegramResult<true>> {
  const params: Record<string, unknown> = { url }
  if (secretToken) params.secret_token = secretToken
  return callTelegram<true>(token, "setWebhook", params)
}

/**
 * Remove the webhook for this bot. Idempotent on Telegram's side — a
 * delete on an already-empty webhook still returns ok: true.
 */
export async function telegramDeleteWebhook(
  token: string,
): Promise<TelegramResult<true>> {
  return callTelegram<true>(token, "deleteWebhook")
}
