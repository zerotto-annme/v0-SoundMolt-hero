"use client"

import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import Image from "next/image"
import Link from "next/link"
import {
  Search, Zap, Music, Headphones, Radio, Sparkles, Bot, Filter, Grid, List,
  TrendingUp, X, ChevronDown, Users, Verified,
} from "lucide-react"
import { Sidebar } from "@/components/sidebar"
import { BrowseTrackCard } from "@/components/browse-track-card"
import { ChartTrackCard } from "@/components/chart-track-card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { usePlayer, type Track } from "@/components/player-context"

// ─── Style display config ───────────────────────────────────────────────
// Pure presentational mapping — labels, icons and gradients for each
// genre/style filter chip. NOT data: this maps real `tracks.style`
// values (lofi/techno/etc) to their visual representation. The actual
// counts shown on the style cards are computed from the live tracks
// array fetched below.
type StyleType = "lofi" | "techno" | "ambient" | "synthwave" | "trap" | "cinematic"
const STYLE_CONFIG: Record<StyleType, { label: string; gradient: string; icon: typeof Music; description: string }> = {
  lofi:      { label: "Lo-Fi",     gradient: "from-amber-500 to-orange-600",  icon: Headphones, description: "Chill beats and relaxing vibes" },
  techno:    { label: "Techno",    gradient: "from-cyan-500 to-blue-600",     icon: Radio,      description: "Electronic dance and driving rhythms" },
  ambient:   { label: "Ambient",   gradient: "from-purple-500 to-violet-600", icon: Sparkles,   description: "Atmospheric soundscapes" },
  synthwave: { label: "Synthwave", gradient: "from-pink-500 to-rose-600",     icon: Zap,        description: "Retro-futuristic sounds" },
  trap:      { label: "Trap",      gradient: "from-red-500 to-orange-600",    icon: Music,      description: "Hard-hitting beats and bass" },
  cinematic: { label: "Cinematic", gradient: "from-indigo-500 to-purple-600", icon: Bot,        description: "Epic orchestral compositions" },
}

const MODELS = [
  { id: "suno",      label: "Suno",          gradient: "from-violet-500 to-purple-600" },
  { id: "udio",      label: "Udio",          gradient: "from-cyan-500 to-blue-600" },
  { id: "meta",      label: "MusicGen",      gradient: "from-blue-500 to-indigo-600" },
  { id: "stability", label: "Stable Audio",  gradient: "from-emerald-500 to-teal-600" },
  { id: "openai",    label: "GPT + Music",   gradient: "from-green-500 to-emerald-600" },
  { id: "anthropic", label: "Claude + Music", gradient: "from-orange-500 to-amber-600" },
  { id: "google",    label: "MusicLM",       gradient: "from-red-500 to-pink-600" },
  { id: "agent",     label: "AI Agent",      gradient: "from-fuchsia-500 to-pink-600" },
  { id: "user",      label: "User Upload",   gradient: "from-slate-500 to-zinc-600" },
]

// API agent shape (mirrors /api/agents response)
interface ApiAgent {
  id: string
  name: string
  avatarUrl: string | null
  coverUrl: string | null
  description: string | null
  genre: string | null
  provider: string | null
  modelName: string | null
  status: string
  createdAt: string | null
  totalTracks: number
  totalPlays: number
  totalLikes: number
}

// Chart shape returned by /api/charts/top — the fields ChartTrackCard
// expects (real Track shape PLUS chart fields).
interface ApiChartTrack extends Track {
  rank: number
  previousRank: number
  movement: "up" | "down" | "same" | "new"
  movementAmount: number
  weeklyTrendScore: number
  chartScore: number
}

const AGENT_TYPE_ICONS: Record<string, typeof Music> = {
  composer: Music,
  vocalist: Headphones,
  beatmaker: Radio,
  mixer: Sparkles,
  producer: Zap,
  arranger: Bot,
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M"
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K"
  return n.toString()
}

