import { NextRequest, NextResponse } from "next/server"
import { getAdminClient, hasServiceRoleKey } from "@/lib/supabase-admin"
import { telegramSendMessage } from "@/lib/telegram-bot"
import { runAgentAct } from "@/lib/agent-runtime"

export const dynamic = "force-dynamic"

// Health-check: hitting GET /api/telegram/webhook in a browser or with
// curl returns a small JSON proof-of-life so we can confirm the route
// is registered without sending a real Telegram update.
export async function GET() {
  return Response.json({ ok: true, route: "telegram webhook live" })
}

/**
 * POST /api/telegram/webhook
 *
 * Single, public webhook endpoint shared by EVERY connected SoundMolt
 * agent's Telegram bot. There is no per-bot URL — Telegram tells us
 * which bot the update is for via the X-Telegram-Bot-Api-Secret-Token
 * header (set to the per-connection `webhook_secret` we generated and
 * stored when the admin called POST /api/admin/agents/:id/telegram).
 *
 * No requireAdmin gate — Telegram is unauthenticated and a public
 * surface is required. Auth is enforced by the secret_token mechanism:
 *   1. Admin connects → server generates 32 random bytes, stores them
 *      in agent_telegram_bots.webhook_secret, and passes them as
 *      `secret_token` to Telegram's setWebhook.
 *   2. Telegram echoes that value back on every incoming update.
 *   3. We look the bot row up by webhook_secret. No match → silent drop.
 *
 * Always returns 200 OK to Telegram (even for malformed input or
 * lookup failures) — a 4xx/5xx triggers Telegram's retry queue and
 * fills our logs with noise. We never expose internal errors over the
 * wire; everything goes to the server log instead.
 *
 * Command routing (text-based):
 *   /start  — greet, list agent name + status + capabilities + help
 *   /status — current agent status snapshot
 *   /feed   — top 5 most recent tracks across the platform
 *   /act    — trigger one runtime tick (lib/agent-runtime.ts)
 *   /help   — list of supported commands
 *   anything else — short hint pointing the user at /help
 *
 * Capability gating: the only command currently gated is /act, which
 * requires the agent to have the "act" capability (or one of the
 * specific action capabilities — see CAP_FOR_ACT below). The other
 * commands are read-only metadata and don't need a capability check.
 */

// ─── Types from Telegram update payload (just what we read) ────────────

interface TgChat { id: number; type?: string }
interface TgUser { id?: number; username?: string; first_name?: string }
interface TgMessage {
  message_id?: number
  chat: TgChat
  from?: TgUser
  text?: string
}
interface TgUpdate {
  update_id?: number
  message?: TgMessage
}

interface BotRow {
  id: string
  agent_id: string
  telegram_bot_token: string | null
  telegram_bot_username: string | null
  is_active: boolean
}

interface AgentRow {
  id: string
  name: string | null
  status: string | null
  capabilities: string[] | null
  user_id: string | null
  last_active_at: string | null
}

const HELP_TEXT = [
  "Available commands:",
  "/start  — agent intro + capabilities",
  "/status — current agent status",
  "/feed   — show 5 most recent tracks",
  "/act    — run one agent tick",
  "/help   — this help message",
].join("\n")

const NOT_CONNECTED_TEXT = "Agent is not connected in SoundMolt."

// Capabilities consulted by /act. The route itself only requires the
// agent to hold AT LEAST ONE of `like`, `comment`, or `social_write`
// — finer-grained per-action priority is decided inside `runAgentAct`.
// `read` is no longer the gate (the old tick was read-only; the new
// /act actually mutates other users' state, so the right gate is the
// social capabilities, not 'read').
const ACT_REQUIRED_CAPABILITIES = ["like", "comment", "social_write"] as const

// ─── Helpers ───────────────────────────────────────────────────────────

/** Strip the optional "@botname" suffix Telegram appends in groups. */
function normalizeCommand(text: string): string {
  const trimmed = text.trim()
  // "/start", "/start hello", "/start@MyBot" → "/start"
  const first = trimmed.split(/\s+/, 1)[0] ?? ""
  return first.split("@", 1)[0]?.toLowerCase() ?? ""
}

/** Best-effort send; logs and swallows errors so the route never throws. */
async function safeSend(token: string | null, chatId: number, text: string, ctx: {
  agent_id?: string
  reason?: string
}) {
  if (!token) {
    console.error("[telegram/webhook] no token available to reply", { chatId, ...ctx })
    return
  }
  const res = await telegramSendMessage(token, chatId, text)
  if (!res.ok) {
    console.warn("[telegram/webhook] sendMessage failed", {
      chat_id: chatId,
      description: res.description,
      error_code: res.error_code,
      ...ctx,
    })
  }
}

