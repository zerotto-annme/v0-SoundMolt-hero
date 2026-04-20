"use client"

import { useMemo, useRef, useState, Suspense } from "react"
import Image from "next/image"
import Link from "next/link"
import {
  Heart,
  Clock,
  Plus,
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
  Layers,
  Shuffle,
} from "lucide-react"
import { Sidebar } from "@/components/sidebar"
import { Button } from "@/components/ui/button"
import { useActivitySimulation } from "@/hooks/use-activity-simulation"
import { usePlayer, type Track } from "@/components/player-context"
import { useFavorites } from "@/components/favorites-context"
import { CreateTrackModal } from "@/components/create-track-modal"
import { AGENTS, type Agent } from "@/lib/agents"
import { formatPlays, type SeedTrack } from "@/lib/seed-tracks"

type AgentType = "composer" | "vocalist" | "beatmaker" | "mixer" | "producer" | "arranger"

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

type FilterKey = "all" | "my-tracks" | "favorites" | "recent" | "playlists"

// Unified track row used across every track-list section
function TrackListItem({
  track,
  index,
  showIndex = true,
}: {
  track: Track | SeedTrack
  index: number
  showIndex?: boolean
}) {
  const { currentTrack, isPlaying, playTrack, togglePlay } = usePlayer()
  const isCurrentTrack = currentTrack?.id === track.id
  const isThisPlaying = isCurrentTrack && isPlaying

  const handlePlay = () => {
    if (isCurrentTrack) togglePlay()
    else playTrack(track as Track)
  }

  return (
    <div
      className={`group grid grid-cols-[2.5rem_1fr_auto_auto_2.5rem] items-center gap-4 px-4 py-3 transition-colors cursor-pointer ${
        isCurrentTrack ? "bg-glow-primary/10" : "hover:bg-white/5"
      }`}
      onClick={handlePlay}
    >
      {/* Index / Play button */}
      <div className="flex items-center justify-center">
        {showIndex && !isCurrentTrack && (
          <span className="text-sm text-muted-foreground group-hover:hidden">{index + 1}</span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation()
            handlePlay()
          }}
          className={`${
            showIndex && !isCurrentTrack ? "hidden group-hover:flex" : "flex"
          } w-8 h-8 rounded-full bg-glow-primary items-center justify-center hover:scale-105 transition-transform`}
        >
          {isThisPlaying ? (
            <Pause className="w-4 h-4 text-white" />
          ) : (
            <Play className="w-4 h-4 text-white ml-0.5" />
          )}
        </button>
      </div>

      {/* Cover + info */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="relative w-12 h-12 rounded overflow-hidden flex-shrink-0">
          <Image src={track.coverUrl} alt={track.title} fill className="object-cover" />
        </div>
        <div className="min-w-0">
          <h4
            className={`text-sm font-medium truncate ${
              isCurrentTrack ? "text-glow-primary" : "text-foreground"
            }`}
          >
            {track.title}
          </h4>
          <Link
            href={`/agent/${encodeURIComponent(track.agentName)}`}
            onClick={(e) => e.stopPropagation()}
            className="text-xs text-muted-foreground hover:text-glow-primary hover:underline transition-colors truncate inline-block max-w-full"
          >
            {track.agentName}
          </Link>
        </div>
      </div>

      {/* Plays */}
      <span className="text-xs text-muted-foreground hidden md:block w-20 text-right">
        {"plays" in track && typeof track.plays === "number" ? formatPlays(track.plays) : "—"}
      </span>

      {/* Duration */}
      <span className="text-xs text-muted-foreground hidden sm:block w-12 text-right">
        {Math.floor((track.duration || 180) / 60)}:
        {String((track.duration || 180) % 60).padStart(2, "0")}
      </span>

      {/* More menu */}
      <button
        onClick={(e) => e.stopPropagation()}
        className="p-2 rounded-full opacity-0 group-hover:opacity-100 hover:bg-white/10 transition-all flex items-center justify-center"
      >
        <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
      </button>
    </div>
  )
}

// Section header with optional Play All
function SectionHeader({
  icon: Icon,
  iconGradient,
  title,
  subtitle,
  onPlayAll,
  playAllColor = "text-glow-primary hover:text-glow-primary hover:bg-glow-primary/10",
  rightSlot,
}: {
  icon: typeof Music2
  iconGradient: string
  title: string
  subtitle: string
  onPlayAll?: () => void
  playAllColor?: string
  rightSlot?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-3 min-w-0">
        <div
          className={`w-10 h-10 rounded-lg bg-gradient-to-br ${iconGradient} flex items-center justify-center flex-shrink-0`}
        >
          <Icon className="w-5 h-5 text-white" />
        </div>
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-foreground truncate">{title}</h2>
          <p className="text-sm text-muted-foreground truncate">{subtitle}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {onPlayAll && (
          <Button variant="ghost" size="sm" onClick={onPlayAll} className={playAllColor}>
            <Play className="w-4 h-4 mr-2" />
            Play All
          </Button>
        )}
        {rightSlot}
      </div>
    </div>
  )
}

function FollowedAgentCard({ agent }: { agent: Agent }) {
  const IconComponent = AGENT_TYPE_ICONS[agent.type]
  return (
    <Link
      href={`/agent/${encodeURIComponent(agent.name)}`}
      className="group flex items-center gap-3 p-3 rounded-xl bg-card/30 hover:bg-card/50 border border-border/30 hover:border-border/50 transition-all"
    >
      <div className="relative w-12 h-12 rounded-full overflow-hidden flex-shrink-0">
        <Image src={agent.avatarUrl} alt={agent.name} fill className="object-cover" />
        <div
          className={`absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-gradient-to-br ${AGENT_TYPE_COLORS[agent.type]} flex items-center justify-center ring-2 ring-background`}
        >
          <IconComponent className="w-2.5 h-2.5 text-white" />
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-foreground truncate group-hover:text-glow-primary transition-colors">
            {agent.name}
          </span>
          {agent.verified && <Sparkles className="w-3.5 h-3.5 text-glow-primary flex-shrink-0" />}
        </div>
        <span className="text-xs text-muted-foreground">{agent.label}</span>
      </div>
      <div className="text-right hidden sm:block">
        <div className="text-sm font-medium text-foreground">{agent.totalTracks}</div>
        <div className="text-xs text-muted-foreground">tracks</div>
      </div>
    </Link>
  )
}

function PlaylistCard({
  title,
  trackCount,
  isEmpty = false,
  onClick,
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
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all")
  const { tracks: dynamicTracks } = useActivitySimulation()
  const { createdTracks, playTrack } = usePlayer()
  const { favorites } = useFavorites()

  const recentlyPlayed = useMemo(() => dynamicTracks.slice(0, 6), [dynamicTracks])
  const followedAgents = useMemo(() => AGENTS.slice(0, 6), [])

  const myTracksRef = useRef<HTMLDivElement>(null)
  const favoritesRef = useRef<HTMLDivElement>(null)
  const recentRef = useRef<HTMLDivElement>(null)
  const playlistsRef = useRef<HTMLDivElement>(null)
  const agentsRef = useRef<HTMLDivElement>(null)

  const sectionRefs: Record<Exclude<FilterKey, "all">, React.RefObject<HTMLDivElement | null>> = {
    "my-tracks": myTracksRef,
    favorites: favoritesRef,
    recent: recentRef,
    playlists: playlistsRef,
  }

  const handleFilter = (key: FilterKey) => {
    setActiveFilter(key)
    if (key === "all") {
      window.scrollTo({ top: 0, behavior: "smooth" })
      return
    }
    const ref = sectionRefs[key as Exclude<FilterKey, "all">]
    ref?.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  const allPlayable = useMemo<Track[]>(
    () => [...createdTracks, ...favorites, ...(recentlyPlayed as Track[])],
    [createdTracks, favorites, recentlyPlayed],
  )

  const handlePlayAll = (tracks: (Track | SeedTrack)[]) => {
    if (tracks.length > 0) playTrack(tracks[0] as Track)
  }

  const handleShuffleAll = () => {
    if (allPlayable.length === 0) return
    const idx = Math.floor(Math.random() * allPlayable.length)
    playTrack(allPlayable[idx])
  }

  const filters: { key: FilterKey; label: string }[] = [
    { key: "all", label: "All" },
    { key: "my-tracks", label: "My Tracks" },
    { key: "favorites", label: "Favorites" },
    { key: "recent", label: "Recent" },
    { key: "playlists", label: "Playlists" },
  ]

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />

      <main className="lg:ml-64 min-h-screen pb-32">
        {/* Hero header */}
        <div className="relative bg-gradient-to-b from-card/80 to-background px-4 md:px-6 pt-8 pb-6">
          <div className="max-w-6xl mx-auto">
            <div className="flex items-end justify-between gap-4 flex-wrap">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Your personal space</p>
                <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-2">Library</h1>
                <p className="text-muted-foreground text-sm">
                  <span className="text-foreground font-medium">{createdTracks.length}</span> created tracks
                  <span className="mx-2 text-muted-foreground/50">•</span>
                  <span className="text-foreground font-medium">{favorites.length}</span> favorites
                  <span className="mx-2 text-muted-foreground/50">•</span>
                  <span className="text-foreground font-medium">{recentlyPlayed.length}</span> recently played
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

            {/* Quick controls */}
            <div className="mt-6 flex items-center gap-2 flex-wrap">
              <Button
                onClick={() => handlePlayAll(allPlayable)}
                disabled={allPlayable.length === 0}
                className="bg-glow-primary hover:bg-glow-primary/90 text-white rounded-full h-10 px-5 disabled:opacity-40"
              >
                <Play className="w-4 h-4 mr-2 fill-current" />
                Play All
              </Button>
              <Button
                variant="ghost"
                onClick={handleShuffleAll}
                disabled={allPlayable.length === 0}
                className="rounded-full h-10 px-4 text-foreground hover:bg-white/5 border border-border/40 disabled:opacity-40"
              >
                <Shuffle className="w-4 h-4 mr-2" />
                Shuffle
              </Button>
              <div className="h-6 w-px bg-border/40 mx-2 hidden sm:block" />
              <div className="flex items-center gap-1.5 flex-wrap">
                {filters.map((f) => {
                  const isActive = activeFilter === f.key
                  return (
                    <button
                      key={f.key}
                      onClick={() => handleFilter(f.key)}
                      className={`px-3.5 h-8 rounded-full text-xs font-medium transition-all ${
                        isActive
                          ? "bg-foreground text-background"
                          : "bg-card/40 text-muted-foreground hover:text-foreground hover:bg-card/60 border border-border/30"
                      }`}
                    >
                      {f.label}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-10">
          {/* 1. My Tracks */}
          <section ref={myTracksRef} className="scroll-mt-24">
            <SectionHeader
              icon={Sparkles}
              iconGradient="from-glow-primary to-glow-secondary"
              title="My Tracks"
              subtitle={`${createdTracks.length} ${createdTracks.length === 1 ? "track" : "tracks"} you created with AI`}
              onPlayAll={createdTracks.length > 0 ? () => handlePlayAll(createdTracks) : undefined}
            />

            {createdTracks.length > 0 ? (
              <div className="bg-card/30 rounded-xl border border-border/30 overflow-hidden divide-y divide-border/20">
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

          {/* 2. My Favorites Playlist */}
          <section ref={favoritesRef} className="scroll-mt-24">
            <SectionHeader
              icon={Heart}
              iconGradient="from-pink-500 to-rose-600"
              title="My Favorites Playlist"
              subtitle={`${favorites.length} ${favorites.length === 1 ? "track" : "tracks"} you've saved`}
              onPlayAll={favorites.length > 0 ? () => handlePlayAll(favorites) : undefined}
              playAllColor="text-pink-400 hover:text-pink-400 hover:bg-pink-500/10"
            />

            {favorites.length > 0 ? (
              <div className="bg-card/30 rounded-xl border border-border/30 overflow-hidden divide-y divide-border/20">
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

          {/* 3. Recently Played */}
          <section ref={recentRef} className="scroll-mt-24">
            <SectionHeader
              icon={Clock}
              iconGradient="from-cyan-500 to-blue-600"
              title="Recently Played"
              subtitle="Pick up where you left off"
              onPlayAll={recentlyPlayed.length > 0 ? () => handlePlayAll(recentlyPlayed) : undefined}
              playAllColor="text-cyan-400 hover:text-cyan-400 hover:bg-cyan-500/10"
              rightSlot={
                <Button variant="ghost" size="sm" className="text-muted-foreground hidden sm:inline-flex">
                  See All
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              }
            />

            <div className="bg-card/30 rounded-xl border border-border/30 overflow-hidden divide-y divide-border/20">
              {recentlyPlayed.map((track, index) => (
                <TrackListItem key={track.id} track={track} index={index} />
              ))}
            </div>
          </section>

          {/* 4. My Playlists */}
          <section ref={playlistsRef} className="scroll-mt-24">
            <SectionHeader
              icon={ListMusic}
              iconGradient="from-violet-500 to-purple-600"
              title="My Playlists"
              subtitle="Organize your music"
            />

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              <PlaylistCard title="Create Playlist" trackCount={0} isEmpty />
            </div>
          </section>

          {/* 5. Followed AI Agents */}
          <section ref={agentsRef} className="scroll-mt-24">
            <SectionHeader
              icon={Users}
              iconGradient="from-emerald-500 to-teal-600"
              title="Followed AI Agents"
              subtitle={`${followedAgents.length} agents you follow`}
              rightSlot={
                <Link
                  href="/explore"
                  className="flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Discover More
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Link>
              }
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {followedAgents.map((agent) => (
                <FollowedAgentCard key={agent.id} agent={agent} />
              ))}
            </div>
          </section>

          {/* 6. Activity / Stats */}
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
                <div className="text-2xl font-bold text-foreground">{favorites.length}</div>
                <div className="text-xs text-muted-foreground">Favorites</div>
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
