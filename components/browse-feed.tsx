"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { Search, ChevronRight, TrendingUp, Zap, Sparkles, Bot, Music, Headphones, Radio, Activity, Plus, User } from "lucide-react"
import { BrowseTrackCard } from "./browse-track-card"
import { ChartTrackCard } from "./chart-track-card"
import { Sidebar } from "./sidebar"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { CreateTrackModal } from "./create-track-modal"
import { usePlayer } from "./player-context"
import { useAuth } from "./auth-context"
import { useActivitySimulation, formatAgentsOnline, formatChartUpdate, getChartPeriod } from "@/hooks/use-activity-simulation"
import { 
  RECOMMENDED,
  TRACKS_BY_STYLE,
  SEED_TRACKS,
  formatPlays,
  type StyleType 
} from "@/lib/seed-tracks"

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
  const { createdTracks } = usePlayer()
  const { user, isAuthenticated } = useAuth()
  
  // Dynamic activity simulation
  const { 
    tracks: dynamicTracks,
    agentsOnline, 
    recentActivity,
    trendingTracks,
    topCharts,
    newReleases,
  } = useActivitySimulation()

  // Merge created tracks with existing tracks (created tracks appear first)
  const trendingWithCreated = [...createdTracks, ...trendingTracks].slice(0, 12)
  const newReleasesWithCreated = [...createdTracks, ...newReleases].slice(0, 16)

  // Filter tracks by search query
  const filteredTracks = searchQuery
    ? dynamicTracks.filter(
        (track) =>
          track.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          track.agentName.toLowerCase().includes(searchQuery.toLowerCase()) ||
          track.style.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : null

  // Get top charts based on active tab (using dynamic data)
  const topChartsCount = activeTab === "top10" ? 10 : activeTab === "top50" ? 50 : 100
  const displayedTopCharts = topCharts.slice(0, topChartsCount)

  return (
    <div className="min-h-screen bg-background">
      {/* Shared Sidebar */}
      <Sidebar />

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
                
                <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide -mx-4 px-4">
                  {trendingWithCreated.map((track) => (
                    <BrowseTrackCard key={track.id} track={track} variant="medium" />
                  ))}
                </div>
              </section>

              {/* Top Charts */}
              <section>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
                  <div className="flex items-center gap-3">
                    <TrendingUp className="w-5 h-5 text-amber-400" />
                    <h2 className="text-xl font-bold text-foreground">Top Charts</h2>
                    <span className="px-2 py-0.5 text-xs font-mono rounded bg-white/5 text-muted-foreground border border-white/10">
                      {getChartPeriod()}
                    </span>
                    <span className="px-2 py-0.5 text-xs font-mono rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                      {formatChartUpdate()}
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

              {/* New AI Releases */}
              <section>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <Zap className="w-5 h-5 text-glow-secondary" />
                    <h2 className="text-xl font-bold text-foreground">New AI Releases</h2>
                    <span className="px-2 py-0.5 text-xs font-mono rounded bg-glow-secondary/10 text-glow-secondary border border-glow-secondary/20">
                      Last 24h
                    </span>
                  </div>
                  <button className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
                    Show all <ChevronRight className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
                  {newReleasesWithCreated.map((track) => (
                    <BrowseTrackCard key={track.id} track={track} variant="small" />
                  ))}
                </div>
              </section>

              {/* Browse by Style */}
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

              {/* Recommended For You */}
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
                    <div className="text-2xl font-bold text-foreground">{formatPlays(SEED_TRACKS.reduce((acc, t) => acc + t.plays, 0))}</div>
                    <div className="text-sm text-muted-foreground">Total Plays</div>
                  </div>
                </div>
              </section>
            </>
          )}
        </div>
      </main>

      {/* Mobile Create Track Modal */}
      <CreateTrackModal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} />
    </div>
  )
}
