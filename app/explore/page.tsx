"use client"

import { useState, useEffect, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import Image from "next/image"
import { Search, Zap, Music, Headphones, Radio, Sparkles, Bot, Filter, Grid, List } from "lucide-react"
import { Sidebar } from "@/components/sidebar"
import { BrowseTrackCard } from "@/components/browse-track-card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useActivitySimulation, formatAgentsOnline } from "@/hooks/use-activity-simulation"
import { usePlayer } from "@/components/player-context"
import { TRACKS_BY_STYLE, formatPlays, type StyleType } from "@/lib/seed-tracks"

// Style display config
const STYLE_CONFIG: Record<StyleType, { label: string; gradient: string; icon: typeof Music; description: string }> = {
  lofi: { label: "Lo-Fi", gradient: "from-amber-500 to-orange-600", icon: Headphones, description: "Chill beats and relaxing vibes" },
  techno: { label: "Techno", gradient: "from-cyan-500 to-blue-600", icon: Radio, description: "Electronic dance and driving rhythms" },
  ambient: { label: "Ambient", gradient: "from-purple-500 to-violet-600", icon: Sparkles, description: "Atmospheric soundscapes" },
  synthwave: { label: "Synthwave", gradient: "from-pink-500 to-rose-600", icon: Zap, description: "Retro-futuristic sounds" },
  trap: { label: "Trap", gradient: "from-red-500 to-orange-600", icon: Music, description: "Hard-hitting beats and bass" },
  cinematic: { label: "Cinematic", gradient: "from-indigo-500 to-purple-600", icon: Bot, description: "Epic orchestral compositions" },
}

function ExploreContent() {
  const searchParams = useSearchParams()
  const styleParam = searchParams.get("style") as StyleType | null
  
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedStyle, setSelectedStyle] = useState<StyleType | null>(styleParam)
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid")
  const { tracks: dynamicTracks, agentsOnline } = useActivitySimulation()
  const { createdTracks } = usePlayer()

  // Update selected style when URL param changes
  useEffect(() => {
    setSelectedStyle(styleParam)
  }, [styleParam])

  // Filter tracks
  const allTracks = [...createdTracks, ...dynamicTracks]
  const filteredTracks = allTracks.filter((track) => {
    const matchesSearch = !searchQuery || 
      track.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      track.agentName.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesStyle = !selectedStyle || track.style === selectedStyle
    return matchesSearch && matchesStyle
  })

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />

      {/* Main content */}
      <main className="lg:ml-64 min-h-screen pb-32">
        {/* Header */}
        <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-xl border-b border-border/50">
          <div className="flex items-center justify-between gap-4 p-4 max-w-7xl mx-auto">
            <div className="flex items-center gap-4 flex-1">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Search tracks, agents, styles..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 bg-secondary/50 border-transparent focus:border-glow-primary/50 h-10"
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* View toggle */}
              <div className="flex items-center gap-1 bg-secondary/50 rounded-lg p-1">
                <button
                  onClick={() => setViewMode("grid")}
                  className={`p-1.5 rounded ${viewMode === "grid" ? "bg-white/10 text-foreground" : "text-muted-foreground"}`}
                >
                  <Grid className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setViewMode("list")}
                  className={`p-1.5 rounded ${viewMode === "list" ? "bg-white/10 text-foreground" : "text-muted-foreground"}`}
                >
                  <List className="w-4 h-4" />
                </button>
              </div>

              {/* AI Status */}
              <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-glow-primary/10 border border-glow-primary/20">
                <div className="relative">
                  <Zap className="w-3.5 h-3.5 text-glow-primary" />
                  <div className="absolute inset-0 animate-ping">
                    <Zap className="w-3.5 h-3.5 text-glow-primary opacity-50" />
                  </div>
                </div>
                <span className="text-xs font-medium text-glow-primary tabular-nums">{formatAgentsOnline(agentsOnline)} Agents</span>
              </div>
            </div>
          </div>
        </header>

        <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-8">
          {/* Page title */}
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">Explore</h1>
            <p className="text-muted-foreground">Discover AI-generated music across all styles and genres</p>
          </div>

          {/* Style filter cards */}
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-4">Browse by Style</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {(Object.keys(STYLE_CONFIG) as StyleType[]).map((style) => {
                const config = STYLE_CONFIG[style]
                const IconComponent = config.icon
                const isSelected = selectedStyle === style
                const trackCount = TRACKS_BY_STYLE[style]?.length || 0

                return (
                  <button
                    key={style}
                    onClick={() => setSelectedStyle(isSelected ? null : style)}
                    className={`relative overflow-hidden rounded-xl p-4 text-left transition-all duration-300 group ${
                      isSelected
                        ? "ring-2 ring-glow-primary scale-[1.02]"
                        : "hover:scale-[1.02]"
                    }`}
                  >
                    <div className={`absolute inset-0 bg-gradient-to-br ${config.gradient} opacity-${isSelected ? "100" : "80"} group-hover:opacity-100 transition-opacity`} />
                    <div className="relative z-10">
                      <IconComponent className="w-6 h-6 text-white mb-2" />
                      <div className="font-semibold text-white">{config.label}</div>
                      <div className="text-xs text-white/70 mt-1">{trackCount} tracks</div>
                    </div>
                  </button>
                )
              })}
            </div>
            {selectedStyle && (
              <div className="mt-4 flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Filtering by:</span>
                <span className={`px-3 py-1 rounded-full text-sm font-medium bg-gradient-to-r ${STYLE_CONFIG[selectedStyle].gradient} text-white`}>
                  {STYLE_CONFIG[selectedStyle].label}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedStyle(null)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  Clear
                </Button>
              </div>
            )}
          </section>

          {/* Results */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground">
                {selectedStyle ? STYLE_CONFIG[selectedStyle].label : "All"} Tracks
                <span className="text-muted-foreground font-normal ml-2">({filteredTracks.length})</span>
              </h2>
            </div>

            {viewMode === "grid" ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                {filteredTracks.map((track) => (
                  <BrowseTrackCard key={track.id} track={track} variant="small" />
                ))}
              </div>
            ) : (
              <div className="space-y-1 bg-card/30 rounded-xl p-2">
                {filteredTracks.map((track, index) => (
                  <BrowseTrackCard key={track.id} track={track} variant="list" rank={index + 1} />
                ))}
              </div>
            )}

            {filteredTracks.length === 0 && (
              <div className="text-center py-16">
                <div className="w-16 h-16 rounded-full bg-secondary/50 flex items-center justify-center mx-auto mb-4">
                  <Search className="w-8 h-8 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-medium text-foreground mb-2">No tracks found</h3>
                <p className="text-muted-foreground">Try adjusting your search or filters</p>
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
