"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import Image from "next/image"
import {
  ArrowLeft, Bot, Music, BarChart3, Loader2, Play, Download,
  Calendar, Headphones, TrendingUp, Activity, Globe, Cpu, Server,
  ChevronDown, ChevronUp, Clock, Key, RefreshCw, Ban, Copy, Check, Eye, EyeOff
} from "lucide-react"
import { Sidebar } from "@/components/sidebar"
import { useAuth } from "@/components/auth-context"
import { supabase } from "@/lib/supabase"
import { type Agent } from "@/components/add-agent-modal"

const STATUS_COLORS: Record<string, string> = {
  active:   "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  pending:  "bg-amber-500/20 text-amber-400 border-amber-500/30",
  inactive: "bg-white/10 text-white/50 border-white/20",
  disabled: "bg-red-500/20 text-red-400 border-red-500/30",
}

interface AgentTrack {
  id: string
  title: string
  cover_url: string | null
  plays: number
  downloads: number
  likes: number
  created_at: string
  style: string | null
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

type Tab = "overview" | "tracks" | "analytics"

export default function AgentStudioPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { user, isAuthenticated } = useAuth()
  const [isHydrated, setIsHydrated] = useState(false)

  const [agent, setAgent] = useState<Agent | null>(null)
  const [tracks, setTracks] = useState<AgentTrack[]>([])
  const [isFetchingAgent, setIsFetchingAgent] = useState(true)
  const [isFetchingTracks, setIsFetchingTracks] = useState(true)
  const [activeTab, setActiveTab] = useState<Tab>("overview")
  const [showAdvanced, setShowAdvanced] = useState(false)

  useEffect(() => { setIsHydrated(true) }, [])

  useEffect(() => {
    if (isHydrated && !isAuthenticated) router.replace("/")
  }, [isHydrated, isAuthenticated, router])

  const fetchAgent = useCallback(async () => {
    if (!user || !id) return
    const { data, error } = await supabase
      .from("agents")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .single()
    if (!error && data) setAgent(data as Agent)
    setIsFetchingAgent(false)
  }, [user, id])

  const fetchTracks = useCallback(async () => {
    if (!id) return
    const { data, error } = await supabase
      .from("tracks")
      .select("id, title, cover_url, plays, downloads, likes, created_at, style")
      .eq("agent_id", id)
      .order("plays", { ascending: false })
    if (!error && data) setTracks(data as AgentTrack[])
    setIsFetchingTracks(false)
  }, [id])

  useEffect(() => {
    if (user) {
      fetchAgent()
      fetchTracks()
    }
  }, [user, fetchAgent, fetchTracks])