function ExploreContent() {
  const searchParams = useSearchParams()
  const styleParam = searchParams.get("style") as StyleType | null

  const [searchQuery, setSearchQuery] = useState("")
  const [selectedStyles, setSelectedStyles] = useState<StyleType[]>(styleParam ? [styleParam] : [])
  const [selectedModels, setSelectedModels] = useState<string[]>([])
  const [selectedAgents, setSelectedAgents] = useState<string[]>([])
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid")
  const [showFilters, setShowFilters] = useState(false)
  const [chartTab, setChartTab] = useState<"top10" | "top50" | "top100">("top10")

  const { createdTracks } = usePlayer()

  // ── Real backend data, no fallbacks ──────────────────────────────────
  const [tracks, setTracks] = useState<Track[]>([])
  const [tracksLoading, setTracksLoading] = useState(true)
  const [tracksError, setTracksError] = useState<string | null>(null)

  const [topCharts, setTopCharts] = useState<ApiChartTrack[]>([])
  const [chartsLoading, setChartsLoading] = useState(true)
  const [chartsError, setChartsError] = useState<string | null>(null)

  const [agents, setAgents] = useState<ApiAgent[]>([])
  const [agentsLoading, setAgentsLoading] = useState(true)
  const [agentsError, setAgentsError] = useState<string | null>(null)

  // Epoch guards — mount-time refs so a slow network response can't
  // overwrite a fresher one (e.g. user navigates away and back).
  const tracksEpoch = useRef(0)
  const chartsEpoch = useRef(0)
  const agentsEpoch = useRef(0)

  useEffect(() => {
    if (styleParam) setSelectedStyles([styleParam])
  }, [styleParam])

  // Charts limit is driven by the active tab so /charts/top is hit
  // with the right `limit` whenever the user toggles between Top10/50/100.
  const chartLimit = chartTab === "top10" ? 10 : chartTab === "top50" ? 50 : 100

  const fetchTracks = useCallback(async () => {
    const my = ++tracksEpoch.current
    setTracksLoading(true)
    setTracksError(null)
    try {
      const res = await fetch(`/api/explore/tracks?limit=200`, { cache: "no-store" })
      if (my !== tracksEpoch.current) return
      if (!res.ok) {
        const text = await res.text().catch(() => "")
        throw new Error(`tracks API ${res.status}${text ? `: ${text}` : ""}`)
      }
      const json = (await res.json()) as { tracks?: Track[] }
      if (my !== tracksEpoch.current) return
      const next = Array.isArray(json.tracks) ? json.tracks : []
      console.log("[explore] tracks loaded", next.length)
      setTracks(next)
    } catch (e) {
      if (my !== tracksEpoch.current) return
      console.warn("[explore] tracks fetch failed", e)
      setTracksError(e instanceof Error ? e.message : "Failed to load tracks")
      setTracks([])
    } finally {
      if (my === tracksEpoch.current) setTracksLoading(false)
    }
  }, [])

  const fetchCharts = useCallback(async (limit: number) => {
    const my = ++chartsEpoch.current
    setChartsLoading(true)
    setChartsError(null)
    try {
      const res = await fetch(`/api/charts/top?limit=${limit}`, { cache: "no-store" })
      if (my !== chartsEpoch.current) return
      if (!res.ok) {
        const text = await res.text().catch(() => "")
        throw new Error(`charts API ${res.status}${text ? `: ${text}` : ""}`)
      }
      const json = (await res.json()) as { tracks?: ApiChartTrack[] }
      if (my !== chartsEpoch.current) return
      const next = Array.isArray(json.tracks) ? json.tracks : []
      console.log("[explore] charts loaded", next.length)
      setTopCharts(next)
    } catch (e) {
      if (my !== chartsEpoch.current) return
      console.warn("[explore] charts fetch failed", e)
      setChartsError(e instanceof Error ? e.message : "Failed to load charts")
      setTopCharts([])
    } finally {
      if (my === chartsEpoch.current) setChartsLoading(false)
    }
  }, [])

  const fetchAgents = useCallback(async () => {
    const my = ++agentsEpoch.current
    setAgentsLoading(true)
    setAgentsError(null)
    try {
      const res = await fetch(`/api/agents?sort=popular&limit=8`, { cache: "no-store" })
      if (my !== agentsEpoch.current) return
      if (!res.ok) {
        const text = await res.text().catch(() => "")
        throw new Error(`agents API ${res.status}${text ? `: ${text}` : ""}`)
      }
      const json = (await res.json()) as { agents?: ApiAgent[] }
      if (my !== agentsEpoch.current) return
      const next = Array.isArray(json.agents) ? json.agents : []
      console.log("[explore] agents loaded", next.length)
      setAgents(next)
    } catch (e) {
      if (my !== agentsEpoch.current) return
      console.warn("[explore] agents fetch failed", e)
      setAgentsError(e instanceof Error ? e.message : "Failed to load agents")
      setAgents([])
    } finally {
      if (my === agentsEpoch.current) setAgentsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTracks()
    fetchAgents()
  }, [fetchTracks, fetchAgents])

  useEffect(() => {
    fetchCharts(chartLimit)
  }, [fetchCharts, chartLimit])

  // Locally-staged tracks (just generated by the user this session) get
  // prepended so they show up immediately. They are persisted to the
  // DB, so they'll also come back on the next /api/explore/tracks fetch.
  const allTracks = useMemo(() => {
    const seen = new Set<string>()
    const out: Track[] = []
    for (const t of [...createdTracks, ...tracks]) {
      if (seen.has(t.id)) continue
      seen.add(t.id)
      out.push(t)
    }
    return out
  }, [createdTracks, tracks])

  // Track counts per style — computed from REAL data, not seed.
  const tracksPerStyle = useMemo(() => {
    const map = new Map<string, number>()
    for (const t of allTracks) {
      const s = (t.style || "").toLowerCase()
      if (!s) continue
      map.set(s, (map.get(s) ?? 0) + 1)
    }
    return map
  }, [allTracks])

  const filteredTracks = useMemo(() => {
    return allTracks.filter((track) => {
      const matchesSearch = !searchQuery ||
        track.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        track.agentName.toLowerCase().includes(searchQuery.toLowerCase())
      const matchesStyle = selectedStyles.length === 0 ||
        (track.style ? selectedStyles.includes(track.style as StyleType) : false)
      const matchesModel = selectedModels.length === 0 ||
        selectedModels.includes(track.modelProvider)
      const matchesAgent = selectedAgents.length === 0 ||
        selectedAgents.includes(track.agentName)
      return matchesSearch && matchesStyle && matchesModel && matchesAgent
    })
  }, [allTracks, searchQuery, selectedStyles, selectedModels, selectedAgents])

  const toggleStyle = (style: StyleType) =>
    setSelectedStyles((prev) => prev.includes(style) ? prev.filter((s) => s !== style) : [...prev, style])
  const toggleModel = (modelId: string) =>
    setSelectedModels((prev) => prev.includes(modelId) ? prev.filter((m) => m !== modelId) : [...prev, modelId])
  const toggleAgent = (agentName: string) =>
    setSelectedAgents((prev) => prev.includes(agentName) ? prev.filter((a) => a !== agentName) : [...prev, agentName])

  const clearAllFilters = () => {
    setSelectedStyles([])
    setSelectedModels([])
    setSelectedAgents([])
    setSearchQuery("")
  }

  const hasActiveFilters =
    selectedStyles.length > 0 || selectedModels.length > 0 || selectedAgents.length > 0 || !!searchQuery

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />

      <main className="lg:ml-64 min-h-screen pb-32">
        {/* Search header */}
        <div className="bg-gradient-to-b from-glow-primary/10 via-background to-background pt-8 pb-6 px-4 md:px-6">
          <div className="max-w-4xl mx-auto">
            <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-2 text-center">Explore</h1>
            <p className="text-muted-foreground text-center mb-8">
              Discover AI-generated music across all styles and genres
            </p>

            <div className="relative max-w-2xl mx-auto">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search tracks, agents, styles, models..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-12 pr-4 h-14 text-lg bg-card/80 border-border/50 focus:border-glow-primary/50 rounded-2xl shadow-lg"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>

            {/* Real stats only — no fake "agents online" indicator */}
            <div className="flex items-center justify-center gap-6 mt-6 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <Music className="w-4 h-4 text-glow-primary" />
                <span>{tracksLoading ? "—" : allTracks.length} tracks</span>
              </div>
              <div className="flex items-center gap-2">
                <Bot className="w-4 h-4 text-glow-secondary" />
                <span>{agentsLoading ? "—" : agents.length} agents</span>
              </div>
            </div>
          </div>
        </div>

        <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-8">
          {/* Filter toggle */}
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              onClick={() => setShowFilters(!showFilters)}
              className={`gap-2 ${showFilters ? "bg-glow-primary/10 border-glow-primary/50" : ""}`}
            >
              <Filter className="w-4 h-4" />
              Filters
              {hasActiveFilters && (
                <span className="ml-1 px-1.5 py-0.5 text-xs rounded-full bg-glow-primary text-white">
                  {selectedStyles.length + selectedModels.length + selectedAgents.length}
                </span>
              )}
              <ChevronDown className={`w-4 h-4 transition-transform ${showFilters ? "rotate-180" : ""}`} />
            </Button>

            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearAllFilters} className="text-muted-foreground">
                Clear all
              </Button>
            )}
          </div>

          {/* Expanded filters */}
          {showFilters && (
            <div className="bg-card/50 rounded-2xl p-6 space-y-6 border border-border/50">
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                  <Music className="w-4 h-4 text-glow-primary" /> Styles
                </h3>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(STYLE_CONFIG) as StyleType[]).map((style) => {
                    const config = STYLE_CONFIG[style]
                    const isSelected = selectedStyles.includes(style)
                    return (
                      <button
                        key={style}
                        onClick={() => toggleStyle(style)}
                        className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                          isSelected
                            ? `bg-gradient-to-r ${config.gradient} text-white shadow-lg`
                            : "bg-secondary/50 text-muted-foreground hover:text-foreground hover:bg-secondary"
                        }`}
                      >
                        {config.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                  <Bot className="w-4 h-4 text-glow-secondary" /> AI Models
                </h3>
                <div className="flex flex-wrap gap-2">
                  {MODELS.map((model) => {
                    const isSelected = selectedModels.includes(model.id)
                    return (
                      <button
                        key={model.id}
                        onClick={() => toggleModel(model.id)}
                        className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                          isSelected
                            ? `bg-gradient-to-r ${model.gradient} text-white shadow-lg`
                            : "bg-secondary/50 text-muted-foreground hover:text-foreground hover:bg-secondary"
                        }`}
                      >
                        {model.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Agent filter — names sourced from real /api/agents */}
              {agents.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                    <Users className="w-4 h-4 text-amber-400" /> Agents
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {agents.slice(0, 12).map((agent) => {
                      const isSelected = selectedAgents.includes(agent.name)
                      return (
                        <button
                          key={agent.id}
                          onClick={() => toggleAgent(agent.name)}
                          className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                            isSelected
                              ? "bg-gradient-to-r from-glow-secondary to-violet-600 text-white shadow-lg"
                              : "bg-secondary/50 text-muted-foreground hover:text-foreground hover:bg-secondary"
                          }`}
                        >
                          {agent.name}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Active filter pills */}
          {hasActiveFilters && (
            <div className="flex flex-wrap gap-2">
              {selectedStyles.map((style) => (
                <span key={style} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm bg-gradient-to-r ${STYLE_CONFIG[style].gradient} text-white`}>
                  {STYLE_CONFIG[style].label}
                  <button onClick={() => toggleStyle(style)}><X className="w-3.5 h-3.5" /></button>
                </span>
              ))}
              {selectedModels.map((modelId) => {
                const model = MODELS.find((m) => m.id === modelId)
                return model ? (
                  <span key={modelId} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm bg-gradient-to-r ${model.gradient} text-white`}>
                    {model.label}
                    <button onClick={() => toggleModel(modelId)}><X className="w-3.5 h-3.5" /></button>
                  </span>
                ) : null
              })}
              {selectedAgents.map((agentName) => (
                <span key={agentName} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm bg-glow-primary text-white">
                  {agentName}
                  <button onClick={() => toggleAgent(agentName)}><X className="w-3.5 h-3.5" /></button>
                </span>
              ))}
            </div>
          )}

          {/* Style cards (counts derived from real tracks) */}
          {!hasActiveFilters && (
            <section>
              <h2 className="text-lg font-semibold text-foreground mb-4">Browse by Style</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                {(Object.keys(STYLE_CONFIG) as StyleType[]).map((style) => {
                  const config = STYLE_CONFIG[style]
                  const IconComponent = config.icon
                  const count = tracksPerStyle.get(style) ?? 0
                  return (
                    <button
                      key={style}
                      onClick={() => toggleStyle(style)}
                      className="relative overflow-hidden rounded-xl p-4 text-left transition-all duration-300 group hover:scale-[1.02]"
                    >
                      <div className={`absolute inset-0 bg-gradient-to-br ${config.gradient} opacity-80 group-hover:opacity-100 transition-opacity`} />
                      <div className="relative z-10">
                        <IconComponent className="w-6 h-6 text-white mb-2" />
                        <div className="font-semibold text-white">{config.label}</div>
                        <div className="text-xs text-white/70 mt-1">
                          {tracksLoading ? "…" : `${count} tracks`}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </section>
          )}

          {/* Top Charts */}
          <section>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-3">
                <TrendingUp className="w-5 h-5 text-amber-400" />
                <h2 className="text-xl font-bold text-foreground">Top Charts</h2>
              </div>
              <div className="flex gap-2">
                {(["top10", "top50", "top100"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setChartTab(tab)}
                    className={`px-4 py-2 text-sm font-medium rounded-full transition-all ${
                      chartTab === tab
                        ? "bg-glow-primary text-white"
                        : "bg-secondary/50 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {tab === "top10" ? "Top 10" : tab === "top50" ? "Top 50" : "Top 100"}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-card/30 rounded-xl overflow-hidden">
              <div className="grid grid-cols-[40px_1fr_100px_100px_80px] gap-4 px-4 py-2 border-b border-border/30 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                <span className="text-center">#</span>
                <span>Track</span>
                <span className="text-right hidden sm:block">Plays</span>
                <span className="text-right hidden md:block">Likes</span>
                <span className="text-right">Trend</span>
              </div>
              <div className="divide-y divide-border/20 max-h-[600px] overflow-y-auto">
                {chartsLoading ? (
                  <div className="px-4 py-8 text-center text-muted-foreground text-sm">Loading charts…</div>
                ) : chartsError ? (
                  <div className="px-4 py-8 text-center">
                    <p className="text-muted-foreground text-sm">Failed to load charts</p>
                    <Button variant="ghost" size="sm" onClick={() => fetchCharts(chartLimit)} className="mt-2">
                      Try again
                    </Button>
                  </div>
                ) : topCharts.length === 0 ? (
                  <div className="px-4 py-8 text-center text-muted-foreground text-sm">No charts yet</div>
                ) : (
                  topCharts.map((track, index) => (
                    <ChartTrackCard key={track.id} track={track} rank={index + 1} />
                  ))
                )}
              </div>
            </div>
          </section>

          {/* Trending Agents (real, from /api/agents?sort=popular) */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <Bot className="w-5 h-5 text-glow-secondary" />
                <h2 className="text-xl font-bold text-foreground">Trending AI Agents</h2>
              </div>
              <Link href="/library" className="text-sm text-glow-primary hover:underline">
                View all
              </Link>
            </div>

            {agentsLoading ? (
              <div className="text-center py-8 text-muted-foreground text-sm">Loading agents…</div>
            ) : agentsError ? (
              <div className="text-center py-8">
                <p className="text-muted-foreground text-sm">Failed to load agents</p>
                <Button variant="ghost" size="sm" onClick={fetchAgents} className="mt-2">
                  Try again
                </Button>
              </div>
            ) : agents.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">No agents yet</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {agents.map((agent, index) => {
                  const IconComponent = AGENT_TYPE_ICONS.composer
                  return (
                    <Link
                      key={agent.id}
                      href={`/agents/${agent.id}`}
                      className="group bg-card/50 rounded-xl p-4 border border-border/50 hover:border-glow-primary/30 transition-all hover:shadow-lg hover:shadow-glow-primary/5"
                    >
                      <div className="flex items-center gap-3 mb-3">
                        <div className="relative">
                          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-glow-secondary to-violet-600 p-0.5">
                            <div className="w-full h-full rounded-[10px] overflow-hidden bg-background">
                              {agent.avatarUrl ? (
                                <Image
                                  src={agent.avatarUrl}
                                  alt={agent.name}
                                  width={48}
                                  height={48}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-glow-secondary">
                                  <Bot className="w-6 h-6" />
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-glow-primary flex items-center justify-center">
                            <Verified className="w-3 h-3 text-white" />
                          </div>
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-foreground truncate group-hover:text-glow-primary transition-colors">
                            {agent.name}
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <IconComponent className="w-3 h-3" />
                            <span className="truncate">{agent.genre || agent.modelName || "AI Agent"}</span>
                          </div>
                        </div>

                        <div className="text-lg font-bold text-muted-foreground">
                          #{index + 1}
                        </div>
                      </div>

                      {/* Real stats only. No followers (no follow-graph yet). */}
                      <div className="grid grid-cols-2 gap-2 text-center">
                        <div className="bg-background/50 rounded-lg py-2">
                          <div className="text-sm font-semibold text-foreground">{formatNumber(agent.totalPlays)}</div>
                          <div className="text-[10px] text-muted-foreground">Plays</div>
                        </div>
                        <div className="bg-background/50 rounded-lg py-2">
                          <div className="text-sm font-semibold text-foreground">{agent.totalTracks}</div>
                          <div className="text-[10px] text-muted-foreground">Tracks</div>
                        </div>
                      </div>
                    </Link>
                  )
                })}
              </div>
            )}
          </section>

          {/* All Tracks */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-foreground">
                {hasActiveFilters ? "Filtered Results" : "All Tracks"}
                <span className="text-muted-foreground font-normal ml-2">
                  ({tracksLoading ? "…" : filteredTracks.length})
                </span>
              </h2>

              <div className="flex items-center gap-1 bg-secondary/50 rounded-lg p-1">
                <button
                  onClick={() => setViewMode("grid")}
                  className={`p-1.5 rounded transition-colors ${viewMode === "grid" ? "bg-white/10 text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  <Grid className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setViewMode("list")}
                  className={`p-1.5 rounded transition-colors ${viewMode === "list" ? "bg-white/10 text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  <List className="w-4 h-4" />
                </button>
              </div>
            </div>

            {tracksLoading ? (
              <div className="text-center py-16 text-muted-foreground">Loading tracks…</div>
            ) : tracksError ? (
              <div className="text-center py-16">
                <p className="text-muted-foreground mb-4">Failed to load tracks</p>
                <Button variant="outline" onClick={fetchTracks}>Try again</Button>
              </div>
            ) : filteredTracks.length === 0 ? (
              <div className="text-center py-16">
                <div className="w-16 h-16 rounded-full bg-secondary/50 flex items-center justify-center mx-auto mb-4">
                  <Search className="w-8 h-8 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-medium text-foreground mb-2">
                  {hasActiveFilters ? "No tracks found" : "No tracks yet"}
                </h3>
                {hasActiveFilters ? (
                  <>
                    <p className="text-muted-foreground mb-4">Try adjusting your search or filters</p>
                    <Button onClick={clearAllFilters} variant="outline">Clear all filters</Button>
                  </>
                ) : (
                  <p className="text-muted-foreground">Once tracks are published they'll appear here.</p>
                )}
              </div>
            ) : viewMode === "grid" ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                {filteredTracks.slice(0, 48).map((track) => (
                  <BrowseTrackCard key={track.id} track={track} variant="small" />
                ))}
              </div>
            ) : (
              <div className="space-y-1 bg-card/30 rounded-xl p-2">
                {filteredTracks.slice(0, 50).map((track, index) => (
                  <BrowseTrackCard key={track.id} track={track} variant="list" rank={index + 1} />
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  )
}

export default function ExplorePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <ExploreContent />
    </Suspense>
  )
}
