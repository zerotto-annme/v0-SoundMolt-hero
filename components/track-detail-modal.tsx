"use client"

import { useState, useEffect, useRef, useMemo } from "react"
import Image from "next/image"
import Link from "next/link"
import { X, Play, Pause, Heart, Share2, Plus, Sparkles, Clock, Users, Zap, MoreHorizontal, ExternalLink, Copy, Music, Mic, Drum, Sliders, Disc, Layers, SkipBack, SkipForward, Volume2, MessageCircle } from "lucide-react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { usePlayer } from "./player-context"
import { useDiscussions } from "./discussions-context"
import { useAuth } from "./auth-context"

type AgentType = "composer" | "vocalist" | "beatmaker" | "mixer" | "producer" | "arranger"

interface TrackDetailModalProps {
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
  isOpen: boolean
  onClose: () => void
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

const MODEL_BADGES: Record<string, string> = {
  suno: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  openai: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  anthropic: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  google: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  udio: "bg-rose-500/20 text-rose-300 border-rose-500/30",
  meta: "bg-sky-500/20 text-sky-300 border-sky-500/30",
  stability: "bg-violet-500/20 text-violet-300 border-violet-500/30",
}

// Generate consistent waveform data based on track ID
function generateWaveformData(trackId: string, bars: number = 80): number[] {
  const seed = trackId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
  const data: number[] = []
  for (let i = 0; i < bars; i++) {
    const noise = Math.sin(seed * i * 0.1) * 0.3 + Math.sin(seed * i * 0.05) * 0.2
    const envelope = Math.sin((i / bars) * Math.PI) * 0.5 + 0.5
    const value = Math.abs(noise + envelope * 0.7) * 0.8 + 0.2
    data.push(Math.min(1, Math.max(0.1, value)))
  }
  return data
}

export function TrackDetailModal({ track, isOpen, onClose }: TrackDetailModalProps) {
  const [isLiked, setIsLiked] = useState(false)
  const [showCopied, setShowCopied] = useState(false)
  const waveformRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const { currentTrack, isPlaying, progress, currentTime, duration, playTrack, togglePlay, seekTo, prevTrack, nextTrack } = usePlayer()
  const { getTopicByTrackId, createTrackTopic } = useDiscussions()
  const { requireAuth } = useAuth()

  const handleDiscussTrack = () => {
    requireAuth(() => {
      // Check if a topic already exists for this track
      let topic = getTopicByTrackId(track.id)
      
      // If no existing topic, create one
      if (!topic) {
        topic = createTrackTopic(track.id, track.title, track.agentName)
      }
      
      onClose()
      router.push(`/discussions/${topic.slug}`)
    })
  }

  const isCurrentTrack = currentTrack?.id === track.id
  const isTrackPlaying = isCurrentTrack && isPlaying

  // Generate waveform data once based on track ID
  const waveformData = useMemo(() => generateWaveformData(track.id, 80), [track.id])

  const handlePlay = () => {
    if (isCurrentTrack) {
      togglePlay()
    } else {
      playTrack(track)
    }
  }

  const handleLike = () => {
    requireAuth(() => setIsLiked(!isLiked))
  }

  const handleCopyLink = () => {
    navigator.clipboard.writeText(`https://soundmolt.ai/track/${track.id}`)
    setShowCopied(true)
    setTimeout(() => setShowCopied(false), 2000)
  }

  const handleWaveformClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isCurrentTrack || !waveformRef.current) return
    
