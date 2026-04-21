"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { supabase } from "@/lib/supabase"

// ─── Bootstrap payload shape (mirrors GET /api/agents/bootstrap) ───────────
export interface AgentBootstrap {
  agent_id:       string
  name:           string
  status:         string
  is_active:      boolean
  owner_user_id?: string | null
  owner_username?: string | null
  studio_id:      string | null
  linked_studio:  string | null
  capabilities:   string[]
  api: {
    has_api_key:  boolean
    api_key:      string | null     // always null — plaintext is never re-served
    masked:       string | null
    last4:        string | null
    status:       "active" | "none"
    created_at:   string | null
    last_used_at: string | null
  }
  endpoints: Record<string, string>
  limits:    Record<string, unknown>
  profile: {
    artist_name: string | null
    avatar_url:  string | null
    cover_url:   string | null
    description: string | null
    genre:       string | null
    provider:    string | null
    model_name:  string | null
  }
  timestamps: {
    created_at:     string
    last_active_at: string | null
  }
  next_steps: Array<{
    id:          string
    title:       string
    description: string
    endpoint?:   string
    done:        boolean
  }>
  /** Present only when the bootstrap came from /api/agents/recover. */
  recovery?: {
    mode:   "persistent"
    notice: string
  }
}

export type AgentSessionSource =
  | "local-cache"
  | "owner-jwt"
  | "post-activation"
  | "recover"

interface AgentSessionState {
  data:    AgentBootstrap | null
  loading: boolean
  error:   string | null
  /** Where the current `data` came from. `null` while loading or unloaded. */
  source:  AgentSessionSource | null
  refresh: () => Promise<void>
}

const AgentSessionContext = createContext<AgentSessionState | null>(null)

interface ProviderProps {
  /** Agent UUID to bootstrap. When null/undefined the provider stays idle. */
  agentId: string | null | undefined
  children: ReactNode
}

// ─── Persistent client-side cache ──────────────────────────────────────────
// We use localStorage (not sessionStorage) so the cached bootstrap survives
// tab close + reload. This is the persistent recovery surface for
// anonymous agent operators — without it, closing the tab between the
// reveal window and the next visit would force a generic reconnect.
//
// SECURITY: We strip every reveal-grade field before persisting so a
// device compromise or XSS can't lift the API key last4/masked or owner
// identifiers out of localStorage long after the reveal window closed.
// What lands on disk is the same shape /api/agents/recover already
// hands out to anyone with the agent_id.
const CACHE_KEY  = (agentId: string) => `soundmolt:agent-session:${agentId}`
const LINKED_KEY = "soundmolt:linked-agent-id"

function sanitizeForCache(payload: AgentBootstrap): AgentBootstrap {
  return {
    ...payload,
    owner_user_id:  null,
    owner_username: null,
    api: {
      ...payload.api,
      // The presence boolean is fine to keep so the dashboard can
      // gate "Verify your key" CTAs, but we drop everything that
      // identifies the key itself.
      api_key:      null,
      masked:       null,
      last4:        null,
      created_at:   null,
      last_used_at: null,
    },
  }
}

export function cacheAgentBootstrap(agentId: string, payload: AgentBootstrap) {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(CACHE_KEY(agentId), JSON.stringify(sanitizeForCache(payload)))
    // Track the most recently activated agent so a generic /agent-connect
    // visit can offer to recover it instead of starting from scratch.
    localStorage.setItem(LINKED_KEY, agentId)
  } catch {
    /* localStorage may be disabled (private mode, quota). Non-fatal. */
  }
}

function clearCachedBootstrap(agentId: string) {
  if (typeof window === "undefined") return
  try {
    localStorage.removeItem(CACHE_KEY(agentId))
    if (localStorage.getItem(LINKED_KEY) === agentId) {
      localStorage.removeItem(LINKED_KEY)
    }
  } catch { /* non-fatal */ }
}

