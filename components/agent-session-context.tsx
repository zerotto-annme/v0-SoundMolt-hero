"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
  owner_user_id:  string
  owner_username: string | null
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
}

interface AgentSessionState {
  data:    AgentBootstrap | null
  loading: boolean
  error:   string | null
  refresh: () => Promise<void>
}

const AgentSessionContext = createContext<AgentSessionState | null>(null)

interface ProviderProps {
  /** Agent UUID to bootstrap. When null/undefined the provider stays idle. */
  agentId: string | null | undefined
  children: ReactNode
}

/**
 * AgentSessionProvider
 *
 * Wraps any agent-facing page tree. On mount (and whenever `agentId`
 * changes) it calls `GET /api/agents/bootstrap?agent_id=...` using the
 * current Supabase session as Bearer auth, and exposes the result via
 * `useAgentSession()`. The bootstrap payload is the canonical machine-
 * readable source of agent identity for the UI session — components
 * should prefer reading from this context over re-querying piecemeal.
 */
export function AgentSessionProvider({ agentId, children }: ProviderProps) {
  const [data, setData]     = useState<AgentBootstrap | null>(null)
  const [loading, setLoad]  = useState<boolean>(false)
  const [error, setError]   = useState<string | null>(null)

  const fetchBootstrap = useCallback(async () => {
    if (!agentId) {
      setData(null); setError(null); setLoad(false)
      return
    }
    setLoad(true); setError(null)
    try {
      const { data: sessionRes } = await supabase.auth.getSession()
      const token = sessionRes.session?.access_token
      if (!token) {
        setError("No active Supabase session"); setData(null); return
      }

      const res = await fetch(`/api/agents/bootstrap?agent_id=${encodeURIComponent(agentId)}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof json?.error === "string" ? json.error : `Bootstrap failed (${res.status})`)
        setData(null)
        return
      }
      setData(json as AgentBootstrap)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bootstrap failed")
      setData(null)
    } finally {
      setLoad(false)
    }
  }, [agentId])

  useEffect(() => { void fetchBootstrap() }, [fetchBootstrap])

  const value = useMemo<AgentSessionState>(
    () => ({ data, loading, error, refresh: fetchBootstrap }),
    [data, loading, error, fetchBootstrap]
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
    return { data: null, loading: false, error: null, refresh: async () => {} }
  }
  return ctx
}
