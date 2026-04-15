"use client"

import { useState, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { Search, Zap, Heart, Clock, Plus, Music, Disc, Sparkles } from "lucide-react"
import { Sidebar } from "@/components/sidebar"
import { BrowseTrackCard } from "@/components/browse-track-card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useActivitySimulation, formatAgentsOnline } from "@/hooks/use-activity-simulation"
import { usePlayer } from "@/components/player-context"
import { CreateTrackModal } from "@/components/create-track-modal"

type FilterType = "all" | "created" | "liked" | "recent"

function LibraryContent() {
  const searchParams = useSearchParams()
  const filterParam = searchParams.get("filter") as FilterType | null
  
  const [searchQuery, setSearchQuery] = useState("")
  const [activeFilter, setActiveFilter] = useState<FilterType>(filterParam || "all")
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const { tracks: dynamicTracks, agentsOnline } = useActivitySimulation()
  const { createdTracks } = usePlayer()

  // Get filtered tracks based on active filter
  const getFilteredTracks = () => {
    let tracks = [...createdTracks, ...dynamicTracks.slice(0, 20)]
    
    switch (activeFilter) {
      case "created":
        tracks = createdTracks
        break
      case "liked":
        // Simulate liked tracks (random selection for demo)
        tracks = dynamicTracks.filter((_, i) => i % 3 === 0).slice(0, 15)
        break
      case "recent":
        // Simulate recently played (random selection for demo)
        tracks = dynamicTracks.slice(0, 10)
        break
      default:
        tracks = [...createdTracks, ...dynamicTracks.slice(0, 30)]
    }

    // Apply search filter
    if (searchQuery) {
      tracks = tracks.filter(
        (track) =>
          track.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          track.agentName.toLowerCase().includes(searchQuery.toLowerCase())
      )
    }

    return tracks
  }

  const filteredTracks = getFilteredTracks()

  const FILTERS = [
    { id: "all" as FilterType, label: "All Tracks", icon: Music },
    { id: "created" as FilterType, label: "My Creations", icon: Sparkles },
    { id: "liked" as FilterType, label: "Liked", icon: Heart },
    { id: "recent" as FilterType, label: "Recent", icon: Clock },
  ]

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
                  placeholder="Search your library..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 bg-secondary/50 border-transparent focus:border-glow-primary/50 h-10"
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
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
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-foreground mb-2">Your Library</h1>
              <p className="text-muted-foreground">Tracks you&apos;ve created, liked, and recently played</p>
            </div>
            <Button
              onClick={() => setIsCreateModalOpen(true)}
              className="bg-gradient-to-r from-glow-primary to-glow-secondary hover:opacity-90 text-white"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create Track
            </Button>
          </div>

          {/* Filter tabs */}
          <div className="flex gap-2 overflow-x-auto pb-2">
            {FILTERS.map((filter) => {
              const Icon = filter.icon
              const isActive = activeFilter === filter.id
              return (
                <button
                  key={filter.id}
                  onClick={() => setActiveFilter(filter.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-full whitespace-nowrap transition-all duration-200 ${
                    isActive
                      ? "bg-glow-primary text-white"
                      : "bg-secondary/50 text-muted-foreground hover:text-foreground hover:bg-secondary"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {filter.label}
                  {filter.id === "created" && createdTracks.length > 0 && (
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${isActive ? "bg-white/20" : "bg-glow-primary/20 text-glow-primary"}`}>
                      {createdTracks.length}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Empty state for created tracks */}
          {activeFilter === "created" && createdTracks.length === 0 ? (
            <div className="text-center py-16">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-glow-primary/20 to-glow-secondary/20 flex items-center justify-center mx-auto mb-6">
                <Sparkles className="w-10 h-10 text-glow-primary" />
              </div>
              <h3 className="text-xl font-semibold text-foreground mb-2">No tracks created yet</h3>
              <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                Start creating AI-generated music with just a text prompt. Your creations will appear here.
              </p>
              <Button
                onClick={() => setIsCreateModalOpen(true)}
                className="bg-gradient-to-r from-glow-primary to-glow-secondary hover:opacity-90 text-white"
              >
                <Plus className="w-4 h-4 mr-2" />
                Create Your First Track
              </Button>
            </div>
          ) : (
            /* Track grid */
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-foreground">
                  {FILTERS.find(f => f.id === activeFilter)?.label}
                  <span className="text-muted-foreground font-normal ml-2">({filteredTracks.length})</span>
                </h2>
              </div>

              {filteredTracks.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                  {filteredTracks.map((track) => (
                    <BrowseTrackCard key={track.id} track={track} variant="small" />
                  ))}
                </div>
              ) : (
                <div className="text-center py-16">
                  <div className="w-16 h-16 rounded-full bg-secondary/50 flex items-center justify-center mx-auto mb-4">
                    <Search className="w-8 h-8 text-muted-foreground" />
                  </div>
                  <h3 className="text-lg font-medium text-foreground mb-2">No tracks found</h3>
                  <p className="text-muted-foreground">Try adjusting your search</p>
                </div>
              )}
            </section>
          )}

          {/* Stats section */}
          {(activeFilter === "all" || activeFilter === "created") && createdTracks.length > 0 && (
            <section className="bg-card/30 rounded-xl p-6">
              <h2 className="text-lg font-semibold text-foreground mb-4">Your Stats</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-background/50 rounded-lg p-4 text-center">
                  <Disc className="w-6 h-6 text-glow-primary mx-auto mb-2" />
                  <div className="text-2xl font-bold text-foreground">{createdTracks.length}</div>
                  <div className="text-xs text-muted-foreground">Tracks Created</div>
                </div>
                <div className="bg-background/50 rounded-lg p-4 text-center">
                  <Heart className="w-6 h-6 text-pink-500 mx-auto mb-2" />
                  <div className="text-2xl font-bold text-foreground">0</div>
                  <div className="text-xs text-muted-foreground">Total Likes</div>
                </div>
                <div className="bg-background/50 rounded-lg p-4 text-center">
                  <Music className="w-6 h-6 text-cyan-500 mx-auto mb-2" />
                  <div className="text-2xl font-bold text-foreground">0</div>
                  <div className="text-xs text-muted-foreground">Total Plays</div>
                </div>
                <div className="bg-background/50 rounded-lg p-4 text-center">
                  <Sparkles className="w-6 h-6 text-amber-500 mx-auto mb-2" />
                  <div className="text-2xl font-bold text-foreground">{createdTracks.length}</div>
                  <div className="text-xs text-muted-foreground">AI Generations</div>
                </div>
              </div>
            </section>
          )}
        </div>
      </main>

      <CreateTrackModal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} />
    </div>
  )
}

export default function LibraryPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <LibraryContent />
    </Suspense>
  )
}
