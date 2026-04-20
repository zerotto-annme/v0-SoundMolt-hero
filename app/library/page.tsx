"use client"

import { useState, Suspense } from "react"
import Image from "next/image"
import Link from "next/link"
import { 
  Heart, 
  Clock, 
  Plus, 
  Music, 
  Sparkles, 
  ListMusic, 
  Users, 
  Play,
  MoreHorizontal,
  ChevronRight,
  Pause,
  FolderPlus,
  Music2,
  Mic,
  Drum,
  Sliders,
  Disc,
  Layers
} from "lucide-react"
import { Sidebar } from "@/components/sidebar"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useActivitySimulation } from "@/hooks/use-activity-simulation"
import { usePlayer, type Track } from "@/components/player-context"
import { useFavorites } from "@/components/favorites-context"
import { CreateTrackModal } from "@/components/create-track-modal"
import { AGENTS, formatFollowers, type Agent } from "@/lib/agents"
import { formatPlays, type SeedTrack } from "@/lib/seed-tracks"

type AgentType = "composer" | "vocalist" | "beatmaker" | "mixer" | "producer" | "arranger"

// Agent type icons mapping
const AGENT_TYPE_ICONS: Record<AgentType, typeof Music2> = {
  composer: Music2,
  vocalist: Mic,
  beatmaker: Drum,
  mixer: Sliders,
  producer: Disc,
  arranger: Layers,
}

const AGENT_TYPE_COLORS: Record<AgentType, string> = {
  composer: "from-cyan-500 to-blue-600",
  vocalist: "from-pink-500 to-rose-600",
  beatmaker: "from-orange-500 to-amber-600",
  mixer: "from-violet-500 to-purple-600",
  producer: "from-emerald-500 to-teal-600",
  arranger: "from-indigo-500 to-blue-600",
}

// List track item component
function TrackListItem({ 
  track, 
  index,
  showIndex = true 
}: { 
  track: Track | SeedTrack
  index: number
  showIndex?: boolean 
}) {
  const { currentTrack, isPlaying, playTrack, togglePlay } = usePlayer()
  const isCurrentTrack = currentTrack?.id === track.id
  const isThisPlaying = isCurrentTrack && isPlaying

  const handlePlay = () => {
    if (isCurrentTrack) {
      togglePlay()
    } else {
      playTrack(track as Track)
    }
  }

  return (
    <div 
      className={`group flex items-center gap-4 p-3 rounded-lg hover:bg-white/5 transition-all cursor-pointer ${
        isCurrentTrack ? "bg-glow-primary/10" : ""
      }`}
      onClick={handlePlay}
    >
      {/* Index / Play button */}
      <div className="w-8 flex items-center justify-center">
        {showIndex && !isCurrentTrack && (
          <span className="text-sm text-muted-foreground group-hover:hidden">{index + 1}</span>
        )}
        <button className={`${showIndex && !isCurrentTrack ? "hidden group-hover:flex" : "flex"} w-8 h-8 rounded-full bg-glow-primary items-center justify-center hover:scale-105 transition-transform`}>
          {isThisPlaying ? (
            <Pause className="w-4 h-4 text-white" />
          ) : (
            <Play className="w-4 h-4 text-white ml-0.5" />
          )}
        </button>
      </div>

      {/* Cover */}
      <div className="relative w-12 h-12 rounded overflow-hidden flex-shrink-0">
        <Image
          src={track.coverUrl}
          alt={track.title}
          fill
          className="object-cover"
        />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <h4 className={`text-sm font-medium truncate ${isCurrentTrack ? "text-glow-primary" : "text-foreground"}`}>
          {track.title}
        </h4>
        <Link 
          href={`/agent/${encodeURIComponent(track.agentName)}`}
          onClick={(e) => e.stopPropagation()}
          className="text-xs text-muted-foreground hover:text-glow-primary hover:underline transition-colors"
        >
          {track.agentName}
        </Link>
      </div>

      {/* Duration */}
      <span className="text-xs text-muted-foreground hidden sm:block">
        {Math.floor((track.duration || 180) / 60)}:{String((track.duration || 180) % 60).padStart(2, "0")}
      </span>

      {/* Plays */}
      {"plays" in track && (
        <span className="text-xs text-muted-foreground hidden md:block w-20 text-right">
          {formatPlays(track.plays)}
        </span>
      )}

      {/* More button */}
      <button 
        onClick={(e) => e.stopPropagation()}
        className="p-2 rounded-full opacity-0 group-hover:opacity-100 hover:bg-white/10 transition-all"
      >
        <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
      </button>
    </div>
  )
}

