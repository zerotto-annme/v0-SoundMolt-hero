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
}

interface AgentSessionState {
  data:    AgentBootstrap | null
  loading: boolean
  error:   string | null
  /** Where the current `data` came from. `null` while loading or unloaded. */
  source:  "session-cache" | "owner-jwt" | "post-activation" | null
  refresh: () => Promise<void>
}

const AgentSessionContext = createContext<AgentSessionState | null>(null)

interface ProviderProps {
  /** Agent UUID to bootstrap. When null/undefined the provider stays idle. */
  agentId: string | null | undefined
  children: ReactNode
}

const sessionKey = (agentId: string) => `soundmolt:agent-session:${agentId}`

/** Persist a successful bootstrap so it survives reloads + tab dwell. */
export function cacheAgentBootstrap(agentId: string, payload: AgentBootstrap) {
  if (typeof window === "undefined") return
  try {
    sessionStorage.setItem(sessionKey(agentId), JSON.stringify(payload))
  } catch {
    /* sessionStorage may be disabled (private mode, quota). Non-fatal. */
  }
}

function readCachedBootstrap(agentId: string): AgentBootstrap | null {
  if (typeof window === "undefined") return null
  try {
    const raw = sessionStorage.getItem(sessionKey(agentId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as AgentBootstrap
    return parsed && parsed.agent_id === agentId ? parsed : null
  } catch {
    return null
  }
}

/**
 * AgentSessionProvider
 *
 * The agent dashboard can be opened by two distinct callers:
 *
 *   1. The studio owner (has a Supabase user JWT) — the canonical path.
 *   2. The agent itself, immediately after activation on /agent-connect
 *      (anonymous browser session — no Supabase user account exists).
 *
 * To support both we resolve the bootstrap in this priority order:
 *
 *   a. `sessionStorage` cache populated by /agent-connect or a previous
 *      successful fetch — instant hydrate so the UI never shows a
 *      reconnect screen on tab reload.
 *   b. `GET /api/agents/bootstrap` with the owner's Supabase JWT.
 *   c. `GET /api/agents/post-activation` — anonymous, but only succeeds
 *      within 15 min of activation. This is the agent-side path.
 *
 * We only surface an error if all three fail, which prevents the
 * "No active Supabase session" dead-end the previous version threw
 * for newly-activated agents.
 */
export function AgentSessionProvider({ agentId, children }: ProviderProps) {
  const [data, setData]     = useState<AgentBootstrap | null>(null)
  const [loading, setLoad]  = useState<boolean>(true)
  const [error, setError]   = useState<string | null>(null)
  const [source, setSource] = useState<AgentSessionState["source"]>(null)

  // Avoid double-fetching under StrictMode.
  const inflight = useRef<string | null>(null)

  const fetchBootstrap = useCallback(async () => {
    if (!agentId) {
      setData(null); setError(null); setLoad(false); setSource(null)
      return
    }
    if (inflight.current === agentId) return
    inflight.current = agentId

    // ── Step 1: hydrate from sessionStorage immediately ─────────────
    // This is what unblocks the post-activation handoff from
    // /agent-connect → /agent-dashboard. The page renders with real
    // data while step 2/3 revalidate in the background.
    const cached = readCachedBootstrap(agentId)
    if (cached) {
      setData(cached); setSource("session-cache"); setError(null); setLoad(false)
    } else {
      setLoad(true)
    }

    let lastError: string | null = null

    // ── Step 2: try owner JWT bootstrap ─────────────────────────────
    try {
      const { data: sessionRes } = await supabase.auth.getSession()
      const token = sessionRes.session?.access_token
      if (token) {
        const res = await fetch(
          `/api/agents/bootstrap?agent_id=${encodeURIComponent(agentId)}`,
          { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
        )
        const json = await res.json().catch(() => ({}))
        if (res.ok) {
          const payload = json as AgentBootstrap
          setData(payload); setSource("owner-jwt"); setError(null); setLoad(false)
          cacheAgentBootstrap(agentId, payload)
          inflight.current = null
          return
        }
        // 401/403 here is expected when the JWT belongs to a different
        // user (or anon). Fall through to post-activation rather than
        // surfacing it as a fatal error.
        lastError = typeof json?.error === "string" ? json.error : `Bootstrap failed (${res.status})`
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : "Bootstrap failed"
    }

    // ── Step 3: anon post-activation reveal (15-min window) ─────────
    try {
      const res = await fetch(
        `/api/agents/post-activation?agent_id=${encodeURIComponent(agentId)}`,
        { cache: "no-store" }
      )
      const json = await res.json().catch(() => ({}))
      if (res.ok) {
        const payload = json as AgentBootstrap
        setData(payload); setSource("post-activation"); setError(null); setLoad(false)
        cacheAgentBootstrap(agentId, payload)
        inflight.current = null
        return
      }
      // 410 Gone (window expired) is the most common failure here.
      lastError = typeof json?.error === "string" ? json.error : lastError ?? `Reveal failed (${res.status})`
    } catch (e) {
      lastError = lastError ?? (e instanceof Error ? e.message : "Reveal failed")
    }

    // ── All three sources failed ────────────────────────────────────
    // If we already have cached data we keep showing it (stale-but-
    // useful) and just surface the revalidation error quietly.
    if (!cached) {
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
