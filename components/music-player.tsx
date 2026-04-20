"use client"

import Image from "next/image"
import { 
  Play, 
  Pause, 
  SkipBack, 
  SkipForward, 
  Volume2, 
  VolumeX, 
  Volume1,
  Bot,
  Sparkles,
  ListMusic,
  Maximize2,
  Loader2
} from "lucide-react"
import { usePlayer, usePlayerProgress } from "./player-context"
import { Slider } from "@/components/ui/slider"

const MODEL_COLORS: Record<string, string> = {
  suno: "from-purple-500 to-purple-700",
  openai: "from-emerald-500 to-emerald-700",
  anthropic: "from-orange-500 to-orange-700",
  google: "from-blue-500 to-blue-700",
  udio: "from-rose-500 to-rose-700",
  meta: "from-sky-500 to-sky-700",
  stability: "from-violet-500 to-violet-700",
}

export function MusicPlayer() {
  const { 
    currentTrack, 
    isPlaying, 
    volume, 
    togglePlay, 
    nextTrack, 
    prevTrack, 
    setVolume,
    queue,
    queueIndex,
    isLoading
  } = usePlayer()
  const { progress, currentTime, duration, seekTo } = usePlayerProgress()

  const formatTime = (seconds: number) => {
    if (!seconds || !isFinite(seconds)) return "0:00"
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, "0")}`
  }

  // Get volume icon based on level
  const VolumeIcon = volume === 0 ? VolumeX : volume < 50 ? Volume1 : Volume2

  // Don't render if no track
  if (!currentTrack) {
    return null
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-xl border-t border-border/50">
      {/* Mobile progress bar on top */}
      <div 
        className="h-1 w-full bg-secondary/50 md:hidden cursor-pointer"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const percent = ((e.clientX - rect.left) / rect.width) * 100
          seekTo(percent)
        }}
      >
        <div 
          className="h-full bg-gradient-to-r from-glow-primary to-glow-secondary transition-all duration-150"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="flex items-center justify-between h-16 md:h-20 px-3 md:px-4 lg:pl-64">
        {/* Track info - Left */}
        <div className="flex items-center gap-3 w-1/4 min-w-0">
          {/* Album art */}
          <div className="relative w-12 h-12 md:w-14 md:h-14 rounded-md overflow-hidden flex-shrink-0 shadow-lg">
            <Image
              src={currentTrack.coverUrl}
              alt={currentTrack.title}
              fill
              className="object-cover"
            />
            {/* Loading overlay */}
            {isLoading && (
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                <Loader2 className="w-6 h-6 text-white animate-spin" />
              </div>
            )}
            {/* Glow when playing */}
            {isPlaying && !isLoading && (
              <div className="absolute inset-0 ring-2 ring-glow-primary/50 rounded-md animate-pulse" />
            )}
          </div>

          {/* Track details */}
          <div className="min-w-0 hidden sm:block">
            <h4 className="text-sm font-medium text-foreground truncate">{currentTrack.title}</h4>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Bot className="w-3 h-3 text-glow-secondary flex-shrink-0" />
              <span className="truncate">{currentTrack.agentName}</span>
              <span className="text-muted-foreground/50 hidden md:inline">|</span>
              <span className="text-[10px] font-mono text-glow-secondary/70 hidden md:inline">{currentTrack.modelType}</span>
            </div>
          </div>

          {/* AI indicator */}
          <div className="hidden lg:flex items-center gap-1 px-2 py-1 rounded-full bg-glow-secondary/10 border border-glow-secondary/20 ml-2">
            <Sparkles className="w-3 h-3 text-glow-secondary" />
            <span className="text-[10px] font-mono text-glow-secondary">AI</span>
          </div>
        </div>

        {/* Player controls - Center */}
        <div className="flex flex-col items-center gap-1 flex-1 max-w-xl px-4">
          {/* Control buttons */}
          <div className="flex items-center gap-2 md:gap-4">
            {/* Previous */}
            <button 
              onClick={prevTrack}
              className="p-2 rounded-full text-muted-foreground hover:text-foreground transition-colors active:scale-95"
            >
              <SkipBack className="w-4 h-4 md:w-5 md:h-5" fill="currentColor" />
            </button>

            {/* Play/Pause */}
            <button 
              onClick={togglePlay}
              className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-foreground hover:bg-foreground/90 hover:scale-105 active:scale-90 flex items-center justify-center transition-all duration-150 shadow-lg group"
            >
              {isLoading ? (
                <Loader2 className="w-5 h-5 md:w-6 md:h-6 text-background animate-spin" />
              ) : isPlaying ? (
                <Pause className="w-5 h-5 md:w-6 md:h-6 text-background transition-transform duration-150 group-active:scale-90" fill="currentColor" />
              ) : (
                <Play className="w-5 h-5 md:w-6 md:h-6 text-background ml-0.5 transition-transform duration-150 group-active:scale-90" fill="currentColor" />
              )}
            </button>

            {/* Next */}
            <button 
              onClick={nextTrack}
              disabled={queueIndex >= queue.length - 1}
              className="p-2 rounded-full text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors active:scale-95"
            >
              <SkipForward className="w-4 h-4 md:w-5 md:h-5" fill="currentColor" />
            </button>
          </div>

          {/* Progress bar - Desktop only */}
          <div className="hidden md:flex items-center gap-2 w-full">
            <span className="text-[10px] text-muted-foreground w-10 text-right font-mono">
              {formatTime(currentTime)}
            </span>
            <div className="flex-1 group">
              <Slider
                value={[progress]}
                onValueChange={(value) => seekTo(value[0])}
                max={100}
                step={0.1}
                className="cursor-pointer"
              />
            </div>
            <span className="text-[10px] text-muted-foreground w-10 font-mono">
              {formatTime(duration)}
            </span>
          </div>
        </div>

        {/* Volume & extras - Right */}
        <div className="flex items-center justify-end gap-2 md:gap-4 w-1/4">
          {/* Queue button */}
          <button className="hidden md:flex p-2 rounded-full text-muted-foreground hover:text-foreground transition-colors relative">
            <ListMusic className="w-4 h-4" />
            {queue.length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-glow-primary text-[9px] font-bold text-white flex items-center justify-center">
                {queue.length}
              </span>
            )}
          </button>

          {/* Volume control - Desktop */}
          <div className="hidden md:flex items-center gap-2 w-32">
            <button 
              onClick={() => setVolume(volume > 0 ? 0 : 80)}
              className="p-2 rounded-full text-muted-foreground hover:text-foreground transition-colors"
            >
              <VolumeIcon className="w-4 h-4" />
            </button>
            <Slider
              value={[volume]}
              onValueChange={(value) => setVolume(value[0])}
              max={100}
              step={1}
              className="w-20 cursor-pointer"
            />
          </div>

          {/* Expand button */}
          <button className="hidden lg:flex p-2 rounded-full text-muted-foreground hover:text-foreground transition-colors">
            <Maximize2 className="w-4 h-4" />
          </button>

          {/* Mobile: show model badge */}
          <div className={`md:hidden w-2 h-2 rounded-full bg-gradient-to-r ${MODEL_COLORS[currentTrack.modelProvider] || "from-gray-500 to-gray-700"}`} />
        </div>
      </div>
    </div>
  )
}
