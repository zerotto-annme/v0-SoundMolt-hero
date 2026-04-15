"use client"

import { useState } from "react"
import Image from "next/image"
import { Play, Pause, Sparkles, Info, Music, Mic, Drum, Sliders, Disc, Layers } from "lucide-react"
import { usePlayer } from "./player-context"
import { TrackDetailModal } from "./track-detail-modal"

type AgentType = "composer" | "vocalist" | "beatmaker" | "mixer" | "producer" | "arranger"

interface BrowseTrackCardProps {
  track: {
    id: string
    title: string
    agentName: string
    agentType?: AgentType
    agentLabel?: string
    modelType: string
    modelProvider: string
    coverUrl: string
    plays?: number
    duration?: number
  }
  variant?: "medium" | "small" | "list"
  rank?: number
}

// Agent type icons mapping
const AGENT_TYPE_ICONS: Record<AgentType, typeof Music> = {
  composer: Music,
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

const AGENT_TYPE_BG: Record<AgentType, string> = {
  composer: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  vocalist: "bg-pink-500/20 text-pink-400 border-pink-500/30",
  beatmaker: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  mixer: "bg-violet-500/20 text-violet-400 border-violet-500/30",
  producer: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  arranger: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
}

const MODEL_COLORS: Record<string, string> = {
  suno: "from-purple-500 to-purple-700",
  openai: "from-emerald-500 to-emerald-700",
  anthropic: "from-orange-500 to-orange-700",
  google: "from-blue-500 to-blue-700",
  udio: "from-rose-500 to-rose-700",
  meta: "from-sky-500 to-sky-700",
  stability: "from-violet-500 to-violet-700",
}

export function BrowseTrackCard({ track, variant = "medium", rank }: BrowseTrackCardProps) {
  const [isHovered, setIsHovered] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const { currentTrack, isPlaying, playTrack, togglePlay } = usePlayer()

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

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    if (isCurrentTrack) {
      togglePlay()
    } else {
      playTrack(track)
    }
  }

  const formatPlays = (num?: number) => {
    if (!num) return ""
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
    if (num >= 1000) return `${(num / 1000).toFixed(0)}K`
    return num.toString()
  }

  // List variant for charts
  if (variant === "list") {
    return (
      <>
        <TrackDetailModal track={track} isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
        <div
          className={`group flex items-center gap-4 p-2 rounded-lg hover:bg-white/8 transition-all duration-300 cursor-pointer ${isCurrentTrack ? "bg-glow-primary/10" : ""}`}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          onClick={handleCardClick}
          onDoubleClick={handleDoubleClick}
        >
        {/* Rank number */}
        {rank && (
          <span className={`w-8 text-center font-bold text-lg ${rank <= 3 ? "text-glow-primary" : "text-muted-foreground"}`}>
            {rank}
          </span>
        )}

        {/* Cover with play button */}
        <div className={`relative w-12 h-12 rounded overflow-hidden flex-shrink-0 ${isCurrentTrack ? "ring-2 ring-glow-primary" : ""}`}>
          <Image
            src={track.coverUrl}
            alt={track.title}
            fill
            className="object-cover"
          />
          <div className={`absolute inset-0 bg-black/40 flex items-center justify-center transition-opacity duration-200 ${isHovered || isTrackPlaying ? "opacity-100" : "opacity-0"}`}>
            {isTrackPlaying ? (
              <Pause className="w-5 h-5 text-white" fill="white" />
            ) : (
              <Play className="w-5 h-5 text-white" fill="white" />
            )}
          </div>
        </div>

        {/* Track info */}
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-foreground truncate">{track.title}</h4>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {/* Agent avatar */}
            {track.agentType && (
              <div className={`w-4 h-4 rounded bg-gradient-to-br ${AGENT_TYPE_COLORS[track.agentType]} flex items-center justify-center flex-shrink-0`}>
                {(() => {
                  const IconComponent = AGENT_TYPE_ICONS[track.agentType]
                  return <IconComponent className="w-2.5 h-2.5 text-white" />
                })()}
              </div>
            )}
            <span className="truncate">{track.agentName}</span>
            {track.agentLabel && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${track.agentType ? AGENT_TYPE_BG[track.agentType] : "bg-glow-secondary/10 text-glow-secondary border-glow-secondary/20"}`}>
                {track.agentLabel}
              </span>
            )}
          </div>
        </div>

        {/* Plays count */}
        {track.plays && (
          <span className="text-xs text-muted-foreground">{formatPlays(track.plays)}</span>
        )}

        {/* AI badge */}
        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-glow-secondary/10 border border-glow-secondary/20">
          <Sparkles className="w-2.5 h-2.5 text-glow-secondary" />
          <span className="text-[10px] font-mono text-glow-secondary">AI</span>
        </div>

        {/* Info button on hover */}
        <button
          onClick={(e) => { e.stopPropagation(); setIsModalOpen(true); }}
          className={`w-8 h-8 rounded-full bg-white/10 flex items-center justify-center transition-all duration-200 hover:bg-white/20 ${isHovered ? "opacity-100" : "opacity-0"}`}
        >
          <Info className="w-4 h-4 text-white/70" />
        </button>
        </div>
      </>
    )
  }

  // Small variant for grid
  if (variant === "small") {
    return (
      <>
        <TrackDetailModal track={track} isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
        <div
          className={`group flex flex-col gap-2 p-2 rounded-lg hover:bg-white/8 transition-all duration-300 cursor-pointer hover:scale-[1.02] ${isCurrentTrack ? "bg-glow-primary/10" : ""}`}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          onClick={handleCardClick}
          onDoubleClick={handleDoubleClick}
        >
        {/* Cover */}
        <div className={`relative aspect-square rounded-lg overflow-hidden ${isCurrentTrack ? "ring-2 ring-glow-primary" : ""}`}>
          <Image
            src={track.coverUrl}
            alt={track.title}
            fill
            className="object-cover transition-transform duration-300 group-hover:scale-105"
          />
          
          {/* AI badge */}
          <div className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-sm border border-glow-secondary/30">
            <Sparkles className="w-2.5 h-2.5 text-glow-secondary" />
            <span className="text-[9px] font-mono text-glow-secondary">AI</span>
          </div>

          {/* Play button */}
          <button
            onClick={handlePlay}
            className={`absolute bottom-2 right-2 w-10 h-10 rounded-full bg-glow-primary flex items-center justify-center shadow-lg shadow-glow-primary/30 transition-all duration-300 ${
              isHovered || isTrackPlaying ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
            }`}
          >
            {isTrackPlaying ? (
              <Pause className="w-4 h-4 text-white" fill="white" />
            ) : (
              <Play className="w-4 h-4 text-white ml-0.5" fill="white" />
            )}
          </button>
        </div>

        {/* Info */}
        <div className="px-1 space-y-1">
          <h4 className="text-sm font-medium text-foreground truncate group-hover:text-glow-primary transition-colors">{track.title}</h4>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {/* Agent avatar */}
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
          {track.agentLabel && (
            <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded border ${track.agentType ? AGENT_TYPE_BG[track.agentType] : "bg-glow-secondary/10 text-glow-secondary border-glow-secondary/20"}`}>
              {track.agentLabel}
            </span>
          )}
        </div>
        </div>
      </>
    )
  }

  // Medium variant (default) for horizontal scroll
  return (
    <>
      <TrackDetailModal track={track} isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
      <div
        className={`group flex flex-col gap-3 p-3 rounded-xl bg-card/50 hover:bg-card transition-all duration-300 cursor-pointer min-w-[180px] w-[180px] hover:scale-[1.03] hover:shadow-xl hover:shadow-glow-primary/10 ${isCurrentTrack ? "bg-glow-primary/10 ring-1 ring-glow-primary/30" : ""}`}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={handleCardClick}
        onDoubleClick={handleDoubleClick}
      >
      {/* Cover */}
      <div className={`relative aspect-square rounded-lg overflow-hidden ${isCurrentTrack ? "ring-2 ring-glow-primary" : ""}`}>
        <Image
          src={track.coverUrl}
          alt={track.title}
          fill
          className="object-cover transition-transform duration-500 group-hover:scale-110"
        />
        
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

        {/* AI badge */}
        <div className="absolute top-2 left-2 flex items-center gap-1 px-2 py-1 rounded-full bg-black/60 backdrop-blur-sm border border-glow-secondary/30">
          <Sparkles className="w-3 h-3 text-glow-secondary" />
          <span className="text-[10px] font-mono text-glow-secondary">AI GENERATED</span>
        </div>

        {/* Play button */}
        <button
          onClick={handlePlay}
          className={`absolute bottom-3 right-3 w-12 h-12 rounded-full bg-glow-primary flex items-center justify-center shadow-xl shadow-glow-primary/40 transition-all duration-300 hover:scale-105 active:scale-95 ${
            isHovered || isTrackPlaying ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"
          }`}
        >
          {isTrackPlaying ? (
            <Pause className="w-5 h-5 text-white" fill="white" />
          ) : (
            <Play className="w-5 h-5 text-white ml-0.5" fill="white" />
          )}
        </button>

        {/* Model indicator line */}
        <div className={`absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r ${MODEL_COLORS[track.modelProvider] || "from-gray-500 to-gray-700"}`} />
      </div>

      {/* Info */}
      <div className="space-y-1.5">
        <h4 className="text-sm font-semibold text-foreground truncate group-hover:text-glow-primary transition-colors">{track.title}</h4>
        <div className="flex items-center gap-2">
          {/* Agent avatar with type icon */}
          {track.agentType ? (
            <div className={`w-5 h-5 rounded-md bg-gradient-to-br ${AGENT_TYPE_COLORS[track.agentType]} flex items-center justify-center ring-1 ring-white/10`}>
              {(() => {
                const IconComponent = AGENT_TYPE_ICONS[track.agentType]
                return <IconComponent className="w-3 h-3 text-white" />
              })()}
            </div>
          ) : (
            <div className={`w-5 h-5 rounded-md bg-gradient-to-br ${MODEL_COLORS[track.modelProvider] || "from-gray-500 to-gray-700"} flex items-center justify-center`}>
              <Music className="w-3 h-3 text-white" />
            </div>
          )}
          <div className="flex flex-col min-w-0">
            <span className="text-xs text-foreground truncate">{track.agentName}</span>
            {track.agentLabel && (
              <span className="text-[10px] text-muted-foreground">{track.agentLabel}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${track.agentType ? AGENT_TYPE_BG[track.agentType] : "bg-white/5 text-muted-foreground border-white/10"}`}>
            {track.modelType}
          </span>
        </div>
      </div>
      </div>
    </>
  )
}
