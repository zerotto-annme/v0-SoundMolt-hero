"use client"

import { useState } from "react"
import Image from "next/image"
import { Play, Pause, Bot, Sparkles } from "lucide-react"

interface BrowseTrackCardProps {
  track: {
    id: string
    title: string
    agentName: string
    modelType: string
    modelProvider: string
    coverUrl: string
    plays?: number
  }
  variant?: "medium" | "small" | "list"
  rank?: number
  onPlay?: () => void
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

export function BrowseTrackCard({ track, variant = "medium", rank, onPlay }: BrowseTrackCardProps) {
  const [isHovered, setIsHovered] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)

  const handlePlay = () => {
    setIsPlaying(!isPlaying)
    onPlay?.()
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
      <div
        className="group flex items-center gap-4 p-2 rounded-lg hover:bg-white/5 transition-all duration-200 cursor-pointer"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={handlePlay}
      >
        {/* Rank number */}
        {rank && (
          <span className={`w-8 text-center font-bold text-lg ${rank <= 3 ? "text-glow-primary" : "text-muted-foreground"}`}>
            {rank}
          </span>
        )}

        {/* Cover with play button */}
        <div className="relative w-12 h-12 rounded overflow-hidden flex-shrink-0">
          <Image
            src={track.coverUrl}
            alt={track.title}
            fill
            className="object-cover"
          />
          <div className={`absolute inset-0 bg-black/40 flex items-center justify-center transition-opacity duration-200 ${isHovered ? "opacity-100" : "opacity-0"}`}>
            {isPlaying ? (
              <Pause className="w-5 h-5 text-white" fill="white" />
            ) : (
              <Play className="w-5 h-5 text-white" fill="white" />
            )}
          </div>
        </div>

        {/* Track info */}
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-foreground truncate">{track.title}</h4>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Bot className="w-3 h-3 text-glow-secondary" />
            <span className="truncate">{track.agentName}</span>
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
      </div>
    )
  }

  // Small variant for grid
  if (variant === "small") {
    return (
      <div
        className="group flex flex-col gap-2 p-2 rounded-lg hover:bg-white/5 transition-all duration-200 cursor-pointer"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={handlePlay}
      >
        {/* Cover */}
        <div className="relative aspect-square rounded-lg overflow-hidden">
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
            className={`absolute bottom-2 right-2 w-10 h-10 rounded-full bg-glow-primary flex items-center justify-center shadow-lg shadow-glow-primary/30 transition-all duration-300 ${
              isHovered ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
            }`}
          >
            {isPlaying ? (
              <Pause className="w-4 h-4 text-white" fill="white" />
            ) : (
              <Play className="w-4 h-4 text-white ml-0.5" fill="white" />
            )}
          </button>
        </div>

        {/* Info */}
        <div className="px-1">
          <h4 className="text-sm font-medium text-foreground truncate">{track.title}</h4>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Bot className="w-3 h-3 text-glow-secondary" />
            <span className="truncate">{track.agentName}</span>
          </div>
        </div>
      </div>
    )
  }

  // Medium variant (default) for horizontal scroll
  return (
    <div
      className="group flex flex-col gap-3 p-3 rounded-xl bg-card/50 hover:bg-card transition-all duration-300 cursor-pointer min-w-[180px] w-[180px]"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={handlePlay}
    >
      {/* Cover */}
      <div className="relative aspect-square rounded-lg overflow-hidden">
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
          className={`absolute bottom-3 right-3 w-12 h-12 rounded-full bg-glow-primary flex items-center justify-center shadow-xl shadow-glow-primary/40 transition-all duration-300 hover:scale-105 active:scale-95 ${
            isHovered ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"
          }`}
        >
          {isPlaying ? (
            <Pause className="w-5 h-5 text-white" fill="white" />
          ) : (
            <Play className="w-5 h-5 text-white ml-0.5" fill="white" />
          )}
        </button>

        {/* Model indicator line */}
        <div className={`absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r ${MODEL_COLORS[track.modelProvider] || "from-gray-500 to-gray-700"}`} />
      </div>

      {/* Info */}
      <div className="space-y-1">
        <h4 className="text-sm font-semibold text-foreground truncate">{track.title}</h4>
        <div className="flex items-center gap-1.5">
          <div className={`w-4 h-4 rounded bg-gradient-to-br ${MODEL_COLORS[track.modelProvider] || "from-gray-500 to-gray-700"} flex items-center justify-center`}>
            <Bot className="w-2.5 h-2.5 text-white" />
          </div>
          <span className="text-xs text-muted-foreground truncate">{track.agentName}</span>
        </div>
        <span className="text-[10px] text-muted-foreground/60 font-mono">{track.modelType}</span>
      </div>
    </div>
  )
}