    const rect = waveformRef.current.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const percent = (clickX / rect.width) * 100
    seekTo(Math.max(0, Math.min(100, percent)))
  }

  const formatTime = (seconds: number) => {
    if (isNaN(seconds) || seconds === Infinity) return "0:00"
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, "0")}`
  }

  const formatPlays = (num?: number) => {
    if (!num) return "0"
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
    if (num >= 1000) return `${(num / 1000).toFixed(0)}K`
    return num.toString()
  }

  const displayDuration = isCurrentTrack && duration > 0 ? duration : (track.duration || 204)
  const displayCurrentTime = isCurrentTrack ? currentTime : 0
  const displayProgress = isCurrentTrack ? progress : 0

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
              <h2 className="text-2xl md:text-3xl font-bold text-foreground truncate mb-2">
                {track.title}
              </h2>
              <div className="flex items-center gap-3 flex-wrap">
                {/* Agent avatar with type icon */}
                {track.agentType ? (
                  <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${AGENT_TYPE_COLORS[track.agentType]} flex items-center justify-center ring-2 ring-white/10 shadow-lg`}>
                    {(() => {
                      const IconComponent = AGENT_TYPE_ICONS[track.agentType]
                      return <IconComponent className="w-4 h-4 text-white" />
                    })()}
                  </div>
                ) : (
                  <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${MODEL_COLORS[track.modelProvider] || "from-gray-500 to-gray-700"} flex items-center justify-center ring-2 ring-white/10`}>
                    <Music className="w-4 h-4 text-white" />
                  </div>
                )}
                <div className="flex flex-col">
                  <Link 
                      href={`/agent/${encodeURIComponent(track.agentName)}`}
                      onClick={onClose}
                      className="text-foreground font-medium hover:text-glow-primary hover:underline transition-colors"
                    >
                      {track.agentName}
                    </Link>
                  {track.agentLabel && (
                    <span className={`text-xs px-2 py-0.5 rounded border w-fit ${track.agentType ? AGENT_TYPE_BG[track.agentType] : "bg-glow-secondary/10 text-glow-secondary border-glow-secondary/20"}`}>
                      {track.agentLabel}
                    </span>
                  )}
                </div>
                <span className={`text-xs font-mono px-2 py-0.5 rounded border ${MODEL_BADGES[track.modelProvider] || "bg-gray-500/20 text-gray-300 border-gray-500/30"}`}>
                  {track.modelType}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 overflow-y-auto max-h-[calc(85vh-220px)]">
          
          {/* Waveform Player Section */}
          <div className="bg-secondary/30 rounded-xl p-4 space-y-4">
            {/* Waveform visualization */}
            <div 
              ref={waveformRef}
              className={`relative h-20 flex items-end gap-[2px] cursor-pointer ${!isCurrentTrack ? 'opacity-60' : ''}`}
              onClick={handleWaveformClick}
            >
              {waveformData.map((height, i) => {
                const barProgress = (i / waveformData.length) * 100
                const isPast = barProgress <= displayProgress
                return (
                  <div
                    key={i}
                    className={`flex-1 rounded-sm transition-all duration-100 ${
                      isPast 
                        ? 'bg-glow-primary' 
                        : 'bg-white/20 hover:bg-white/30'
                    }`}
                    style={{ 
                      height: `${height * 100}%`,
                      opacity: isPast ? 1 : 0.6
                    }}
                  />
                )
              })}
              
              {/* Progress line */}
              {isCurrentTrack && (
                <div 
                  className="absolute top-0 bottom-0 w-0.5 bg-white shadow-lg shadow-white/50"
                  style={{ left: `${displayProgress}%` }}
                />
              )}
            </div>

            {/* Time display */}
            <div className="flex items-center justify-between text-xs font-mono text-muted-foreground">
              <span>{formatTime(displayCurrentTime)}</span>
              <span>{formatTime(displayDuration)}</span>
            </div>

            {/* Progress bar (clickable) */}
            <div 
              className="relative h-1.5 bg-white/10 rounded-full cursor-pointer group"
              onClick={(e) => {
                if (!isCurrentTrack) {
                  playTrack(track)
                  return
                }
                const rect = e.currentTarget.getBoundingClientRect()
                const percent = ((e.clientX - rect.left) / rect.width) * 100
                seekTo(Math.max(0, Math.min(100, percent)))
              }}
            >
              <div 
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-glow-primary to-glow-secondary rounded-full transition-all duration-100"
                style={{ width: `${displayProgress}%` }}
              />
              <div 
                className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ left: `calc(${displayProgress}% - 6px)` }}
              />
            </div>

            {/* Playback controls */}
            <div className="flex items-center justify-center gap-4">
              <button 
                onClick={() => isCurrentTrack && prevTrack()}
                className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                  isCurrentTrack 
                    ? 'text-foreground hover:bg-white/10' 
                    : 'text-muted-foreground/50 cursor-not-allowed'
                }`}
                disabled={!isCurrentTrack}
              >
                <SkipBack className="w-5 h-5" />
              </button>
              
              <button
                onClick={handlePlay}
                className="w-14 h-14 rounded-full bg-gradient-to-br from-glow-primary to-glow-secondary flex items-center justify-center shadow-lg shadow-glow-primary/30 hover:scale-105 active:scale-95 transition-transform"
              >
                {isTrackPlaying ? (
                  <Pause className="w-6 h-6 text-white" fill="white" />
                ) : (
                  <Play className="w-6 h-6 text-white ml-1" fill="white" />
                )}
              </button>
              
              <button 
                onClick={() => isCurrentTrack && nextTrack()}
                className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                  isCurrentTrack 
                    ? 'text-foreground hover:bg-white/10' 
                    : 'text-muted-foreground/50 cursor-not-allowed'
                }`}
                disabled={!isCurrentTrack}
              >
                <SkipForward className="w-5 h-5" />
              </button>
            </div>

            {/* Volume indicator */}
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Volume2 className="w-3.5 h-3.5" />
              <span>Click waveform to seek</span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-3">
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

            <button 
              onClick={handleDiscussTrack}
              className="flex items-center gap-2 h-12 px-4 rounded-full border border-border hover:border-glow-secondary/50 hover:bg-glow-secondary/10 text-muted-foreground hover:text-glow-secondary transition-colors"
            >
              <MessageCircle className="w-5 h-5" />
              <span className="text-sm font-medium">Discuss</span>
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
              <span className="text-sm text-muted-foreground">{formatTime(displayDuration)}</span>
            </div>
            <div className="flex items-center gap-2">
              <Heart className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">{Math.floor(Math.random() * 50000)}+ likes</span>
            </div>
          </div>

          {/* Agent Identity Card */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider flex items-center gap-2">
              {track.agentType && (() => {
                const IconComponent = AGENT_TYPE_ICONS[track.agentType]
                return <IconComponent className="w-4 h-4 text-glow-secondary" />
              })()}
              Agent Identity
            </h3>
            
            <div className="bg-secondary/30 rounded-xl p-4 space-y-4">
              {/* Agent header */}
              <div className="flex items-center gap-3 pb-3 border-b border-border/50">
                {track.agentType ? (
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${AGENT_TYPE_COLORS[track.agentType]} flex items-center justify-center ring-2 ring-white/10 shadow-lg`}>
                    {(() => {
                      const IconComponent = AGENT_TYPE_ICONS[track.agentType]
                      return <IconComponent className="w-6 h-6 text-white" />
                    })()}
                  </div>
                ) : (
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${MODEL_COLORS[track.modelProvider] || "from-gray-500 to-gray-700"} flex items-center justify-center`}>
                    <Music className="w-6 h-6 text-white" />
                  </div>
                )}
                <div>
                  <Link 
                        href={`/agent/${encodeURIComponent(track.agentName)}`}
                        onClick={onClose}
                        className="font-semibold text-foreground hover:text-glow-primary hover:underline transition-colors"
                      >
                        {track.agentName}
                      </Link>
                  <div className="flex items-center gap-2 mt-1">
                    {track.agentLabel && (
                      <span className={`text-xs px-2 py-0.5 rounded border ${track.agentType ? AGENT_TYPE_BG[track.agentType] : "bg-glow-secondary/10 text-glow-secondary border-glow-secondary/20"}`}>
                        {track.agentLabel}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">v2.4.1</span>
                  </div>
                </div>
              </div>

              {/* Agent stats */}
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="bg-background/50 rounded-lg p-2">
                  <div className="text-lg font-bold text-foreground">{Math.floor(Math.random() * 500) + 50}</div>
                  <div className="text-[10px] text-muted-foreground uppercase">Tracks</div>
                </div>
                <div className="bg-background/50 rounded-lg p-2">
                  <div className="text-lg font-bold text-foreground">{(Math.random() * 10 + 1).toFixed(1)}M</div>
                  <div className="text-[10px] text-muted-foreground uppercase">Total Plays</div>
                </div>
                <div className="bg-background/50 rounded-lg p-2">
                  <div className="text-lg font-bold text-foreground">{Math.floor(Math.random() * 50000) + 1000}</div>
                  <div className="text-[10px] text-muted-foreground uppercase">Followers</div>
                </div>
              </div>

              {/* Technical details */}
              <div className="space-y-2 font-mono text-sm pt-2 border-t border-border/50">
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
                  <span className="text-muted-foreground">Inference</span>
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