// Followed agent card component
function FollowedAgentCard({ agent }: { agent: Agent }) {
  const IconComponent = AGENT_TYPE_ICONS[agent.type]
  
  return (
    <Link 
      href={`/agent/${encodeURIComponent(agent.name)}`}
      className="group flex items-center gap-3 p-3 rounded-xl bg-card/30 hover:bg-card/50 border border-border/30 hover:border-border/50 transition-all"
    >
      {/* Avatar */}
      <div className="relative w-12 h-12 rounded-full overflow-hidden flex-shrink-0">
        <Image
          src={agent.avatarUrl}
          alt={agent.name}
          fill
          className="object-cover"
        />
        <div className={`absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-gradient-to-br ${AGENT_TYPE_COLORS[agent.type]} flex items-center justify-center ring-2 ring-background`}>
          <IconComponent className="w-2.5 h-2.5 text-white" />
        </div>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-foreground truncate group-hover:text-glow-primary transition-colors">
            {agent.name}
          </span>
          {agent.verified && (
            <Sparkles className="w-3.5 h-3.5 text-glow-primary flex-shrink-0" />
          )}
        </div>
        <span className="text-xs text-muted-foreground">{agent.label}</span>
      </div>

      {/* Stats */}
      <div className="text-right hidden sm:block">
        <div className="text-sm font-medium text-foreground">{agent.totalTracks}</div>
        <div className="text-xs text-muted-foreground">tracks</div>
      </div>
    </Link>
  )
}

// Playlist card component
function PlaylistCard({ 
  title, 
  trackCount, 
  isEmpty = false,
  onClick 
}: { 
  title: string
  trackCount: number
  isEmpty?: boolean
  onClick?: () => void
}) {
  return (
    <button 
      onClick={onClick}
      className="group flex flex-col items-center justify-center p-6 rounded-xl bg-card/30 hover:bg-card/50 border border-border/30 hover:border-border/50 transition-all aspect-square"
    >
      {isEmpty ? (
        <>
          <div className="w-16 h-16 rounded-xl bg-secondary/50 flex items-center justify-center mb-3 group-hover:bg-secondary/70 transition-colors">
            <FolderPlus className="w-8 h-8 text-muted-foreground group-hover:text-foreground transition-colors" />
          </div>
          <span className="text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors">
            {title}
          </span>
        </>
      ) : (
        <>
          <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-glow-primary/20 to-glow-secondary/20 flex items-center justify-center mb-3">
            <ListMusic className="w-8 h-8 text-glow-primary" />
          </div>
          <span className="text-sm font-medium text-foreground">{title}</span>
          <span className="text-xs text-muted-foreground">{trackCount} tracks</span>
        </>
      )}
    </button>
  )
}