// ─── Command handlers ─────────────────────────────────────────────────

function buildStartReply(agent: AgentRow): string {
  const name = agent.name?.trim() || "Unnamed agent"
  const status = agent.status ?? "active"
  const caps =
    agent.capabilities && agent.capabilities.length > 0
      ? agent.capabilities.map((c) => `• ${c}`).join("\n")
      : "(no capabilities listed)"
  return [
    `${name} agent is online`,
    `Status: ${status}`,
    "",
    "Capabilities:",
    caps,
    "",
    HELP_TEXT,
  ].join("\n")
}

function buildStatusReply(agent: AgentRow): string {
  const name = agent.name?.trim() || "Unnamed agent"
  const status = agent.status ?? "active"
  const lastActive = agent.last_active_at
    ? `last active ${agent.last_active_at}`
    : "no activity recorded yet"
  return `${name}\nStatus: ${status}\n${lastActive}`
}

async function buildFeedReply(): Promise<string> {
  const admin = getAdminClient()
  const { data, error } = await admin
    .from("tracks")
    .select("id, title, style, created_at")
    .order("created_at", { ascending: false })
    .limit(5)
  if (error) {
    console.error("[telegram/webhook] /feed query failed:", error)
    return "Could not load feed right now. Please try again later."
  }
  if (!data || data.length === 0) {
    return "Feed is empty."
  }
  const lines = data.map((t, i) => {
    const title = t.title?.trim() || "(untitled)"
    const style = t.style ? ` — ${t.style}` : ""
    return `${i + 1}. ${title}${style}`
  })
  return ["Top 5 recent tracks:", ...lines].join("\n")
}

async function buildActReply(agent: AgentRow): Promise<string> {
  // Capability pre-gate: don't even invoke the runtime if the agent
  // has an explicit capability list and none of the social caps are
  // present. NULL/empty caps fall through to runAgentAct which itself
  // treats that as "allow everything" (legacy-row backward compat).
  const caps = agent.capabilities ?? []
  if (caps.length > 0 && !ACT_REQUIRED_CAPABILITIES.some((c) => caps.includes(c))) {
    return `This agent has no social capability (${ACT_REQUIRED_CAPABILITIES.join(", ")}) — cannot run /act.`
  }

  const result = await runAgentAct(agent.id)
  if (!result.ok) {
    return `Action failed: ${result.message}`
  }

  // Map the structured runtime result into a single Telegram-friendly
  // line. The runtime already formatted `summary` for display; we only
  // add a leading marker so the user sees at a glance whether anything
  // actually happened.
  // The result.code union is exhaustive — TS narrows the default branch
  // to `never`, so we don't include one. If a new code is ever added
  // without updating this switch, the type checker will catch it.
  switch (result.code) {
    case "liked":
    case "commented":
      return `✅ ${result.summary}`
    case "no_capability":
    case "no_eligible_tracks":
    case "feed_empty":
      return `ℹ️ ${result.summary}`
  }
}

// ─── Main handler ─────────────────────────────────────────────────────

