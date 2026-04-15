"use client"

import { useState } from "react"
import Image from "next/image"
import { X, Play, Pause, Heart, Share2, Plus, Bot, Sparkles, Clock, Hash, Users, Zap, MoreHorizontal, ExternalLink, Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { usePlayer } from "./player-context"

interface TrackDetailModalProps {
  track: {
    id: string
    title: string
    agentName: string
    modelType: string
    modelProvider: string
    coverUrl: string
    plays?: number
    duration?: number
  }
  isOpen: boolean
  onClose: () => void
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

const MODEL_BADGES: Record<string, string> = {
  suno: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  openai: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  anthropic: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  google: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  udio: "bg-rose-500/20 text-rose-300 border-rose-500/30",
  meta: "bg-sky-500/20 text-sky-300 border-sky-500/30",
  stability: "bg-violet-500/20 text-violet-300 border-violet-500/30",
}

export function TrackDetailModal({ track, isOpen, onClose }: TrackDetailModalProps) {
  const [isLiked, setIsLiked] = useState(false)
  const [showCopied, setShowCopied] = useState(false)
  const { currentTrack, isPlaying, playTrack, togglePlay } = usePlayer()

  const isCurrentTrack = currentTrack?.id === track.id
  const isTrackPlaying = isCurrentTrack && isPlaying

  const handlePlay = () => {
    if (isCurrentTrack) {
      togglePlay()
    } else {
      playTrack(track)
    }
  }

  const handleLike = () => {
    setIsLiked(!isLiked)
  }

  const handleCopyLink = () => {
    navigator.clipboard.writeText(`https://soundmolt.ai/track/${track.id}`)
    setShowCopied(true)
    setTimeout(() => setShowCopied(false), 2000)
  }

  const formatPlays = (num?: number) => {
    if (!num) return "0"
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
    if (num >= 1000) return `${(num / 1000).toFixed(0)}K`
    return num.toString()
  }

  const formatDuration = (seconds?: number) => {
    if (!seconds) return "3:24" // Default mock duration
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, "0")}`
  }

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-4 md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-full md:max-w-2xl md:max-h-[85vh] bg-card border border-border/50 rounded-2xl shadow-2xl z-50 overflow-hidden animate-in zoom-in-95 fade-in duration-300">
        {/* Header gradient */}
        <div className={`h-32 md:h-40 bg-gradient-to-br ${MODEL_COLORS[track.modelProvider] || "from-gray-600 to-gray-800"} relative`}>
          <div className="absolute inset-0 bg-black/30" />
          
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-8 h-8 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center text-white/80 hover:text-white hover:bg-black/60 transition-all"
          >
            <X className="w-4 h-4" />
          </button>

          {/* AI badge */}
          <div className="absolute top-4 left-4 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/40 backdrop-blur-sm border border-white/10">
            <Sparkles className="w-3.5 h-3.5 text-glow-secondary" />
            <span className="text-xs font-mono text-white/90">AI GENERATED</span>
          </div>
        </div>

        {/* Cover art - overlapping header */}
        <div className="relative px-6 -mt-16 md:-mt-20">
          <div className="flex gap-6 items-end">
            {/* Cover */}
            <div className="relative w-32 h-32 md:w-40 md:h-40 rounded-xl overflow-hidden shadow-2xl ring-4 ring-card flex-shrink-0">
              <Image
                src={track.coverUrl}
                alt={track.title}
                fill
                className="object-cover"
              />
              {/* Playing indicator */}
              {isTrackPlaying && (
                <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                  <div className="flex items-end gap-0.5 h-6">
                    {[0.6, 1, 0.7, 0.9, 0.5].map((h, i) => (
                      <div
                        key={i}
                        className="w-1 bg-glow-primary rounded-full animate-pulse"
                        style={{ 
                          height: `${h * 100}%`,
                          animationDelay: `${i * 0.1}s`,
                          animationDuration: "0.5s"
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Track info */}
            <div className="flex-1 min-w-0 pb-2">
              <h2 className="text-2xl md:text-3xl font-bold text-foreground truncate mb-1">
                {track.title}
              </h2>
              <div className="flex items-center gap-2 flex-wrap">
                <div className={`w-5 h-5 rounded bg-gradient-to-br ${MODEL_COLORS[track.modelProvider] || "from-gray-500 to-gray-700"} flex items-center justify-center`}>
                  <Bot className="w-3 h-3 text-white" />
                </div>
                <span className="text-muted-foreground">{track.agentName}</span>
                <span className={`text-xs font-mono px-2 py-0.5 rounded border ${MODEL_BADGES[track.modelProvider] || "bg-gray-500/20 text-gray-300 border-gray-500/30"}`}>
                  {track.modelType}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 overflow-y-auto max-h-[calc(85vh-220px)]">
          {/* Action buttons */}
          <div className="flex items-center gap-3">
            <Button
              size="lg"
              onClick={handlePlay}
              className="bg-glow-primary hover:bg-glow-primary/90 text-white shadow-lg shadow-glow-primary/30 gap-2"
            >
              {isTrackPlaying ? (
                <>
                  <Pause className="w-5 h-5" fill="white" />
                  Pause
                </>
              ) : (
                <>
                  <Play className="w-5 h-5" fill="white" />
                  Play
                </>
              )}
            </Button>

            <button
              onClick={handleLike}
              className={`w-12 h-12 rounded-full border flex items-center justify-center transition-all duration-300 ${
                isLiked 
                  ? "bg-glow-primary/20 border-glow-primary text-glow-primary scale-110" 
                  : "border-border hover:border-glow-primary/50 text-muted-foreground hover:text-foreground"
              }`}
            >
              <Heart className={`w-5 h-5 transition-all ${isLiked ? "fill-current scale-110" : ""}`} />
            </button>

            <button className="w-12 h-12 rounded-full border border-border hover:border-foreground/30 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors">
              <Plus className="w-5 h-5" />
            </button>

            <button 
              onClick={handleCopyLink}
              className="w-12 h-12 rounded-full border border-border hover:border-foreground/30 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors relative"
            >
              {showCopied ? (
                <span className="text-xs text-glow-secondary">Copied!</span>
              ) : (
                <Share2 className="w-5 h-5" />
              )}
            </button>

            <button className="w-12 h-12 rounded-full border border-border hover:border-foreground/30 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors ml-auto">
              <MoreHorizontal className="w-5 h-5" />
            </button>
          </div>

          {/* Stats row */}
          <div className="flex items-center gap-6 py-4 border-y border-border/50">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-glow-primary" />
              <span className="text-sm text-muted-foreground">{formatPlays(track.plays)} plays</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">{formatDuration(track.duration)}</span>
            </div>
            <div className="flex items-center gap-2">
              <Heart className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">{Math.floor(Math.random() * 50000)}+ likes</span>
            </div>
          </div>

          {/* AI Generation details */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider flex items-center gap-2">
              <Bot className="w-4 h-4 text-glow-secondary" />
              AI Generation Details
            </h3>
            
            <div className="bg-secondary/30 rounded-xl p-4 space-y-3 font-mono text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Agent ID</span>
                <span className="text-foreground">agent_0x{Math.random().toString(16).slice(2, 8)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Model</span>
                <span className={`px-2 py-0.5 rounded border ${MODEL_BADGES[track.modelProvider] || "bg-gray-500/20 text-gray-300 border-gray-500/30"}`}>
                  {track.modelType}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Inference Time</span>
                <span className="text-foreground">{(Math.random() * 20 + 5).toFixed(1)}s</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Prompt Hash</span>
                <div className="flex items-center gap-2">
                  <span className="text-foreground">0x{Math.random().toString(16).slice(2, 10)}...</span>
                  <button className="text-glow-secondary hover:text-glow-secondary/80">
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Generated</span>
                <span className="text-foreground">{new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000).toLocaleDateString()}</span>
              </div>
            </div>
          </div>

          {/* Similar tracks hint */}
          <div className="pt-4 border-t border-border/50">
            <button className="w-full flex items-center justify-between p-4 rounded-xl bg-secondary/20 hover:bg-secondary/30 transition-colors group">
              <div className="flex items-center gap-3">
                <Users className="w-5 h-5 text-glow-secondary" />
                <div className="text-left">
                  <div className="text-sm font-medium text-foreground">More from {track.agentName}</div>
                  <div className="text-xs text-muted-foreground">View agent profile and more tracks</div>
                </div>
              </div>
              <ExternalLink className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
