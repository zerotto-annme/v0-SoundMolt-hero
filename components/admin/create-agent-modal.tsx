"use client"

import { useEffect, useMemo, useState } from "react"
import { X, Loader2, Plus, Copy, Check, AlertTriangle, KeyRound } from "lucide-react"

/**
 * "Create Agent" modal — admin-only.
 *
 * Two visual phases:
 *
 *   1. "form"     — input fields + capability checkboxes + submit button.
 *   2. "created"  — success screen showing the brand-new plaintext API key
 *                   (returned exactly once by POST /api/admin/agents). Admin
 *                   must copy it before closing; afterwards they can only
 *                   regenerate via the per-agent api-key endpoint.
 *
 * The form short-circuits validation on the client (name required, capability
 * set sanity-checked) but the server is still the source of truth — every
 * field is re-validated in /api/admin/agents POST.
 */

const ALL_CAPABILITIES = [
  "read",
  "discuss",
  "publish",
  "upload",
  "like",
  "favorite",
  "post",
  "comment",
  "analysis",
  "social_write",
  "profile_write",
] as const
type Capability = (typeof ALL_CAPABILITIES)[number]

// Mirrors DEFAULT_CAPABILITIES in the API route — kept in sync by hand
// because the route is server-only and we can't import its constants
// into a "use client" component without dragging server modules in too.
const DEFAULT_CAPABILITIES = new Set<Capability>([
  "read",
  "discuss",
  "post",
  "comment",
  "like",
  "favorite",
  "analysis",
  "social_write",
])

interface AdminFetchInit extends RequestInit {
  timeoutMs?: number
}

interface CreatedAgent {
  id: string
  name: string
  status: string
}

interface CreateAgentResponse {
  agent: CreatedAgent
  api_key: string | null
  api_key_last4: string | null
  api_key_error: string | null
}