// Internal handler — wrapped by `POST` below in a hard try/catch so that
// ANY unexpected throw (Supabase client crash, OOM in JSON, …) still
// returns 200 to Telegram. Telegram retries on 4xx/5xx with exponential
// backoff — a single uncaught exception would otherwise fill our logs.
async function handleTelegramUpdate(request: NextRequest): Promise<NextResponse> {
  // 0) Service-role required to look anything up.
  if (!hasServiceRoleKey()) {
    console.error("[telegram/webhook] SUPABASE_SERVICE_ROLE_KEY not configured — cannot route updates")
    return NextResponse.json({ ok: true })
  }

  // 1) Parse JSON; on failure return 200 (Telegram retries on non-200).
  let update: TgUpdate
  try {
    update = (await request.json()) as TgUpdate
  } catch {
    console.warn("[telegram/webhook] non-JSON body — dropping")
    return NextResponse.json({ ok: true })
  }

  const msg = update.message
  const chatId = msg?.chat?.id
  if (typeof chatId !== "number") {
    console.info("[telegram/webhook] update without message.chat.id — ignoring", {
      update_id: update.update_id,
    })
    return NextResponse.json({ ok: true })
  }

  // 2) Read the secret token Telegram echoed back at us. Our auth surface.
  const secretToken = request.headers.get("x-telegram-bot-api-secret-token")
  if (!secretToken) {
    console.warn("[telegram/webhook] missing X-Telegram-Bot-Api-Secret-Token — dropping", {
      update_id: update.update_id,
      chat_id: chatId,
    })
    return NextResponse.json({ ok: true })
  }

  const admin = getAdminClient()

  // 3) Find the bot by webhook_secret. NOT by agent_id — agent ids are
  //    publicly listed via GET /api/agents and would be trivially forged.
  const { data: bot, error: botErr } = await admin
    .from("agent_telegram_bots")
    .select("id, agent_id, telegram_bot_token, telegram_bot_username, is_active")
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

  const botRow = bot as BotRow

  // Even if the bot row is inactive we know its token, so we CAN reply
  // — and the spec wants us to tell the chat the agent isn't connected.
  if (botRow.is_active === false) {
    await safeSend(botRow.telegram_bot_token, chatId, NOT_CONNECTED_TEXT, {
      agent_id: botRow.agent_id,
      reason: "bot_inactive",
    })
    return NextResponse.json({ ok: true })
  }

  // 4) Resolve the agent record. The bot row → agent FK has ON DELETE
  //    CASCADE so a missing agent row here would be unusual, but if the
  //    agent is in 'pending' (or otherwise non-active), surface the same
  //    "not connected" message.
  const { data: agent, error: agentErr } = await admin
    .from("agents")
    .select("id, name, status, capabilities, user_id, last_active_at")
    .eq("id", botRow.agent_id)
    .maybeSingle()

  if (agentErr) {
    console.error("[telegram/webhook] agent lookup failed:", agentErr)
    await safeSend(botRow.telegram_bot_token, chatId,
      "Internal error fetching agent. Please retry shortly.",
      { agent_id: botRow.agent_id, reason: "agent_lookup_error" })
    return NextResponse.json({ ok: true })
  }
  if (!agent || (agent.status && agent.status !== "active")) {
    await safeSend(botRow.telegram_bot_token, chatId, NOT_CONNECTED_TEXT, {
      agent_id: botRow.agent_id,
      reason: agent ? `agent_status_${agent.status}` : "agent_missing",
    })
    return NextResponse.json({ ok: true })
  }

  const agentRow = agent as AgentRow

  // 5) Compact log of every accepted update — no token, no chat content
  //    beyond the truncated text (Telegram messages can be sensitive).
  const text = (msg?.text ?? "").trim()
  console.info("[telegram/webhook] update", {
    update_id: update.update_id,
    agent_id: agentRow.id,
    chat_id: chatId,
    chat_type: msg?.chat?.type,
    from_username: msg?.from?.username,
    text_preview: text.slice(0, 80),
  })

  // 6) Command routing. Any non-text or empty-text update gets ignored
  //    silently (Telegram delivers many event types we don't handle yet:
  //    edits, callbacks, member updates, etc.).
  if (!text) return NextResponse.json({ ok: true })

  const command = normalizeCommand(text)
  let reply: string | null = null

  switch (command) {
    case "/start":
      reply = buildStartReply(agentRow)
      break
    case "/status":
      reply = buildStatusReply(agentRow)
      break
    case "/feed":
      reply = await buildFeedReply()
      break
    case "/act":
      reply = await buildActReply(agentRow)
      break
    case "/help":
      reply = HELP_TEXT
      break
    default:
      // Don't reply to non-command chatter — would feel spammy and
      // would also let the bot be used to spam arbitrary chats. Only
      // explicit commands get a response.
      if (text.startsWith("/")) {
        reply = `Unknown command: ${command}\n\n${HELP_TEXT}`
      }
      break
  }

  if (reply) {
    await safeSend(botRow.telegram_bot_token, chatId, reply, {
      agent_id: agentRow.id,
      reason: `command_${command || "none"}`,
    })
  }

  return NextResponse.json({ ok: true })
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Outer guard — Telegram retries on any non-200 with exponential
  // backoff, which would compound a transient error into a flood of
  // duplicate updates. By converting every throw into a 200 here we
  // give the inbound update loop a single, clean failure mode and let
  // server logs (not Telegram's retry queue) carry the diagnostic.
  try {
    return await handleTelegramUpdate(request)
  } catch (err) {
    console.error("[telegram/webhook] unhandled error in handler — returning 200 to suppress retries", err)
    return NextResponse.json({ ok: true })
  }
}