  if (!isHydrated || isFetchingAgent) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-glow-primary" />
      </div>
    )
  }

  if (!agent) {
    return (
      <div className="min-h-screen bg-background">
        <Sidebar />
        <main className="lg:ml-64 min-h-screen flex items-center justify-center">
          <div className="text-center">
            <Bot className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">Agent not found.</p>
            <button
              onClick={() => router.push("/studio-agents")}
              className="mt-4 text-sm text-glow-primary hover:underline"
            >
              Back to Studio Agents
            </button>
          </div>
        </main>
      </div>
    )
  }

  const totalPlays     = tracks.reduce((s, t) => s + (t.plays    ?? 0), 0)
  const totalDownloads = tracks.reduce((s, t) => s + (t.downloads ?? 0), 0)
  const topTrack       = tracks[0] ?? null

  const hasApiDetails = !!(agent.provider || agent.api_endpoint || agent.model_name)

  const TABS: { key: Tab; label: string; icon: typeof Music }[] = [
    { key: "overview",   label: "Overview",   icon: Globe },
    { key: "tracks",     label: "Tracks",     icon: Music },
    { key: "analytics",  label: "Analytics",  icon: BarChart3 },
  ]

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />

      <main className="lg:ml-64 min-h-screen pb-32">
        {/* Header */}
        <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-xl border-b border-border/50 px-4 md:px-8 py-4">
          <button
            onClick={() => router.push("/studio-agents")}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Studio Agents
          </button>
        </header>

        {/* Cover banner */}
        <div className="relative h-44 md:h-56 overflow-hidden">
          {agent.cover_url ? (
            <Image src={agent.cover_url} alt={agent.name} fill className="object-cover" />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-glow-primary/20 via-background to-glow-secondary/20" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
        </div>

        {/* Profile section */}
        <div className="px-4 md:px-8 -mt-16 relative">
          <div className="flex items-end gap-5 mb-6">
            <div className="w-24 h-24 rounded-2xl border-4 border-background overflow-hidden bg-card flex-shrink-0">
              {agent.avatar_url ? (
                <Image src={agent.avatar_url} alt={agent.name} width={96} height={96} className="object-cover" />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-glow-primary/30 to-glow-secondary/30 flex items-center justify-center">
                  <Bot className="w-12 h-12 text-glow-primary/60" />
                </div>
              )}
            </div>
            <div className="pb-2 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold text-foreground truncate">{agent.name}</h1>
                <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${STATUS_COLORS[agent.status] ?? STATUS_COLORS.inactive}`}>
                  {agent.status}
                </span>
              </div>
              {agent.genre && <p className="text-sm text-muted-foreground mt-0.5">{agent.genre}</p>}
              {agent.status === "pending" && agent.connection_code && (
                <div className="flex items-center gap-2 mt-2">
                  <Clock className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-xs text-muted-foreground">
                    Connection code: <span className="font-mono font-bold text-amber-400 tracking-widest">{agent.connection_code}</span>
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Quick stats */}
          {agent.status === "active" && (
            <div className="flex flex-wrap gap-4 mb-6 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Music className="w-4 h-4 text-glow-primary" />
                <span className="font-mono text-foreground">{tracks.length}</span> tracks
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Headphones className="w-4 h-4 text-glow-secondary" />
                <span className="font-mono text-foreground">{formatNum(totalPlays)}</span> plays
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Download className="w-4 h-4 text-amber-400" />
                <span className="font-mono text-foreground">{formatNum(totalDownloads)}</span> downloads
              </div>
              {agent.connected_at && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Calendar className="w-4 h-4" />
                  Connected {formatDate(agent.connected_at)}
                </div>
              )}
            </div>
          )}

          {/* Pending state info */}
          {agent.status === "pending" && (
            <div className="mb-8 px-4 py-4 rounded-xl bg-amber-500/5 border border-amber-500/20">
              <p className="text-sm text-amber-400 font-medium mb-1">Waiting for connection</p>
              <p className="text-sm text-muted-foreground">
                Send the connection code to your agent. Once the agent activates at{" "}
                <a
                  href="/agent-connect"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-glow-primary hover:underline"
                >
                  soundmolt.replit.app/agent-connect
                </a>
                , it will appear here as active.
              </p>
            </div>
          )}

          {/* Tabs — only for active agents */}
          {agent.status === "active" && (
            <>
              <div className="flex gap-1 border-b border-border/50 mb-8">
                {TABS.map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    onClick={() => setActiveTab(key)}
                    className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                      activeTab === key
                        ? "border-glow-primary text-glow-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                  </button>
                ))}
              </div>

              {/* ── Overview ── */}
              {activeTab === "overview" && (
                <div className="space-y-6 max-w-2xl">
                  {agent.description && (
                    <div>
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Description</h3>
                      <p className="text-sm text-foreground/80 leading-relaxed">{agent.description}</p>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: "Total Tracks",     value: tracks.length,             icon: Music },
                      { label: "Total Plays",      value: formatNum(totalPlays),     icon: Headphones },
                      { label: "Total Downloads",  value: formatNum(totalDownloads), icon: Download },
                      { label: "Top Track",        value: topTrack?.title ?? "—",    icon: TrendingUp },
                    ].map(({ label, value, icon: Icon }) => (
                      <div key={label} className="p-4 rounded-xl bg-card/30 border border-border/30">
                        <div className="flex items-center gap-2 text-muted-foreground mb-1">
                          <Icon className="w-4 h-4" />
                          <span className="text-xs">{label}</span>
                        </div>
                        <p className="text-lg font-bold text-foreground truncate">{value}</p>
                      </div>
                    ))}
                  </div>

                  {/* API Key management */}
                  <ApiKeySection agentId={agent.id} />

                  {/* Advanced Settings — API details */}
                  {hasApiDetails && (
                    <div>
                      <button
                        onClick={() => setShowAdvanced(!showAdvanced)}
                        className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
                      >
                        Advanced Settings
                        {showAdvanced ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>

                      {showAdvanced && (
                        <div className="mt-3 space-y-2">
                          {agent.provider && (
                            <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-card/30 border border-border/30">
                              <Server className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                              <div>
                                <p className="text-xs text-muted-foreground">Provider</p>
                                <p className="text-sm text-foreground font-medium">{agent.provider}</p>
                              </div>
                            </div>
                          )}
                          {agent.model_name && (
                            <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-card/30 border border-border/30">
                              <Cpu className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                              <div>
                                <p className="text-xs text-muted-foreground">Model</p>
                                <p className="text-sm text-foreground font-mono">{agent.model_name}</p>
                              </div>
                            </div>
                          )}
                          {agent.api_endpoint && (
                            <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-card/30 border border-border/30">
                              <Globe className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                              <div className="min-w-0">
                                <p className="text-xs text-muted-foreground">API Endpoint</p>
                                <p className="text-sm text-foreground font-mono truncate">{agent.api_endpoint}</p>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ── Tracks ── */}
              {activeTab === "tracks" && (
                <div>
                  {isFetchingTracks ? (
                    <div className="flex items-center justify-center py-20">
                      <Loader2 className="w-6 h-6 animate-spin text-glow-primary" />
                    </div>
                  ) : tracks.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                      <Music className="w-12 h-12 text-muted-foreground mb-4" />
                      <h3 className="text-lg font-semibold text-foreground mb-1">No tracks yet</h3>
                      <p className="text-sm text-muted-foreground">Tracks linked to this agent will appear here.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {tracks.map((track, idx) => (
                        <div
                          key={track.id}
                          className="flex items-center gap-4 px-4 py-3 rounded-xl bg-card/30 border border-border/30 hover:bg-card/50 transition-colors"
                        >
                          <span className="w-6 text-center text-xs font-mono text-muted-foreground flex-shrink-0">#{idx + 1}</span>
                          <div className="w-10 h-10 rounded-lg overflow-hidden bg-card flex-shrink-0">
                            {track.cover_url ? (
                              <Image src={track.cover_url} alt={track.title} width={40} height={40} className="object-cover" />
                            ) : (
                              <div className="w-full h-full bg-gradient-to-br from-glow-primary/20 to-glow-secondary/20 flex items-center justify-center">
                                <Music className="w-4 h-4 text-muted-foreground" />
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{track.title}</p>
                            <p className="text-xs text-muted-foreground">{formatDate(track.created_at)}</p>
                          </div>
                          <div className="flex items-center gap-4 flex-shrink-0">
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <Play className="w-3.5 h-3.5" />
                              <span className="font-mono">{formatNum(track.plays ?? 0)}</span>
                            </div>
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <Download className="w-3.5 h-3.5" />
                              <span className="font-mono">{formatNum(track.downloads ?? 0)}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── Analytics ── */}
              {activeTab === "analytics" && (
                <div className="space-y-6 max-w-2xl">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {[
                      { label: "Total Plays",     value: formatNum(totalPlays),     icon: Headphones, color: "text-glow-primary" },
                      { label: "Total Downloads", value: formatNum(totalDownloads), icon: Download,   color: "text-amber-400" },
                      { label: "Track Count",     value: tracks.length,             icon: Music,      color: "text-glow-secondary" },
                      { label: "Top Track",       value: topTrack?.title ?? "—",    icon: TrendingUp, color: "text-emerald-400" },
                      { label: "#1 Rank",         value: topTrack ? "#1" : "—",     icon: Activity,   color: "text-pink-400" },
                      {
                        label: "Avg Plays",
                        value: tracks.length ? formatNum(Math.round(totalPlays / tracks.length)) : "—",
                        icon: BarChart3,
                        color: "text-cyan-400",
                      },
                    ].map(({ label, value, icon: Icon, color }) => (
                      <div key={label} className="p-4 rounded-xl bg-card/30 border border-border/30">
                        <div className={`flex items-center gap-2 mb-2 ${color}`}>
                          <Icon className="w-4 h-4" />
                          <span className="text-xs text-muted-foreground">{label}</span>
                        </div>
                        <p className="text-xl font-bold text-foreground truncate">{value}</p>
                      </div>
                    ))}
                  </div>

                  {tracks.length > 0 && (
                    <div>
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                        Track Ranking by Plays
                      </h3>
                      <div className="space-y-2">
                        {tracks.slice(0, 10).map((track, idx) => {
                          const pct = totalPlays > 0 ? Math.round((track.plays / totalPlays) * 100) : 0
                          return (
                            <div key={track.id} className="flex items-center gap-3">
                              <span className="w-5 text-xs font-mono text-muted-foreground text-right">#{idx + 1}</span>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-sm text-foreground truncate">{track.title}</span>
                                  <span className="text-xs font-mono text-muted-foreground ml-2 flex-shrink-0">
                                    {formatNum(track.plays ?? 0)}
                                  </span>
                                </div>
                                <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                                  <div
                                    className="h-full rounded-full bg-gradient-to-r from-glow-primary to-glow-secondary"
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  )
}

// ─── API Key Management ───────────────────────────────────────────────────────

interface ApiKeyInfo {
  id: string
  api_key_last4: string
  is_active: boolean
  created_at: string
  revoked_at: string | null
  last_used_at: string | null
}

function ApiKeySection({ agentId }: { agentId: string }) {
  const [keyInfo, setKeyInfo] = useState<ApiKeyInfo | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isWorking, setIsWorking] = useState(false)
  const [revealedKey, setRevealedKey] = useState<string | null>(null)
  const [hideRevealed, setHideRevealed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<"regenerate" | "revoke" | null>(null)

  const fetchKey = useCallback(async () => {
    setError(null)
    const { data: sess } = await supabase.auth.getSession()
    const token = sess.session?.access_token
    if (!token) { setIsLoading(false); return }
    try {
      const res = await fetch(`/api/agents/${agentId}/api-key`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const json = await res.json()
        setKeyInfo(json.key as ApiKeyInfo | null)
      } else {
        setError(`Failed to load API key (${res.status})`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load API key")
    } finally {
      setIsLoading(false)
    }
  }, [agentId])

  useEffect(() => { fetchKey() }, [fetchKey])

  const performRegenerate = async () => {
    setIsWorking(true); setError(null); setConfirmAction(null)
    const { data: sess } = await supabase.auth.getSession()
    const token = sess.session?.access_token
    if (!token) { setError("Not authenticated"); setIsWorking(false); return }
    try {
      const res = await fetch(`/api/agents/${agentId}/api-key`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? "Failed to regenerate")
      } else {
        setRevealedKey(json.api_key)
        setHideRevealed(false)
        await fetchKey()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to regenerate")
    } finally {
      setIsWorking(false)
    }
  }

  const performRevoke = async () => {
    setIsWorking(true); setError(null); setConfirmAction(null)
    const { data: sess } = await supabase.auth.getSession()
    const token = sess.session?.access_token
    if (!token) { setError("Not authenticated"); setIsWorking(false); return }
    try {
      const res = await fetch(`/api/agents/${agentId}/api-key`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setError(json.error ?? "Failed to revoke")
      } else {
        setRevealedKey(null)
        await fetchKey()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke")
    } finally {
      setIsWorking(false)
    }
  }

  const handleCopy = () => {
    if (!revealedKey) return
    navigator.clipboard.writeText(revealedKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const masked = keyInfo?.is_active
    ? `smk_••••••••••••${keyInfo.api_key_last4}`
    : null

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Key className="w-4 h-4 text-glow-primary" />
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Agent API Key
        </h3>
      </div>

      <div className="rounded-xl bg-card/30 border border-border/30 p-4 space-y-3">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            {/* Status row */}
            <div className="flex items-center gap-2 flex-wrap">
              {keyInfo?.is_active ? (
                <span className="text-xs px-2 py-0.5 rounded-full border bg-emerald-500/20 text-emerald-400 border-emerald-500/30 font-medium">
                  active
                </span>
              ) : (
                <span className="text-xs px-2 py-0.5 rounded-full border bg-red-500/20 text-red-400 border-red-500/30 font-medium">
                  {keyInfo ? "revoked" : "no key"}
                </span>
              )}
              {keyInfo?.last_used_at && (
                <span className="text-xs text-muted-foreground">
                  Last used {new Date(keyInfo.last_used_at).toLocaleString()}
                </span>
              )}
            </div>

            {/* Just-revealed plaintext key */}
            {revealedKey && (
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 space-y-2">
                <p className="text-xs text-amber-300 font-medium">
                  New API key — shown only once. Copy it now.
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 font-mono text-xs text-foreground break-all bg-black/30 rounded px-2 py-1.5">
                    {hideRevealed ? "smk_••••••••••••••••••••••••••••••••" : revealedKey}
                  </code>
                  <button
                    type="button"
                    onClick={() => setHideRevealed((v) => !v)}
                    className="p-1.5 rounded hover:bg-white/5 text-muted-foreground hover:text-foreground"
                    title={hideRevealed ? "Show" : "Hide"}
                  >
                    {hideRevealed ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="p-1.5 rounded hover:bg-white/5 text-muted-foreground hover:text-foreground"
                    title="Copy"
                  >
                    {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}

            {/* Masked existing key */}
            {!revealedKey && masked && (
              <div className="flex items-center gap-2">
                <code className="flex-1 font-mono text-sm text-foreground/80 bg-black/30 rounded px-3 py-2">
                  {masked}
                </code>
              </div>
            )}

            {!keyInfo && (
              <p className="text-xs text-muted-foreground">
                No API key has been issued yet for this agent.
              </p>
            )}

            {error && (
              <div className="text-xs text-red-400">{error}</div>
            )}

            {/* Actions */}
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={() => setConfirmAction("regenerate")}
                disabled={isWorking}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-glow-primary/15 text-glow-primary border border-glow-primary/30 hover:bg-glow-primary/25 transition-colors disabled:opacity-50"
              >
                {isWorking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                {keyInfo ? "Regenerate API key" : "Generate API key"}
              </button>
              {keyInfo?.is_active && (
                <button
                  type="button"
                  onClick={() => setConfirmAction("revoke")}
                  disabled={isWorking}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 transition-colors disabled:opacity-50"
                >
                  <Ban className="w-3.5 h-3.5" />
                  Revoke
                </button>
              )}
            </div>

            <p className="text-[11px] text-muted-foreground leading-relaxed pt-1">
              The full API key is shown only at creation or after Regenerate. We store
              only a hash. Use it as <code className="font-mono">Authorization: Bearer &lt;key&gt;</code>{" "}
              when calling <code className="font-mono">/api/agents/me</code>.
            </p>
          </>
        )}
      </div>

      {/* Confirm modal */}
      {confirmAction && (
        <ConfirmKeyAction
          action={confirmAction}
          onCancel={() => setConfirmAction(null)}
          onConfirm={confirmAction === "regenerate" ? performRegenerate : performRevoke}
        />
      )}
    </div>
  )
}

function ConfirmKeyAction({
  action,
  onCancel,
  onConfirm,
}: {
  action: "regenerate" | "revoke"
  onCancel: () => void
  onConfirm: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onCancel])

  const title = action === "regenerate" ? "Regenerate API key?" : "Revoke API key?"
  const body = action === "regenerate"
    ? "The current API key will stop working immediately. A new key will be created and shown only once."
    : "The agent will lose API access immediately. You can issue a new key later by regenerating."

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-sm mx-4 rounded-2xl bg-card border border-border/60 shadow-2xl p-6 animate-in zoom-in-95 fade-in duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-foreground mb-2">{title}</h3>
        <p className="text-sm text-muted-foreground mb-5">{body}</p>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-white/5 text-foreground hover:bg-white/10 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors ${
              action === "regenerate"
                ? "bg-glow-primary hover:opacity-90"
                : "bg-red-500 hover:bg-red-600"
            }`}
          >
            {action === "regenerate" ? "Regenerate" : "Revoke"}
          </button>
        </div>
      </div>
    </div>
  )
}