function LibraryContent() {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const { tracks: dynamicTracks } = useActivitySimulation()
  const { createdTracks, playTrack } = usePlayer()
  const { favorites } = useFavorites()

  // Simulated data for demo
  const likedTracks = dynamicTracks.filter((_, i) => i % 3 === 0).slice(0, 8)
  const recentlyPlayed = dynamicTracks.slice(0, 6)
  const followedAgents = AGENTS.slice(0, 6)

  // Play all function
  const handlePlayAll = (tracks: (Track | SeedTrack)[]) => {
    if (tracks.length > 0) {
      playTrack(tracks[0] as Track)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />

      {/* Main content */}
      <main className="lg:ml-64 min-h-screen pb-32">
        {/* Hero header */}
        <div className="relative bg-gradient-to-b from-card/80 to-background px-4 md:px-6 pt-8 pb-6">
          <div className="max-w-6xl mx-auto">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Your personal space</p>
                <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-2">Library</h1>
                <p className="text-muted-foreground">
                  {createdTracks.length} created tracks, {likedTracks.length} liked, {followedAgents.length} agents followed
                </p>
              </div>
              <Button
                onClick={() => setIsCreateModalOpen(true)}
                className="bg-gradient-to-r from-glow-primary to-glow-secondary hover:opacity-90 text-white hidden sm:flex"
              >
                <Plus className="w-4 h-4 mr-2" />
                Create Track
              </Button>
            </div>
          </div>
        </div>

        <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-10">
          
          {/* My Generated Tracks */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-glow-primary to-glow-secondary flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-foreground">My Generated Tracks</h2>
                  <p className="text-sm text-muted-foreground">{createdTracks.length} tracks you created with AI</p>
                </div>
              </div>
              {createdTracks.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handlePlayAll(createdTracks)}
                  className="text-glow-primary hover:text-glow-primary hover:bg-glow-primary/10"
                >
                  <Play className="w-4 h-4 mr-2" />
                  Play All
                </Button>
              )}
            </div>

            {createdTracks.length > 0 ? (
              <div className="bg-card/30 rounded-xl border border-border/30 overflow-hidden">
                {createdTracks.map((track, index) => (
                  <TrackListItem key={track.id} track={track} index={index} />
                ))}
              </div>
            ) : (
              <div className="text-center py-12 bg-card/30 rounded-xl border border-border/30">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-glow-primary/20 to-glow-secondary/20 flex items-center justify-center mx-auto mb-4">
                  <Sparkles className="w-8 h-8 text-glow-primary" />
                </div>
                <h3 className="text-lg font-medium text-foreground mb-2">No tracks created yet</h3>
                <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
                  Create your first AI-generated track with just a text prompt
                </p>
                <Button
                  onClick={() => setIsCreateModalOpen(true)}
                  className="bg-gradient-to-r from-glow-primary to-glow-secondary hover:opacity-90 text-white"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Create Your First Track
                </Button>
              </div>
            )}
          </section>

          {/* My Favorites Playlist */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-pink-500 to-rose-600 flex items-center justify-center">
                  <Heart className="w-5 h-5 text-white fill-current" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-foreground">My Favorites Playlist</h2>
                  <p className="text-sm text-muted-foreground">
                    {favorites.length} {favorites.length === 1 ? "track" : "tracks"} you've saved
                  </p>
                </div>
              </div>
              {favorites.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handlePlayAll(favorites)}
                  className="text-pink-400 hover:text-pink-400 hover:bg-pink-500/10"
                >
                  <Play className="w-4 h-4 mr-2" />
                  Play All
                </Button>
              )}
            </div>

            {favorites.length > 0 ? (
              <div className="bg-card/30 rounded-xl border border-border/30 overflow-hidden">
                {favorites.map((track, index) => (
                  <TrackListItem key={track.id} track={track} index={index} />
                ))}
              </div>
            ) : (
              <div className="text-center py-12 bg-card/30 rounded-xl border border-border/30">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-pink-500/20 to-rose-600/20 flex items-center justify-center mx-auto mb-4">
                  <Heart className="w-8 h-8 text-pink-400" />
                </div>
                <h3 className="text-lg font-medium text-foreground mb-2">No favorites yet</h3>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  Open any track and tap "Add Favorite" to save it to this playlist.
                </p>
              </div>
            )}
          </section>

          {/* Liked Tracks */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-pink-500 to-rose-600 flex items-center justify-center">
                  <Heart className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-foreground">Liked Tracks</h2>
                  <p className="text-sm text-muted-foreground">{likedTracks.length} tracks you love</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handlePlayAll(likedTracks)}
                  className="text-pink-400 hover:text-pink-400 hover:bg-pink-500/10"
                >
                  <Play className="w-4 h-4 mr-2" />
                  Play All
                </Button>
                <Button variant="ghost" size="sm" className="text-muted-foreground">
                  See All
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>

            <div className="bg-card/30 rounded-xl border border-border/30 overflow-hidden">
              {likedTracks.map((track, index) => (
                <TrackListItem key={track.id} track={track} index={index} />
              ))}
            </div>
          </section>

          {/* Recently Played */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
                  <Clock className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-foreground">Recently Played</h2>
                  <p className="text-sm text-muted-foreground">Pick up where you left off</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" className="text-muted-foreground">
                See All
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>

            <div className="bg-card/30 rounded-xl border border-border/30 overflow-hidden">
              {recentlyPlayed.map((track, index) => (
                <TrackListItem key={track.id} track={track} index={index} showIndex={false} />
              ))}
            </div>
          </section>

          {/* My Playlists */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                  <ListMusic className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-foreground">My Playlists</h2>
                  <p className="text-sm text-muted-foreground">Organize your music</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              <PlaylistCard title="Create Playlist" trackCount={0} isEmpty />
              {/* Placeholder playlists - empty state for now */}
            </div>
          </section>

          {/* Followed AI Agents */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
                  <Users className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-foreground">Followed AI Agents</h2>
                  <p className="text-sm text-muted-foreground">{followedAgents.length} agents you follow</p>
                </div>
              </div>
              <Link href="/explore" className="flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors">
                Discover More
                <ChevronRight className="w-4 h-4 ml-1" />
              </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {followedAgents.map((agent) => (
                <FollowedAgentCard key={agent.id} agent={agent} />
              ))}
            </div>
          </section>

          {/* Quick Stats */}
          <section className="bg-card/30 rounded-xl border border-border/30 p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">Your Activity</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center p-4 bg-background/50 rounded-lg">
                <Sparkles className="w-6 h-6 text-glow-primary mx-auto mb-2" />
                <div className="text-2xl font-bold text-foreground">{createdTracks.length}</div>
                <div className="text-xs text-muted-foreground">Tracks Created</div>
              </div>
              <div className="text-center p-4 bg-background/50 rounded-lg">
                <Heart className="w-6 h-6 text-pink-500 mx-auto mb-2" />
                <div className="text-2xl font-bold text-foreground">{likedTracks.length}</div>
                <div className="text-xs text-muted-foreground">Liked Tracks</div>
              </div>
              <div className="text-center p-4 bg-background/50 rounded-lg">
                <Clock className="w-6 h-6 text-cyan-500 mx-auto mb-2" />
                <div className="text-2xl font-bold text-foreground">{recentlyPlayed.length}</div>
                <div className="text-xs text-muted-foreground">Recently Played</div>
              </div>
              <div className="text-center p-4 bg-background/50 rounded-lg">
                <Users className="w-6 h-6 text-emerald-500 mx-auto mb-2" />
                <div className="text-2xl font-bold text-foreground">{followedAgents.length}</div>
                <div className="text-xs text-muted-foreground">Agents Followed</div>
              </div>
            </div>
          </section>
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