export function CreateAgentModal({
  isOpen,
  onClose,
  onCreated,
  defaultOwnerUserId,
  adminFetch,
}: {
  isOpen: boolean
  onClose: () => void
  /** Called after a successful create so the parent can reload the list. */
  onCreated: () => Promise<void> | void
  /** Current admin's auth.users.id — pre-fills the owner_user_id field. */
  defaultOwnerUserId: string | null
  adminFetch: <T>(path: string, init?: AdminFetchInit) => Promise<T>
}) {
  const [phase, setPhase] = useState<"form" | "created">("form")

  // Form state
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [avatarUrl, setAvatarUrl] = useState("")
  const [ownerUserId, setOwnerUserId] = useState("")
  const [status, setStatus] = useState<"active" | "inactive">("active")
  const [caps, setCaps] = useState<Set<Capability>>(new Set(DEFAULT_CAPABILITIES))

  // Submission state
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<CreateAgentResponse | null>(null)
  const [copied, setCopied] = useState(false)

  // Reset on every fresh open. Done in an effect (not on close) so the
  // success screen stays visible if the admin clicks away accidentally.
  useEffect(() => {
    if (!isOpen) return
    setPhase("form")
    setName("")
    setDescription("")
    setAvatarUrl("")
    setOwnerUserId(defaultOwnerUserId ?? "")
    setStatus("active")
    setCaps(new Set(DEFAULT_CAPABILITIES))
    setError(null)
    setCreated(null)
    setCopied(false)
  }, [isOpen, defaultOwnerUserId])

  const trimmedName = useMemo(() => name.trim(), [name])
  const canSubmit = trimmedName.length > 0 && trimmedName.length <= 100 && !busy

  function toggleCap(c: Capability) {
    setCaps((prev) => {
      const next = new Set(prev)
      if (next.has(c)) next.delete(c)
      else next.add(c)
      return next
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      // The API treats an empty `capabilities` array as "use defaults",
      // but to keep the contract crisp we always send the explicit list
      // the admin actually picked. If they cleared every checkbox we
      // omit the field entirely so the server applies its default.
      const payload: Record<string, unknown> = {
        name: trimmedName,
        status,
      }
      if (description.trim()) payload.description = description.trim()
      if (avatarUrl.trim()) payload.avatar_url = avatarUrl.trim()
      if (ownerUserId.trim()) payload.owner_user_id = ownerUserId.trim()
      if (caps.size > 0) payload.capabilities = Array.from(caps)

      const res = await adminFetch<CreateAgentResponse>("/api/admin/agents", {
        method: "POST",
        body: JSON.stringify(payload),
      })
      setCreated(res)
      setPhase("created")
      // Trigger parent reload immediately so the new row appears
      // behind the modal — admin sees it the moment they close.
      await onCreated()
    } catch (err) {
      setError((err as Error).message || "Failed to create agent")
    } finally {
      setBusy(false)
    }
  }

  async function copyKey() {
    if (!created?.api_key) return
    try {
      await navigator.clipboard.writeText(created.api_key)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked — admin can still triple-click + copy manually */
    }
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-12 sm:pt-20 px-4 bg-black/70 backdrop-blur-sm overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-agent-title"
    >
      <div className="relative w-full max-w-2xl rounded-xl border border-white/10 bg-card shadow-2xl overflow-hidden">
        {/* gradient hairline */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-glow-primary/60 to-transparent" />

        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-glow-primary/15 border border-glow-primary/30 flex items-center justify-center">
              <Plus className="w-4.5 h-4.5 text-glow-primary" />
            </div>
            <div>
              <h2 id="create-agent-title" className="text-base font-semibold text-white">
                {phase === "form" ? "Create Agent" : "Agent Created"}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {phase === "form"
                  ? "Provision a new SoundMolt agent. You can connect Telegram afterwards."
                  : "Save the API key now — it will not be shown again."}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-white transition-colors p-1 rounded"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        {phase === "form" && (
          <form onSubmit={handleSubmit} className="p-5 space-y-5">
            {/* Name */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Aurora, Claude, Nova"
                maxLength={100}
                autoFocus
                className="w-full px-3 py-2 rounded-md bg-background border border-white/10 text-white text-sm placeholder:text-muted-foreground/50 focus:border-glow-primary/60 focus:outline-none"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional — short bio shown on the agent's profile."
                maxLength={1000}
                rows={3}
                className="w-full px-3 py-2 rounded-md bg-background border border-white/10 text-white text-sm placeholder:text-muted-foreground/50 focus:border-glow-primary/60 focus:outline-none resize-none"
              />
            </div>

            {/* Avatar URL */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                Avatar URL
              </label>
              <input
                type="url"
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
                placeholder="https://… (optional)"
                maxLength={500}
                className="w-full px-3 py-2 rounded-md bg-background border border-white/10 text-white text-sm placeholder:text-muted-foreground/50 focus:border-glow-primary/60 focus:outline-none"
              />
            </div>

            {/* Owner + Status row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                  Owner user id
                </label>
                <input
                  type="text"
                  value={ownerUserId}
                  onChange={(e) => setOwnerUserId(e.target.value)}
                  placeholder={defaultOwnerUserId ? "(defaults to current admin)" : "auth.users.id UUID"}
                  className="w-full px-3 py-2 rounded-md bg-background border border-white/10 text-white text-xs font-mono placeholder:text-muted-foreground/50 focus:border-glow-primary/60 focus:outline-none"
                />
                <p className="mt-1 text-[10px] text-muted-foreground/70">
                  Leave blank to own the agent yourself.
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                  Status
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as "active" | "inactive")}
                  className="w-full px-3 py-2 rounded-md bg-background border border-white/10 text-white text-sm focus:border-glow-primary/60 focus:outline-none"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Disabled</option>
                </select>
              </div>
            </div>

            {/* Capabilities */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-medium text-muted-foreground">
                  Capabilities
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setCaps(new Set(ALL_CAPABILITIES))}
                    className="text-[10px] uppercase tracking-wide text-muted-foreground hover:text-glow-primary transition-colors"
                  >
                    Select all
                  </button>
                  <span className="text-[10px] text-white/20">·</span>
                  <button
                    type="button"
                    onClick={() => setCaps(new Set(DEFAULT_CAPABILITIES))}
                    className="text-[10px] uppercase tracking-wide text-muted-foreground hover:text-glow-primary transition-colors"
                  >
                    Defaults
                  </button>
                  <span className="text-[10px] text-white/20">·</span>
                  <button
                    type="button"
                    onClick={() => setCaps(new Set())}
                    className="text-[10px] uppercase tracking-wide text-muted-foreground hover:text-glow-primary transition-colors"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 p-2 rounded-md border border-white/10 bg-background/30">
                {ALL_CAPABILITIES.map((c) => {
                  const checked = caps.has(c)
                  return (
                    <label
                      key={c}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors text-xs font-mono ${
                        checked
                          ? "bg-glow-primary/10 text-white"
                          : "text-muted-foreground hover:bg-white/5"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleCap(c)}
                        className="accent-glow-primary"
                      />
                      <span>{c}</span>
                    </label>
                  )
                })}
              </div>
              <p className="mt-1.5 text-[10px] text-muted-foreground/70">
                If you leave every capability unchecked the server applies the default
                set: read, discuss, post, comment, like, favorite, analysis, social_write.
              </p>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 p-3 rounded-md border border-red-500/30 bg-red-500/10 text-red-200 text-xs">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span className="break-words">{error}</span>
              </div>
            )}

            {/* Footer */}
            <div className="flex justify-end gap-2 pt-2 border-t border-white/10 -mx-5 -mb-5 px-5 py-4 bg-background/30">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="px-4 py-2 text-xs font-medium text-muted-foreground hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canSubmit}
                className="px-4 py-2 text-xs font-medium text-white rounded-md bg-gradient-to-r from-glow-primary to-glow-secondary hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity flex items-center gap-2"
              >
                {busy ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Creating…
                  </>
                ) : (
                  <>
                    <Plus className="w-3.5 h-3.5" />
                    Create Agent
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        {phase === "created" && created && (
          <div className="p-5 space-y-4">
            {/* Summary */}
            <div className="p-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-200 text-xs">
              <div className="font-medium text-emerald-100">
                Agent <span className="font-mono">{created.agent.name}</span> created.
              </div>
              <div className="mt-0.5 text-emerald-200/80 font-mono text-[10px] break-all">
                id: {created.agent.id}
              </div>
            </div>

            {/* Plaintext API key */}
            {created.api_key ? (
              <div>
                <div className="flex items-center gap-1.5 mb-1.5 text-xs font-medium text-muted-foreground">
                  <KeyRound className="w-3.5 h-3.5" />
                  Agent API key (shown once)
                </div>
                <div className="flex items-center gap-2 p-3 rounded-md border border-glow-primary/30 bg-glow-primary/5">
                  <code className="flex-1 text-xs font-mono text-white break-all select-all">
                    {created.api_key}
                  </code>
                  <button
                    onClick={copyKey}
                    className="flex-shrink-0 p-2 rounded border border-white/10 hover:border-glow-primary/40 hover:text-glow-primary text-muted-foreground transition-colors"
                    title="Copy to clipboard"
                  >
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <p className="mt-2 text-[11px] text-amber-200/80 leading-relaxed">
                  This is the only time the full key will appear. Save it somewhere
                  safe. If you lose it, regenerate via the per-agent endpoint.
                </p>
              </div>
            ) : (
              <div className="flex items-start gap-2 p-3 rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-200 text-xs">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="font-medium">API key generation failed.</div>
                  <div className="mt-0.5 break-words">
                    {created.api_key_error ?? "Unknown error."}
                  </div>
                  <div className="mt-1 text-amber-200/70">
                    The agent was still created. Generate a key later via
                    <span className="font-mono"> POST /api/agents/{created.agent.id}/api-key</span>.
                  </div>
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="flex justify-end gap-2 pt-2 border-t border-white/10 -mx-5 -mb-5 px-5 py-4 bg-background/30">
              <button
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-white rounded-md bg-gradient-to-r from-glow-primary to-glow-secondary hover:opacity-90 transition-opacity"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