function readCachedBootstrap(agentId: string): AgentBootstrap | null {
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem(CACHE_KEY(agentId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as AgentBootstrap
    return parsed && parsed.agent_id === agentId ? parsed : null
  } catch {
    return null
  }
}

/** Read the most-recently-linked agent id (for the recovery prompt). */
export function getLinkedAgentId(): string | null {
  if (typeof window === "undefined") return null
  try { return localStorage.getItem(LINKED_KEY) } catch { return null }
}

/**
 * AgentSessionProvider
 *
 * Resolves the bootstrap from up to four sources, in priority order:
 *
 *   a. localStorage cache → instant hydrate, persists across tab close.
 *   b. GET /api/agents/bootstrap with the studio-owner JWT (full payload).
 *   c. GET /api/agents/post-activation (anon, 15-min reveal window —
 *      includes API-key last4 / masked).
 *   d. GET /api/agents/recover (anon, **no time window**, reduced
 *      payload — no key reveal details). This is the persistent
 *      recovery path that keeps the dashboard reachable forever for
 *      anonymous agent operators after the reveal window expires.
 *
 * We only show the error UI when **all four** sources fail. Cached data
 * stays visible during background revalidation; transient failures
 * never blow away the rendered shell.
 */
export function AgentSessionProvider({ agentId, children }: ProviderProps) {
  const [data, setData]     = useState<AgentBootstrap | null>(null)
  const [loading, setLoad]  = useState<boolean>(true)
  const [error, setError]   = useState<string | null>(null)
  const [source, setSource] = useState<AgentSessionSource | null>(null)

  // Avoid double-fetching under StrictMode.
  const inflight = useRef<string | null>(null)

  const fetchBootstrap = useCallback(async () => {
    if (!agentId) {
      setData(null); setError(null); setLoad(false); setSource(null)
      return
    }
    if (inflight.current === agentId) return
    inflight.current = agentId

    // ── (a) Hydrate from localStorage immediately ──────────────────
    const cached = readCachedBootstrap(agentId)
    if (cached) {
      setData(cached); setSource("local-cache"); setError(null); setLoad(false)
    } else {
      setLoad(true)
    }

    let lastError: string | null = null
    // A 4xx that means "this agent definitively does not exist or is
    // no longer active" — used to invalidate stale cache. 401/403 don't
    // count (those are auth-context mismatches; the recover path may
    // still succeed). 410 from post-activation is a window-expiry, NOT
    // a revocation signal — only /recover's 404 is authoritative.
    let definitiveMiss = false

    const tryFetch = async (
      url: string,
      headers: Record<string, string> | undefined,
      src: AgentSessionSource
    ): Promise<boolean> => {
      try {
        const res = await fetch(url, { headers, cache: "no-store" })
        const json = await res.json().catch(() => ({}))
        if (res.ok) {
          const payload = json as AgentBootstrap
          setData(payload); setSource(src); setError(null); setLoad(false)
          cacheAgentBootstrap(agentId, payload)
          return true
        }
        if (src === "recover" && res.status === 404) definitiveMiss = true
        lastError = typeof json?.error === "string" ? json.error : `${src} failed (${res.status})`
        return false
      } catch (e) {
        lastError = e instanceof Error ? e.message : `${src} failed`
        return false
      }
    }

    // ── (b) Owner JWT path ─────────────────────────────────────────
    try {
      const { data: sessionRes } = await supabase.auth.getSession()
      const token = sessionRes.session?.access_token
      if (token) {
        const ok = await tryFetch(
          `/api/agents/bootstrap?agent_id=${encodeURIComponent(agentId)}`,
          { Authorization: `Bearer ${token}` },
          "owner-jwt"
        )
        if (ok) { inflight.current = null; return }
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : "Bootstrap failed"
    }

    // ── (c) Anon post-activation reveal (15-min window) ────────────
    if (await tryFetch(
      `/api/agents/post-activation?agent_id=${encodeURIComponent(agentId)}`,
      undefined,
      "post-activation"
    )) { inflight.current = null; return }

    // ── (d) Anon persistent recover (no window, reduced payload) ───
    if (await tryFetch(
      `/api/agents/recover?agent_id=${encodeURIComponent(agentId)}`,
      undefined,
      "recover"
    )) { inflight.current = null; return }

    // ── All four sources failed ────────────────────────────────────
    // If /recover authoritatively returned 404, the agent is gone or
    // revoked — drop the stale cache so we don't keep showing it.
    if (definitiveMiss) {
      clearCachedBootstrap(agentId)
      setData(null)
      setError(lastError ?? "This agent is no longer active")
    } else if (!cached) {
      setData(null)
      setError(lastError ?? "Unable to load agent context")
    }
    setLoad(false)
    inflight.current = null
  }, [agentId])

  useEffect(() => { void fetchBootstrap() }, [fetchBootstrap])

  const value = useMemo<AgentSessionState>(
    () => ({ data, loading, error, source, refresh: fetchBootstrap }),
    [data, loading, error, source, fetchBootstrap]
  )

  return <AgentSessionContext.Provider value={value}>{children}</AgentSessionContext.Provider>
}

/**
 * Read the current agent's bootstrap payload. Returns `null` data while
 * loading or when called outside a provider — components should null-check.
 */
export function useAgentSession(): AgentSessionState {
  const ctx = useContext(AgentSessionContext)
  if (!ctx) {
    return { data: null, loading: false, error: null, source: null, refresh: async () => {} }
  }
  return ctx
}
