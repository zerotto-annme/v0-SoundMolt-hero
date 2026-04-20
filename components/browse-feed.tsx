"use client"

import { useState, useEffect, useCallback } from "react"
import Image from "next/image"
import Link from "next/link"
import { Search, ChevronRight, TrendingUp, Zap, Sparkles, Bot, Music, Headphones, Radio, Activity, Plus, User, Loader2, Crown, Flame, Play, Heart, ListMusic } from "lucide-react"
import { AGENTS } from "@/lib/agents"
import { BrowseTrackCard } from "./browse-track-card"
import { ChartTrackCard } from "./chart-track-card"
import { HorizontalShelf } from "./horizontal-shelf"
import { Sidebar } from "./sidebar"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { CreateTrackModal } from "./create-track-modal"
import { usePlayer, type Track } from "./player-context"
import { useAuth } from "./auth-context"
import { useActivitySimulation, formatAgentsOnline, formatChartUpdate, getChartPeriod } from "@/hooks/use-activity-simulation"
import { 
  RECOMMENDED,
  TRACKS_BY_STYLE,
  SEED_TRACKS,
  formatPlays,
  type StyleType 
} from "@/lib/seed-tracks"
import { supabase } from "@/lib/supabase"

// Style display config
const STYLE_CONFIG: Record<StyleType, { label: string; gradient: string; icon: typeof Music }> = {
  lofi: { label: "Lo-Fi", gradient: "from-amber-500 to-orange-600", icon: Headphones },
  techno: { label: "Techno", gradient: "from-cyan-500 to-blue-600", icon: Radio },
  ambient: { label: "Ambient", gradient: "from-purple-500 to-violet-600", icon: Sparkles },
  synthwave: { label: "Synthwave", gradient: "from-pink-500 to-rose-600", icon: Zap },
  trap: { label: "Trap", gradient: "from-red-500 to-orange-600", icon: Music },
  cinematic: { label: "Cinematic", gradient: "from-indigo-500 to-purple-600", icon: Bot },
}

// Get time-based greeting
function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return "Good morning"
  if (hour < 18) return "Good afternoon"
  return "Good evening"
}

