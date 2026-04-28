"use client"

import { useEffect, useState } from "react"
import { X, Loader2, Send, Trash2, KeyRound, Hash, CheckCircle2 } from "lucide-react"

/**
 * Telegram bot connection modal for the Admin → Agents table.
 *
 * Two modes, picked automatically based on initial server state:
 *   1. "connect"  — no row yet. Asks for bot_token only.
 *   2. "settings" — row exists. Shows bot_username, lets the admin set
 *                   admin_chat_id, send a test message, replace the
 *                   token, or disconnect entirely.
 *
 * The bot token itself is NEVER returned to the browser by the API
 * (only `has_token: true`), so this modal can't display the existing
 * token — it can only replace it.
 */

export interface TelegramConnection {
  agent_id: string
  bot_username: string | null
  bot_id: number | null
  admin_chat_id: number | null
  has_token: true
  created_at: string
  updated_at: string
}

interface AdminFetchInit extends RequestInit {
  timeoutMs?: number
}

export function TelegramConnectModal({
  agentId,
  agentName,
  isOpen,
  onClose,
  onChanged,
  adminFetch,
}: {
  agentId: string | null
  agentName: string | null
  isOpen: boolean
  onClose: () => void
  /** Called after any state change (connect / update / disconnect) so
   *  the parent can reload the agents list. */
  onChanged: () => Promise<void> | void
  adminFetch: <T>(path: string, init?: AdminFetchInit) => Promise<T>
}) {
  const [loadingInitial, setLoadingInitial] = useState(false)
  const [connection, setConnection] = useState<TelegramConnection | null>(null)
  const [token, setToken] = useState("")
  const [chatId, setChatId] = useState("")
  const [busy, setBusy] = useState<null | "connect" | "save-chat" | "test" | "disconnect">(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  // Reset + load whenever we open against a new agent.
  useEffect(() => {
    if (!isOpen || !agentId) return
    let cancelled = false
    setError(null)
    setInfo(null)
    setToken("")
    setChatId("")
    setConnection(null)
    setLoadingInitial(true)
    ;(async () => {
      try {
        const json = await adminFetch<{ connection: TelegramConnection | null }>(
          `/api/admin/agents/${agentId}/telegram`,
        )
        if (cancelled) return
        setConnection(json.connection)
        if (json.connection?.admin_chat_id !== null && json.connection?.admin_chat_id !== undefined) {
          setChatId(String(json.connection.admin_chat_id))
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message || "Failed to load connection")
      } finally {
        if (!cancelled) setLoadingInitial(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isOpen, agentId, adminFetch])

  if (!isOpen || !agentId) return null

  const isConnected = !!connection
  const mode: "connect" | "settings" = isConnected ? "settings" : "connect"

  async function connect(e: React.FormEvent) {
    e.preventDefault()
    if (!agentId || busy) return
    const trimmed = token.trim()
    if (!trimmed) {
      setError("Bot token is required.")
      return
    }
    setBusy("connect")
    setError(null)
    setInfo(null)
    try {
      const json = await adminFetch<{ connection: TelegramConnection }>(
        `/api/admin/agents/${agentId}/telegram`,
        {
          method: "POST",
          body: JSON.stringify({ bot_token: trimmed }),
        },
      )
      setConnection(json.connection)
      setToken("")
      if (json.connection.admin_chat_id !== null && json.connection.admin_chat_id !== undefined) {
        setChatId(String(json.connection.admin_chat_id))
      }
      setInfo(`Connected to @${json.connection.bot_username ?? "bot"}.`)
      await onChanged()
    } catch (err) {
      setError((err as Error).message || "Failed to connect")
    } finally {
      setBusy(null)
    }
  }

  async function saveChatId() {
    if (!agentId || busy) return
    setBusy("save-chat")
    setError(null)
    setInfo(null)
    const trimmed = chatId.trim()
    let payload: number | null = null
    if (trimmed !== "") {
      const n = Number(trimmed)
      if (!Number.isFinite(n) || !Number.isInteger(n)) {
        setError("Chat ID must be an integer (or empty to clear).")
        setBusy(null)
        return
      }
      payload = n
    }
    try {
      const json = await adminFetch<{ connection: TelegramConnection }>(
        `/api/admin/agents/${agentId}/telegram`,
        {
          method: "PATCH",
          body: JSON.stringify({ admin_chat_id: payload }),
        },
      )
      setConnection(json.connection)
      setInfo(payload === null ? "Admin chat ID cleared." : "Admin chat ID saved.")
    } catch (err) {
      setError((err as Error).message || "Failed to save chat id")
    } finally {
      setBusy(null)
    }
  }

  async function sendTest() {
    if (!agentId || busy) return
    setBusy("test")
    setError(null)
    setInfo(null)
    try {
      await adminFetch(`/api/admin/agents/${agentId}/telegram/test`, { method: "POST" })
      setInfo("Test message sent. Check your Telegram.")
    } catch (err) {
      setError((err as Error).message || "Failed to send test message")
    } finally {
      setBusy(null)
    }
  }

  async function disconnect() {
    if (!agentId || busy) return
    if (!confirm("Disconnect this Telegram bot? The stored token will be deleted.")) return
    setBusy("disconnect")
    setError(null)
    setInfo(null)
    try {
      await adminFetch(`/api/admin/agents/${agentId}/telegram`, { method: "DELETE" })
      setConnection(null)
      setToken("")
      setChatId("")
      setInfo("Bot disconnected.")
      await onChanged()
    } catch (err) {
      setError((err as Error).message || "Failed to disconnect")
    } finally {
      setBusy(null)
    }
  }

  const closing = busy !== null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={() => !closing && onClose()}
      />

      <div className="relative w-full max-w-lg mx-4 bg-card border border-border/50 rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto overscroll-contain">
        <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-br from-sky-500/20 via-transparent to-glow-primary/20 pointer-events-none" />

        <button
          onClick={onClose}
          disabled={closing}
          className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors z-10 disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="Close"
        >
          <X className="w-4 h-4 text-white" />
        </button>

        <div className="relative p-6 space-y-5">
          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center">
              <Send className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-foreground">
                {mode === "connect" ? "Connect Telegram Bot" : "Telegram Settings"}
              </h2>
              <p className="text-sm text-muted-foreground truncate" title={agentName ?? agentId}>
                {agentName ?? agentId}
              </p>
            </div>
          </div>

          {loadingInitial ? (
            <div className="py-10 flex items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              Loading…
            </div>
          ) : mode === "connect" ? (
            <ConnectForm
              token={token}
              setToken={setToken}
              busy={busy === "connect"}
              onSubmit={connect}
            />
          ) : (
            <SettingsBody
              connection={connection!}
              chatId={chatId}
              setChatId={setChatId}
              token={token}
              setToken={setToken}
              busy={busy}
              onSaveChat={saveChatId}
              onSendTest={sendTest}
              onReplaceToken={connect}
              onDisconnect={disconnect}
            />
          )}

          {error && (
            <div className="text-sm text-red-400 border border-red-500/30 bg-red-500/5 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
          {info && !error && (
            <div className="text-sm text-emerald-300 border border-emerald-500/30 bg-emerald-500/5 rounded-lg px-3 py-2 inline-flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              {info}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ConnectForm({
  token,
  setToken,
  busy,
  onSubmit,
}: {
  token: string
  setToken: (v: string) => void
  busy: boolean
  onSubmit: (e: React.FormEvent) => void
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <p className="text-xs text-muted-foreground leading-relaxed">
        Paste a Telegram bot token from{" "}
        <span className="font-mono text-foreground">@BotFather</span>. We'll verify
        it by calling Telegram's <span className="font-mono">getMe</span> and store
        it server-side, linked to this agent. The token is admin-only and never
        exposed to the public UI.
      </p>

      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-foreground inline-flex items-center gap-1.5">
          <KeyRound className="w-3.5 h-3.5" />
          Bot token
        </span>
        <input
          type="password"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          disabled={busy}
          placeholder="123456789:AA…"
          className="w-full rounded-lg bg-black/30 border border-border/40 px-3 py-2 text-sm text-foreground font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:border-sky-500/50 disabled:opacity-50"
        />
      </label>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={busy || !token.trim()}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-gradient-to-br from-sky-500 to-blue-600 text-white font-medium shadow-lg shadow-sky-500/20 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          Connect
        </button>
      </div>
    </form>
  )
}

function SettingsBody({
  connection,
  chatId,
  setChatId,
  token,
  setToken,
  busy,
  onSaveChat,
  onSendTest,
  onReplaceToken,
  onDisconnect,
}: {
  connection: TelegramConnection
  chatId: string
  setChatId: (v: string) => void
  token: string
  setToken: (v: string) => void
  busy: null | "connect" | "save-chat" | "test" | "disconnect"
  onSaveChat: () => void
  onSendTest: () => void
  onReplaceToken: (e: React.FormEvent) => void
  onDisconnect: () => void
}) {
  const username = connection.bot_username ?? "(no username)"
  const chatIdSet = connection.admin_chat_id !== null && connection.admin_chat_id !== undefined

  return (
    <div className="space-y-5">
      {/* Bot info */}
      <div className="rounded-xl border border-border/40 bg-black/30 px-4 py-3 space-y-1">
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>Connected bot</span>
          <span className="font-mono text-foreground">id {connection.bot_id ?? "—"}</span>
        </div>
        <div className="text-base font-mono text-sky-300">@{username}</div>
      </div>

      {/* Chat id */}
      <div className="space-y-2">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-foreground inline-flex items-center gap-1.5">
            <Hash className="w-3.5 h-3.5" />
            Admin chat ID
          </span>
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="numeric"
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              disabled={busy !== null}
              placeholder="e.g. 123456789 (or empty to clear)"
              className="flex-1 rounded-lg bg-black/30 border border-border/40 px-3 py-2 text-sm text-foreground font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:border-sky-500/50 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={onSaveChat}
              disabled={busy !== null}
              className="px-3 py-2 text-sm rounded-lg border border-border/50 text-foreground hover:bg-white/5 disabled:opacity-50"
            >
              {busy === "save-chat" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save"}
            </button>
          </div>
        </label>
        <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
          Numeric Telegram chat id where test messages will be delivered.
          DM the bot first, then look up the chat id (e.g. via @userinfobot).
          Negative ids are valid for groups/channels.
        </p>
      </div>

      {/* Test + disconnect actions */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onDisconnect}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-rose-500/30 text-rose-300 hover:bg-rose-500/10 disabled:opacity-50"
        >
          {busy === "disconnect" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          Disconnect
        </button>
        <button
          type="button"
          onClick={onSendTest}
          disabled={busy !== null || !chatIdSet}
          title={chatIdSet ? "Send a test message to the configured admin chat" : "Set Admin chat ID first"}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-gradient-to-br from-sky-500 to-blue-600 text-white font-medium shadow-lg shadow-sky-500/20 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy === "test" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          Test Telegram
        </button>
      </div>

      {/* Replace token (collapsible-ish) */}
      <details className="rounded-xl border border-border/30 bg-black/20 px-3 py-2 text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">
          Replace bot token
        </summary>
        <form onSubmit={onReplaceToken} className="mt-3 space-y-2">
          <input
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            disabled={busy !== null}
            placeholder="New bot token"
            className="w-full rounded-lg bg-black/30 border border-border/40 px-3 py-2 text-xs text-foreground font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:border-sky-500/50 disabled:opacity-50"
          />
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={busy !== null || !token.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-sky-500/40 text-sky-300 hover:bg-sky-500/10 disabled:opacity-50"
            >
              {busy === "connect" ? <Loader2 className="w-3 h-3 animate-spin" /> : <KeyRound className="w-3 h-3" />}
              Replace token
            </button>
          </div>
        </form>
      </details>
    </div>
  )
}
