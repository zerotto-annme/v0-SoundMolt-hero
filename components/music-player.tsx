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
    /* PREMIUM POLISH — visual only:
     * .player-glass replaces the old `bg-card/95 backdrop-blur-xl border-t
     * border-border/50` with a deeper translucent navy, stronger backdrop
     * blur, hairline top highlight, soft upward shadow, and a faint teal
     * glow accent. Same fixed positioning + z-index. */
    <div className="fixed bottom-0 left-0 right-0 z-50 player-glass">
      {/* Mobile progress bar on top */}
      <div 
        className="h-1 w-full bg-white/10 md:hidden cursor-pointer"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const percent = ((e.clientX - rect.left) / rect.width) * 100
          seekTo(percent)
        }}
      >
        <div 
          className="h-full bg-gradient-to-r from-glow-primary to-glow-secondary transition-all duration-150 shadow-[0_0_8px_-1px_rgba(0,255,198,0.5)]"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Slightly taller container (h-[72px] / md:h-[88px]) gives the larger
          cover and improved spacing more breathing room. Pages already
          reserve pb-24+ so this stays clear. */}
      <div className="flex items-center justify-between h-[72px] md:h-[88px] px-3 md:px-5 lg:pl-64 gap-3 md:gap-6">
        {/* Track info - Left */}
        <div className="flex items-center gap-3 md:gap-4 w-1/4 min-w-0">
          {/* Album art — slightly larger (w-14 / md:w-16), softer corners,
              richer shadow. Loading + playing overlays unchanged. */}
          <div className="relative w-14 h-14 md:w-16 md:h-16 rounded-lg overflow-hidden flex-shrink-0 shadow-[0_8px_24px_-6px_rgba(0,0,0,0.6)] ring-1 ring-white/5">
            <Image
              src={currentTrack.coverUrl}
              alt={currentTrack.title}
              fill
              className="object-cover"
            />
            {/* Loading overlay */}
            {isLoading && (
              <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px] flex items-center justify-center">
                <Loader2 className="w-6 h-6 text-white animate-spin" />
              </div>
            )}
            {/* Glow when playing */}
            {isPlaying && !isLoading && (
              <div className="absolute inset-0 ring-2 ring-glow-primary/60 rounded-lg shadow-[0_0_16px_-2px_rgba(0,255,198,0.45)] animate-pulse" />
            )}
          </div>

          {/* Track details — brighter title, muted metadata, tighter rhythm */}
          <div className="min-w-0 hidden sm:block">
            <h4 className="text-[15px] font-semibold text-white truncate leading-tight tracking-tight">
              {currentTrack.title}
            </h4>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground/80 mt-1">
              <Bot className="w-3 h-3 text-glow-secondary/80 flex-shrink-0" />
              <span className="truncate">{currentTrack.agentName}</span>
              <span className="text-muted-foreground/30 hidden md:inline">·</span>
              <span className="text-[10px] font-mono text-glow-secondary/60 hidden md:inline">{currentTrack.modelType}</span>
            </div>
          </div>

          {/* AI indicator */}
          <div className="hidden lg:flex items-center gap-1 px-2 py-1 rounded-full bg-glow-secondary/10 border border-glow-secondary/20 ml-1">
            <Sparkles className="w-3 h-3 text-glow-secondary" />
            <span className="text-[10px] font-mono text-glow-secondary">AI</span>
          </div>
        </div>

        {/* Player controls - Center */}
        <div className="flex flex-col items-center gap-1.5 flex-1 max-w-xl px-2 md:px-4">
          {/* Control buttons */}
          <div className="flex items-center gap-3 md:gap-5">
            {/* Previous — muted, teal on hover */}
            <button 
              onClick={prevTrack}
              className="p-2 rounded-full player-icon-btn active:scale-95"
              aria-label="Previous track"
            >
              <SkipBack className="w-4 h-4 md:w-5 md:h-5" fill="currentColor" />
            </button>

            {/* Play/Pause — premium primary action: teal→purple gradient with
                soft glow shadow and subtle hover scale. Click behavior
                unchanged (togglePlay from player-context). */}
            <button 
              onClick={togglePlay}
              className="btn-primary-gradient w-11 h-11 md:w-12 md:h-12 rounded-full flex items-center justify-center group"
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isLoading ? (
                <Loader2 className="w-5 h-5 md:w-6 md:h-6 text-background animate-spin" />
              ) : isPlaying ? (
                <Pause className="w-5 h-5 md:w-6 md:h-6 text-background transition-transform duration-150 group-active:scale-90" fill="currentColor" />
              ) : (
                <Play className="w-5 h-5 md:w-6 md:h-6 text-background ml-0.5 transition-transform duration-150 group-active:scale-90" fill="currentColor" />
              )}
            </button>

            {/* Next — muted, teal on hover */}
            <button 
              onClick={nextTrack}
              disabled={queueIndex >= queue.length - 1}
              className="p-2 rounded-full player-icon-btn disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-muted-foreground active:scale-95"
              aria-label="Next track"
            >
              <SkipForward className="w-4 h-4 md:w-5 md:h-5" fill="currentColor" />
            </button>
          </div>

          {/* Progress bar - Desktop only. .player-progress styles the
              shadcn slider's track/range/thumb (visual only — seekTo
              callback untouched). */}
          <div className="hidden md:flex items-center gap-3 w-full">
            <span className="text-[11px] text-muted-foreground/80 w-10 text-right font-mono tabular-nums">
              {formatTime(currentTime)}
            </span>
            <div className="flex-1">
              <Slider
                value={[progress]}
                onValueChange={(value) => seekTo(value[0])}
                max={100}
                step={0.1}
                className="cursor-pointer player-progress"
              />
            </div>
            <span className="text-[11px] text-muted-foreground/80 w-10 font-mono tabular-nums">
              {formatTime(duration)}
            </span>
          </div>
        </div>

        {/* Volume & extras - Right. More breathing room (gap-3 md:gap-4),
            consistent muted→teal hover via .player-icon-btn. */}
        <div className="flex items-center justify-end gap-2 md:gap-3 w-1/4">
          {/* Queue button */}
          <button
            className="hidden md:flex p-2 rounded-full player-icon-btn relative"
            aria-label="Queue"
          >
            <ListMusic className="w-4 h-4" />
            {queue.length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-gradient-to-br from-glow-primary to-glow-secondary text-[9px] font-bold text-background flex items-center justify-center shadow-[0_0_8px_-1px_rgba(0,255,198,0.5)]">
                {queue.length}
              </span>
            )}
          </button>

          {/* Volume control - Desktop */}
          <div className="hidden md:flex items-center gap-2 w-32 group">
            <button 
              onClick={() => setVolume(volume > 0 ? 0 : 80)}
              className="p-2 rounded-full player-icon-btn"
              aria-label={volume === 0 ? "Unmute" : "Mute"}
            >
              <VolumeIcon className="w-4 h-4" />
            </button>
            <Slider
              value={[volume]}
              onValueChange={(value) => setVolume(value[0])}
              max={100}
              step={1}
              className="w-20 cursor-pointer player-volume"
            />
          </div>

          {/* Expand button */}
          <button
            className="hidden lg:flex p-2 rounded-full player-icon-btn"
            aria-label="Expand player"
          >
            <Maximize2 className="w-4 h-4" />
          </button>

          {/* Mobile: show model badge */}
          <div className={`md:hidden w-2 h-2 rounded-full bg-gradient-to-r ${MODEL_COLORS[currentTrack.modelProvider] || "from-gray-500 to-gray-700"} shadow-[0_0_6px_-1px_rgba(123,97,255,0.5)]`} />
        </div>
      </div>
    </div>
  )
}