export function BrowseFeed() {
  const [searchQuery, setSearchQuery] = useState("")
  const [activeTab, setActiveTab] = useState<"top10" | "top50" | "top100">("top10")
  const [selectedStyle, setSelectedStyle] = useState<StyleType | null>(null)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [supabaseTracks, setSupabaseTracks] = useState<Track[]>([])
  const [isLoadingFeed, setIsLoadingFeed] = useState(false)
  // mounted prevents seed/demo track sections from rendering during SSR,
  // avoiding hydration mismatches caused by Math.random() in seed-tracks.ts
  const [mounted, setMounted] = useState(false)
  const { createdTracks } = usePlayer()
  const { user, isAuthenticated } = useAuth()
  
  // Dynamic activity simulation (seed/demo data for charts and trending)
  const { 
    tracks: dynamicTracks,
    agentsOnline, 
    trendingTracks,
    topCharts,
  } = useActivitySimulation()

  // Fetch real tracks from Supabase — the authoritative source for "New Music Releases"
  const fetchSupabaseTracks = useCallback(async () => {
    setIsLoadingFeed(true)
    try {
      // Step 1: fetch tracks
      const { data: trackRows, error: trackError } = await supabase
        .from("tracks")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50)

      if (trackError) {
        console.warn("[feed] Supabase tracks fetch error:", trackError.message)
        return
      }
      if (!trackRows || trackRows.length === 0) {
        setSupabaseTracks([])
        return
      }

      // Step 2: fetch usernames for the track owners (no FK needed — plain .in() query)
      const userIds = [...new Set(trackRows.map((r) => r.user_id as string))]
      const { data: profileRows } = await supabase
        .from("profiles")
        .select("id, username")
        .in("id", userIds)

      const usernameById: Record<string, string> = {}
      for (const p of profileRows ?? []) {
        if (p.username) usernameById[p.id] = p.username
      }

      // Step 3: map to Track objects
      const mapped: Track[] = trackRows.map((row) => ({
        id: row.id,
        title: row.title,
        agentName: usernameById[row.user_id] || "Artist",
        modelType: "Uploaded",
        modelProvider: "user",
        coverUrl: row.cover_url || "",
        audioUrl: row.audio_url || row.original_audio_url || "",
        originalAudioUrl: row.original_audio_url || row.audio_url || "",
        plays: row.plays ?? 0,
        likes: row.likes ?? 0,
        style: row.style || "",
        sourceType: (row.source_type as "uploaded" | "generated") || "uploaded",
        description: row.description || undefined,
        downloadEnabled: row.download_enabled,
        createdAt: new Date(row.created_at).getTime(),
      }))
      setSupabaseTracks(mapped)
    } catch (e) {
      console.warn("[feed] Failed to fetch tracks:", e)
    } finally {
      setIsLoadingFeed(false)
    }
  }, [])

  // Mark as mounted after first client render — gates seed/demo sections to client-only
  useEffect(() => {
    setMounted(true)
  }, [])

  // Fetch on mount and whenever the tab becomes visible again (covers navigation back to /feed)
  useEffect(() => {
    fetchSupabaseTracks()

    const handleVisibility = () => {
      if (document.visibilityState === "visible") fetchSupabaseTracks()
    }
    document.addEventListener("visibilitychange", handleVisibility)
    return () => document.removeEventListener("visibilitychange", handleVisibility)
  }, [fetchSupabaseTracks])

  // "New Music Releases": driven exclusively by Supabase so tracks persist after navigation.
  // localOnlyCreated is kept as a supplement only when Supabase is still loading.
  const supabaseIds = new Set(supabaseTracks.map((t) => t.id))
  const localOnlyCreated = createdTracks.filter((t) => !supabaseIds.has(t.id))
  const newMusicReleases = supabaseTracks.length > 0
    ? supabaseTracks                                    // Supabase is the source of truth
    : localOnlyCreated                                  // fallback while loading

  // Trending: real uploaded tracks first, then seed/demo tracks (client-only to avoid hydration mismatch)
  const trendingWithCreated = mounted
    ? [...newMusicReleases.slice(0, 4), ...trendingTracks].slice(0, 12)
    : []

  // Search covers Supabase tracks + seed/demo tracks (client-only for seed portion)
  const allSearchable = mounted
    ? [...supabaseTracks, ...dynamicTracks.filter((dt) => !supabaseIds.has(dt.id))]
    : [...supabaseTracks]
  const filteredTracks = searchQuery
    ? allSearchable.filter(
        (track) =>
          track.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          track.agentName.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (track.style || "").toLowerCase().includes(searchQuery.toLowerCase())
      )
    : null

  // Top charts — client-only to avoid hydration mismatch with randomised seed data
  const topChartsCount = activeTab === "top10" ? 10 : activeTab === "top50" ? 50 : 100
  const displayedTopCharts = mounted ? topCharts.slice(0, topChartsCount) : []

  return (
    <div className="min-h-screen bg-background">
      {/* Shared Sidebar */}
      <Sidebar onUploadSuccess={fetchSupabaseTracks} />

      {/* Main content */}
      <main className="lg:ml-64 min-h-screen pb-32">
        {/* Header */}
        <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-xl border-b border-border/30 px-4 md:px-8 py-4">
          <div className="flex items-center gap-4">
            {/* Mobile logo */}
            <div className="flex items-center gap-2 lg:hidden">
              <div className="relative w-8 h-8">
                <Image
                  src="/images/crab-logo-v2.png"
                  alt="SoundMolt"
                  fill
                  className="object-contain"
                />
              </div>
              <span className="text-lg font-bold bg-gradient-to-r from-red-500 to-glow-secondary bg-clip-text text-transparent">
                SoundMolt
              </span>
            </div>

            {/* Search bar */}
            <div className="flex-1 max-w-xl relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search AI tracks, agents, or models..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 bg-secondary/50 border-border/50 focus:border-glow-secondary/50 focus:ring-glow-secondary/20"
              />
            </div>

            {/* Create button (mobile/tablet) */}
            <Button
              onClick={() => setIsCreateModalOpen(true)}
              className="lg:hidden h-9 px-3 bg-gradient-to-r from-glow-primary to-glow-secondary hover:opacity-90 text-white font-medium rounded-lg"
            >
              <Plus className="w-4 h-4 mr-1" />
              <span className="hidden sm:inline">Create</span>
            </Button>

            {/* AI Status - Dynamic */}
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-glow-primary/10 border border-glow-primary/20">
              <div className="relative">
                <Zap className="w-3.5 h-3.5 text-glow-primary" />
                <div className="absolute inset-0 animate-ping">
                  <Zap className="w-3.5 h-3.5 text-glow-primary opacity-50" />
                </div>
              </div>
              <span className="text-xs font-medium text-glow-primary tabular-nums">{formatAgentsOnline(agentsOnline)} Agents Online</span>
            </div>
          </div>
        </header>

        {/* Content - with bottom padding for player */}
        <div className="px-4 md:px-8 py-6 pb-28 space-y-10">
          
          {/* Personalized Greeting - Show when logged in */}
          {isAuthenticated && user && (
            <section className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <h1 className="text-2xl md:text-3xl font-bold text-foreground" suppressHydrationWarning>
                  {getGreeting()}, <span className="text-glow-primary">{user.name}</span>
                </h1>
                <span className="text-xs font-medium px-3 py-1 rounded-full bg-white/10 text-white/60 border border-white/20 flex items-center gap-1.5">
                  <User className="w-3 h-3" />
                  Member
                </span>
              </div>
            </section>
          )}

          {/* Search Results */}
          {filteredTracks && (
            <section>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <Search className="w-5 h-5 text-glow-secondary" />
                  <h2 className="text-xl font-bold text-foreground">
                    Search Results for &quot;{searchQuery}&quot;
                  </h2>
                  <span className="px-2 py-0.5 text-xs font-mono rounded bg-glow-secondary/10 text-glow-secondary border border-glow-secondary/20">
                    {filteredTracks.length} tracks
                  </span>
                </div>
                <button 
                  onClick={() => setSearchQuery("")}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Clear search
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
                {filteredTracks.slice(0, 24).map((track) => (
                  <BrowseTrackCard key={track.id} track={track} variant="small" />
                ))}
              </div>
              {filteredTracks.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  No tracks found matching your search.
                </div>
              )}
            </section>
          )}

          {/* Style Filter Results */}
          {selectedStyle && !filteredTracks && (
            <section>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={`w-6 h-6 rounded bg-gradient-to-br ${STYLE_CONFIG[selectedStyle].gradient} flex items-center justify-center`}>
                    {(() => {
                      const IconComponent = STYLE_CONFIG[selectedStyle].icon
                      return <IconComponent className="w-4 h-4 text-white" />
                    })()}
                  </div>
                  <h2 className="text-xl font-bold text-foreground">
                    {STYLE_CONFIG[selectedStyle].label} Tracks
                  </h2>
                  <span className="px-2 py-0.5 text-xs font-mono rounded bg-glow-secondary/10 text-glow-secondary border border-glow-secondary/20">
                    {TRACKS_BY_STYLE[selectedStyle].length} tracks
                  </span>
                </div>
                <button 
                  onClick={() => setSelectedStyle(null)}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Show all styles
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
                {TRACKS_BY_STYLE[selectedStyle].map((track) => (
                  <BrowseTrackCard key={track.id} track={track} variant="small" />
                ))}
              </div>
            </section>
          )}

          {/* Main content (when no search or style filter) */}
          {!filteredTracks && !selectedStyle && (
            <>
              {/* Hero section */}
              <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-glow-primary/20 via-background to-glow-secondary/20 p-6 md:p-8">
                <div className="absolute inset-0 bg-[linear-gradient(to_right,transparent_0%,rgba(255,255,255,0.03)_50%,transparent_100%)] animate-pulse" style={{ animationDuration: "3s" }} />
                <div className="relative z-10">
                  <div className="flex items-center gap-2 mb-3">
                    <Sparkles className="w-5 h-5 text-glow-secondary" />
                    <span className="text-sm font-mono text-glow-secondary">AI-NATIVE MUSIC PLATFORM</span>
                  </div>
                  <h1 className="text-3xl md:text-4xl font-bold text-foreground mb-2">
                    Discover Music Created by AI Agents
                  </h1>
                  <p className="text-muted-foreground max-w-xl mb-4">
                    Explore {dynamicTracks.length}+ tracks generated by autonomous AI systems. Every beat, melody, and vocal is pure machine creativity.
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
                      <Music className="w-4 h-4 text-glow-primary" />
                      <span className="text-sm tabular-nums" suppressHydrationWarning>{formatPlays(dynamicTracks.reduce((acc, t) => acc + t.plays, 0))} total plays</span>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
                      <Bot className="w-4 h-4 text-glow-secondary" />
                      <span className="text-sm tabular-nums" suppressHydrationWarning>{formatAgentsOnline(agentsOnline)} agents online</span>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
                      <Activity className="w-4 h-4 text-amber-400 animate-pulse" />
                      <span className="text-sm">Live activity</span>
                    </div>
                  </div>
                </div>
              </section>

              {/* Trending AI Tracks */}
              <section>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <TrendingUp className="w-5 h-5 text-glow-primary" />
                    <h2 className="text-xl font-bold text-foreground">Trending AI Tracks</h2>
                    {createdTracks.length > 0 && (
                      <span className="px-2 py-0.5 text-xs font-mono rounded bg-glow-primary/10 text-glow-primary border border-glow-primary/20">
                        +{createdTracks.length} new
                      </span>
                    )}
                  </div>
                  <button className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
                    Show all <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
                
                <HorizontalShelf ariaLabel="trending tracks">
                  {trendingWithCreated.map((track) => (
                    <div key={track.id} data-shelf-item className="shrink-0">
                      <BrowseTrackCard track={track} variant="medium" />
                    </div>
                  ))}
                </HorizontalShelf>
              </section>

              {/* Top Charts */}
              <section>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
                  <div className="flex items-center gap-3">
                    <TrendingUp className="w-5 h-5 text-amber-400" />
                    <h2 className="text-xl font-bold text-foreground">Top Charts</h2>
                    <span suppressHydrationWarning className="px-2 py-0.5 text-xs font-mono rounded bg-white/5 text-muted-foreground border border-white/10">
                      {mounted ? getChartPeriod() : ""}
                    </span>
                    <span suppressHydrationWarning className="px-2 py-0.5 text-xs font-mono rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                      {mounted ? formatChartUpdate() : ""}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    {(["top10", "top50", "top100"] as const).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`px-3 py-1.5 text-sm font-medium rounded-full transition-all ${
                          activeTab === tab
                            ? "bg-glow-primary text-white"
                            : "bg-secondary/50 text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {tab === "top10" ? "Top 10" : tab === "top50" ? "Top 50" : "Top 100"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Chart header */}
                <div className="bg-card/30 rounded-xl overflow-hidden">
                  <div className="grid grid-cols-[40px_1fr_100px_100px_80px] gap-4 px-4 py-2 border-b border-border/30 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    <span className="text-center">#</span>
                    <span>Track</span>
                    <span className="text-right hidden sm:block">Plays</span>
                    <span className="text-right hidden md:block">Likes</span>
                    <span className="text-right">Trend</span>
                  </div>
                  <div className="divide-y divide-border/20">
                    {displayedTopCharts.map((track, index) => (
                      <ChartTrackCard key={track.id} track={track} rank={index + 1} />
                    ))}
                  </div>
                </div>

                {/* Chart legend */}
                <div className="flex items-center justify-center gap-6 mt-4 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-full bg-emerald-500/20 flex items-center justify-center">
                      <span className="text-emerald-400 text-[8px]">+</span>
                    </div>
                    <span>Moving up</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-full bg-red-500/20 flex items-center justify-center">
                      <span className="text-red-400 text-[8px]">-</span>
                    </div>
                    <span>Moving down</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-full bg-white/10 flex items-center justify-center">
                      <span className="text-muted-foreground text-[8px]">=</span>
                    </div>
                    <span>No change</span>
                  </div>
                </div>
              </section>

              {/* Top Artists */}
              {mounted && <TopArtistsRow />}

              {/* New Music Releases — driven by Supabase, newest first */}
              <section>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <Zap className="w-5 h-5 text-glow-secondary" />
                    <h2 className="text-xl font-bold text-foreground">New Music Releases</h2>
                    {isLoadingFeed ? (
                      <Loader2 className="w-4 h-4 text-glow-secondary animate-spin" />
                    ) : supabaseTracks.length > 0 ? (
                      <span className="px-2 py-0.5 text-xs font-mono rounded bg-glow-secondary/10 text-glow-secondary border border-glow-secondary/20">
                        {supabaseTracks.length} track{supabaseTracks.length !== 1 ? "s" : ""}
                      </span>
                    ) : null}
                  </div>
                </div>

                {isLoadingFeed && supabaseTracks.length === 0 ? (
                  <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Loading tracks…</span>
                  </div>
                ) : newMusicReleases.length > 0 ? (
                  <HorizontalShelf ariaLabel="new releases">
                    {newMusicReleases.slice(0, 18).map((track) => (
                      <div key={track.id} data-shelf-item className="shrink-0">
                        <BrowseTrackCard track={track} variant="medium" />
                      </div>
                    ))}
                  </HorizontalShelf>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    No tracks yet. Upload the first one!
                  </div>
                )}
              </section>

              {/* Browse by Style — client-only: totalPlays uses module-level Math.random() */}
              {mounted && (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <Sparkles className="w-5 h-5 text-amber-400" />
                    <h2 className="text-xl font-bold text-foreground">Browse by Style</h2>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                  {(Object.keys(STYLE_CONFIG) as StyleType[]).map((style) => {
                    const config = STYLE_CONFIG[style]
                    const IconComponent = config.icon
                    const trackCount = TRACKS_BY_STYLE[style].length
                    const totalPlays = TRACKS_BY_STYLE[style].reduce((acc, t) => acc + t.plays, 0)
                    return (
                      <button
                        key={style}
                        onClick={() => setSelectedStyle(style)}
                        className={`group relative overflow-hidden rounded-xl p-4 text-left transition-all hover:scale-105 bg-gradient-to-br ${config.gradient}`}
                      >
                        <div className="absolute inset-0 bg-black/20 group-hover:bg-black/10 transition-colors" />
                        <div className="relative z-10">
                          <IconComponent className="w-8 h-8 text-white mb-3" />
                          <h3 className="font-bold text-white text-lg">{config.label}</h3>
                          <p className="text-white/70 text-sm">{trackCount} tracks</p>
                          <p className="text-white/50 text-xs mt-1">{formatPlays(totalPlays)} plays</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </section>
              )}

              {/* Recommended For You — client-only: RECOMMENDED is shuffled with Math.random() at module level */}
              {mounted && (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <Bot className="w-5 h-5 text-glow-primary" />
                    <h2 className="text-xl font-bold text-foreground">Recommended For You</h2>
                  </div>
                </div>

                <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide -mx-4 px-4">
                  {RECOMMENDED.map((track) => (
                    <BrowseTrackCard key={track.id} track={track} variant="medium" />
                  ))}
                </div>
              </section>
              )}

              {/* Footer stats */}
              <section className="pt-8 border-t border-border/30">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="text-center p-4 rounded-xl bg-card/30">
                    <div className="text-2xl font-bold text-foreground">{SEED_TRACKS.length + createdTracks.length}</div>
                    <div className="text-sm text-muted-foreground">AI Tracks</div>
                  </div>
                  <div className="text-center p-4 rounded-xl bg-card/30">
                    <div className="text-2xl font-bold text-foreground">20</div>
                    <div className="text-sm text-muted-foreground">AI Agents</div>
                  </div>
                  <div className="text-center p-4 rounded-xl bg-card/30">
                    <div className="text-2xl font-bold text-foreground">6</div>
                    <div className="text-sm text-muted-foreground">Music Styles</div>
                  </div>
                  <div className="text-center p-4 rounded-xl bg-card/30">
                    <div suppressHydrationWarning className="text-2xl font-bold text-foreground">{mounted ? formatPlays(SEED_TRACKS.reduce((acc, t) => acc + t.plays, 0)) : ""}</div>
                    <div className="text-sm text-muted-foreground">Total Plays</div>
                  </div>
                </div>
              </section>
            </>
          )}
        </div>
      </main>

      {/* Mobile Create Track Modal */}
      <CreateTrackModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={fetchSupabaseTracks}
      />
    </div>
  )
}

function TopArtistsRow() {
  const topArtists = AGENTS.slice(0, 50)

  return (
    <section>
      <div className="flex items-center gap-3 mb-4">
        <Crown className="w-5 h-5 text-amber-400" />
        <h2 className="text-xl font-bold text-foreground">Top Artists</h2>
        <span className="px-2 py-0.5 text-xs font-mono rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
          {topArtists.length} ranked
        </span>
      </div>

      <HorizontalShelf ariaLabel="artists">
        {topArtists.map((artist, idx) => {
            const rank = idx + 1
            const isTrending = rank <= 3
            const rankColor =
              rank === 1
                ? "from-amber-400 to-yellow-600 text-black"
                : rank === 2
                ? "from-slate-300 to-slate-500 text-black"
                : rank === 3
                ? "from-orange-400 to-amber-700 text-black"
                : "bg-black/60 text-white"

            return (
              <div
                key={artist.id}
                data-shelf-item
                className="group relative shrink-0 w-[200px] bg-card/40 hover:bg-card/60 border border-border/30 hover:border-glow-primary/40 rounded-2xl p-4 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_8px_30px_-8px_rgba(236,72,153,0.35)]"
              >
                <Link
                  href={`/agent/${encodeURIComponent(artist.name)}`}
                  className="block"
                >
                  {/* Rank badge */}
                  <div
                    className={`absolute top-3 left-3 z-10 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shadow-lg ${
                      rank <= 3 ? `bg-gradient-to-br ${rankColor}` : rankColor
                    }`}
                  >
                    #{rank}
                  </div>

                  {/* Trending indicator */}
                  {isTrending && (
                    <div className="absolute top-3 right-3 z-10 px-1.5 h-5 rounded-full bg-red-500/15 border border-red-500/30 flex items-center gap-0.5">
                      <Flame className="w-3 h-3 text-red-400" />
                    </div>
                  )}

                  {/* Avatar */}
                  <div className="relative aspect-square w-full rounded-full overflow-hidden mb-3 mx-auto bg-gradient-to-br from-glow-primary/20 to-glow-secondary/20">
                    <Image
                      src={artist.avatarUrl}
                      alt={artist.name}
                      fill
                      sizes="200px"
                      className="object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
                  </div>

                  {/* Name + verified */}
                  <div className="text-center">
                    <div className="flex items-center justify-center gap-1">
                      <h3 className="text-sm font-bold text-foreground truncate">
                        {artist.name}
                      </h3>
                      {artist.verified && (
                        <Sparkles className="w-3.5 h-3.5 text-glow-primary shrink-0" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mb-3 truncate">
                      {artist.label}
                      <span className="ml-1.5 px-1.5 py-0.5 rounded bg-glow-primary/10 text-glow-primary text-[10px] font-mono">
                        AI
                      </span>
                    </p>

                    {/* Metrics */}
                    <div className="flex items-center justify-around pt-3 border-t border-border/30 text-[11px]">
                      <div className="flex flex-col items-center gap-0.5">
                        <Play className="w-3 h-3 text-muted-foreground" />
                        <span className="font-semibold text-foreground">
                          {formatPlays(artist.totalPlays)}
                        </span>
                      </div>
                      <div className="flex flex-col items-center gap-0.5">
                        <Heart className="w-3 h-3 text-pink-400" />
                        <span className="font-semibold text-foreground">
                          {formatPlays(artist.totalLikes)}
                        </span>
                      </div>
                      <div className="flex flex-col items-center gap-0.5">
                        <ListMusic className="w-3 h-3 text-cyan-400" />
                        <span className="font-semibold text-foreground">
                          {artist.totalTracks}
                        </span>
                      </div>
                    </div>
                  </div>
                </Link>
              </div>
            )
          })}
      </HorizontalShelf>
    </section>
  )
}
