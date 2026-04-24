"use client"

import { memo, useState } from "react"
import Image from "next/image"
import { Play, Pause, Sparkles, TrendingUp, TrendingDown, Minus, Star, Music, Mic, Drum, Sliders, Disc, Layers, Download, Heart } from "lucide-react"
import { usePlayer } from "./player-context"
import { TrackDetailModal } from "./track-detail-modal"
import { formatPlays } from "@/lib/seed-tracks"
import type { ChartTrack } from "@/hooks/use-activity-simulation"

type AgentType = "composer" | "vocalist" | "beatmaker" | "mixer" | "producer" | "arranger"

const AGENT_TYPE_ICONS: Record<AgentType, typeof Music> = {
  composer: Music,
  vocalist: Mic,
  beatmaker: Drum,
  mixer: Sliders,
  producer: Disc,
  arranger: Layers,
}

// Per color spec: AI/agent labels/badges use unified secondary purple.
const AGENT_TYPE_COLORS: Record<AgentType, string> = {
  composer: "from-glow-secondary to-violet-600",
  vocalist: "from-glow-secondary to-violet-600",
  beatmaker: "from-glow-secondary to-violet-600",
  mixer: "from-glow-secondary to-violet-600",
  producer: "from-glow-secondary to-violet-600",
  arranger: "from-glow-secondary to-violet-600",
}

interface ChartTrackCardProps {
  track: ChartTrack
  rank: number
  /** Optional one-line "why recommended" reason from the recommendation API. */
  reason?: string | null
}

function ChartTrackCardImpl({ track, rank, reason }: ChartTrackCardProps) {
  const [isHovered, setIsHovered] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const { currentTrack, isPlaying, playTrack, togglePlay } = usePlayer()

  const { movement, movementAmount, weeklyTrendScore } = track
  const isCurrentTrack = currentTrack?.id === track.id
  const isTrackPlaying = isCurrentTrack && isPlaying

  const handlePlay = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isCurrentTrack) {
      togglePlay()
    } else {
      playTrack(track)
    }
  }

  const handleCardClick = () => {
    setIsModalOpen(true)
  }

  // Rank styling — per spec:
  //   #1 → gold (#F5B700), #2 → silver (#A0A0A0), #3 → bronze (#CD7F32)
  //   others → default text color (no red, no special accent)
  const getRankStyle = () => {
    if (rank === 1) return "rank-1 font-black"
    if (rank === 2) return "rank-2 font-bold"
    if (rank === 3) return "rank-3 font-bold"
    return "bg-white/5 text-foreground font-medium"
  }

  // Movement indicator
  const MovementIndicator = () => {
    if (movement === "new") {
      return (
        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/30">
          <Star className="w-3 h-3 text-emerald-400" />
          <span className="text-[10px] font-bold text-emerald-400">NEW</span>
        </div>
      )
    }
    if (movement === "up") {
      return (
        <div className="flex items-center gap-0.5 text-emerald-400">
          <TrendingUp className="w-3.5 h-3.5" />
          <span className="text-xs font-bold tabular-nums">+{movementAmount}</span>
        </div>
      )
    }
    if (movement === "down") {
      return (
        <div className="flex items-center gap-0.5 text-red-400">
          <TrendingDown className="w-3.5 h-3.5" />
          <span className="text-xs font-bold tabular-nums">-{movementAmount}</span>
        </div>
      )
    }
    return (
      <div className="flex items-center text-muted-foreground/50">
        <Minus className="w-3.5 h-3.5" />
      </div>
    )
  }

  // Weekly trend indicator
  const TrendIndicator = () => {
    if (weeklyTrendScore > 500) {
      return (
        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-glow-primary/10 border border-glow-primary/20">
          <TrendingUp className="w-3 h-3 text-glow-primary animate-pulse" />
          <span className="text-[10px] font-mono text-glow-primary">HOT</span>
        </div>
      )
    }
    return null
  }

  return (
    <>
      <TrackDetailModal track={track} isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
      <div
        className={`group flex items-center gap-3 p-2.5 rounded-xl transition-all duration-300 cursor-pointer ${
          isCurrentTrack 
            ? "bg-glow-primary/10 ring-1 ring-glow-primary/30" 
            : "hover:bg-white/5"
        } ${rank <= 3 ? "bg-gradient-to-r from-white/5 to-transparent" : ""}`}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={handleCardClick}
      >
        {/* Rank */}
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${getRankStyle()}`}>
          {rank}
        </div>

        {/* Movement */}
        <div className="w-12 flex justify-center">
          <MovementIndicator />
        </div>

        {/* Cover with play button */}
        <div className={`relative w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 ${isCurrentTrack ? "ring-2 ring-glow-primary" : ""}`}>
          <Image
            src={track.coverUrl}
            alt={track.title}
            fill
            className="object-cover"
          />
          <div 
            className={`absolute inset-0 bg-black/50 flex items-center justify-center transition-all duration-200 ${
              isHovered || isTrackPlaying ? "opacity-100" : "opacity-0"
            }`}
            onClick={handlePlay}
          >
            {isTrackPlaying ? (
              <Pause className="w-5 h-5 text-white" fill="white" />
            ) : (
              <Play className="w-5 h-5 text-white ml-0.5" fill="white" />
            )}
          </div>
        </div>

        {/* Track info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-foreground truncate">{track.title}</h4>
            <TrendIndicator />
          </div>
          {reason && reason.trim() && (
            <p className="text-[11px] text-muted-foreground/80 truncate mt-0.5">
              <span className="mr-1">💡</span>
              <span className="text-muted-foreground/60">Matches your taste:</span>{" "}
              <span className="text-foreground/80">{reason}</span>
            </p>
          )}
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
            {track.agentType && (
              <div className={`w-4 h-4 rounded bg-gradient-to-br ${AGENT_TYPE_COLORS[track.agentType]} flex items-center justify-center flex-shrink-0`}>
                {(() => {
                  const IconComponent = AGENT_TYPE_ICONS[track.agentType]
                  return <IconComponent className="w-2.5 h-2.5 text-white" />
                })()}
              </div>
            )}
            <span className="truncate">{track.agentName}</span>
          </div>
        </div>

        {/* Stats */}
        <div className="hidden sm:flex items-center gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <Play className="w-3 h-3" />
            <span className="tabular-nums">{formatPlays(track.plays)}</span>
          </div>
          <div className="flex items-center gap-1">
            <Heart className="w-3 h-3" />
            <span className="tabular-nums">{formatPlays(track.likes)}</span>
          </div>
          <div className="flex items-center gap-1">
            <Download className="w-3 h-3" />
            <span className="tabular-nums">{formatPlays(track.downloads)}</span>
          </div>
        </div>

        {/* AI badge */}
        <div className="hidden md:flex items-center gap-1 px-2 py-1 rounded-full bg-glow-secondary/10 border border-glow-secondary/20">
          <Sparkles className="w-3 h-3 text-glow-secondary" />
          <span className="text-[10px] font-mono text-glow-secondary">AI</span>
        </div>
      </div>
    </>
  )
}

export const ChartTrackCard = memo(ChartTrackCardImpl)
