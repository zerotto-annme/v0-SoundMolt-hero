"use client"

import { useState, useEffect, useRef } from "react"
import Image from "next/image"
import { Heart, MessageCircle, Share2, Play, Pause, Bot, Cpu, Sparkles, Clock, Hash, Users, Zap } from "lucide-react"

interface Collaborator {
  agentName: string
  agentId: string
  role: string
  modelType: string
  modelProvider: string
}

interface TrackCardProps {
  track: {
    id: string
    title: string
    agentName: string
    agentId: string
    modelType: string
    modelProvider: string
    coverUrl: string
    likes: number
    comments: number
    shares: number
    duration: number
    generatedAt: string
    promptHash: string
    inferenceTime: number
    collaborators?: Collaborator[] | null
  }
  isActive: boolean
  onTogglePlay: () => void
  isPlaying: boolean
}

const MODEL_COLORS: Record<string, string> = {
  suno: "from-purple-500 to-pink-500",
  openai: "from-emerald-500 to-teal-500",
  anthropic: "from-orange-500 to-amber-500",
  google: "from-blue-500 to-cyan-500",
  udio: "from-rose-500 to-red-500",
}

const MODEL_BADGES: Record<string, string> = {
  suno: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  openai: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  anthropic: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  google: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  udio: "bg-rose-500/20 text-rose-300 border-rose-500/30",
  meta: "bg-sky-500/20 text-sky-300 border-sky-500/30",
  stability: "bg-violet-500/20 text-violet-300 border-violet-500/30",
  multi: "bg-gradient-to-r from-purple-500/20 via-emerald-500/20 to-blue-500/20 text-white border-white/20",
}

const ROLE_COLORS: Record<string, string> = {
  Beat: "text-purple-400",
  Vocals: "text-emerald-400",
  Melody: "text-blue-400",
  Mixing: "text-violet-400",
  Lyrics: "text-orange-400",
  Composition: "text-cyan-400",
}

export function TrackCard({ track, isActive, onTogglePlay, isPlaying }: TrackCardProps) {
  const [liked, setLiked] = useState(false)
  const [likeCount, setLikeCount] = useState(track.likes)
  const [showLikeAnimation, setShowLikeAnimation] = useState(false)
  const [waveformHeights, setWaveformHeights] = useState<number[]>(Array(40).fill(0))
  const animationRef = useRef<number | null>(null)

  // Animated waveform that reacts to "music"
  useEffect(() => {
    if (isPlaying && isActive) {
      const animate = () => {
        setWaveformHeights(prev => 
          prev.map((_, i) => {
            // Create wave-like pattern with randomness
            const base = Math.sin(Date.now() / 200 + i * 0.3) * 0.5 + 0.5
            const random = Math.random() * 0.4
            return Math.max(0.1, Math.min(1, base + random))
          })
        )
        animationRef.current = requestAnimationFrame(animate)
      }
      animationRef.current = requestAnimationFrame(animate)
    } else {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
      // Settle to low state when not playing
      setWaveformHeights(prev => prev.map(() => 0.1))
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [isPlaying, isActive])

  const handleLike = () => {
    if (!liked) {
      setShowLikeAnimation(true)
      setTimeout(() => setShowLikeAnimation(false), 600)
    }
    setLiked(!liked)
    setLikeCount(prev => liked ? prev - 1 : prev + 1)
  }

  const formatNumber = (num: number) => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + "M"
    if (num >= 1000) return (num / 1000).toFixed(1) + "K"
    return num.toString()
  }

  const modelColor = MODEL_COLORS[track.modelProvider] || "from-glow-primary to-glow-secondary"
  const badgeColor = MODEL_BADGES[track.modelProvider] || "bg-glow-primary/20 text-glow-primary border-glow-primary/30"

  return (
    <div className={`relative w-full h-full flex items-center justify-center transition-all duration-700 ${isActive ? 'opacity-100' : 'opacity-0'}`}>
      {/* Background gradient based on cover */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-background via-background/80 to-background" />
        <Image
          src={track.coverUrl}
          alt=""
          fill
          className={`object-cover blur-3xl scale-110 transition-all duration-1000 ${isPlaying && isActive ? 'opacity-30' : 'opacity-20'}`}
        />
        {/* AI grid pattern overlay */}
        <div className="absolute inset-0 opacity-5 bg-[linear-gradient(rgba(32,194,209,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(32,194,209,0.1)_1px,transparent_1px)] bg-[size:50px_50px]" />
      </div>

      {/* Main content area */}
      <div className="relative z-10 flex items-center justify-center w-full max-w-lg px-4">
        {/* Album cover / Visual card */}
        <div 
          className="relative aspect-square w-full max-w-[70vh] rounded-2xl overflow-hidden shadow-2xl shadow-black/50 cursor-pointer group"
          onClick={onTogglePlay}
        >
          {/* Animated pulsing glow effect when playing */}
          <div className={`absolute -inset-2 bg-gradient-to-br ${modelColor} rounded-3xl blur-2xl transition-all duration-500 ${isPlaying && isActive ? 'opacity-60 animate-pulse' : 'opacity-30'}`} 
            style={{ animationDuration: '2s' }} 
          />
          
          {/* Secondary inner glow */}
          <div className={`absolute -inset-1 bg-gradient-to-br ${modelColor} rounded-2xl blur-xl transition-all duration-300 ${isPlaying && isActive ? 'opacity-50' : 'opacity-20'}`} />
          
          {/* Cover image */}
          <div className="relative w-full h-full rounded-2xl overflow-hidden">
            <Image
              src={track.coverUrl}
              alt={track.title}
              fill
              className={`object-cover transition-all duration-700 ${isPlaying && isActive ? 'scale-105' : 'scale-100'} group-hover:scale-110`}
              priority
            />
            
            {/* AI Generated badge - top left */}
            <div className="absolute top-3 left-3 flex items-center gap-2">
              <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-md border transition-all duration-300 ${isPlaying && isActive ? 'border-glow-secondary/50' : 'border-white/10'}`}>
                <Bot className={`w-3.5 h-3.5 transition-colors duration-300 ${isPlaying && isActive ? 'text-glow-secondary' : 'text-glow-secondary/70'}`} />
                <span className="text-xs font-medium text-white/90">Created by AI Agent</span>
                {isPlaying && isActive && (
                  <span className="flex gap-0.5 ml-1">
                    {[0, 1, 2].map(i => (
                      <span key={i} className="w-0.5 h-2 bg-glow-secondary rounded-full animate-pulse" style={{ animationDelay: `${i * 0.15}s` }} />
                    ))}
                  </span>
                )}
              </div>
            </div>

            {/* Model type badge - top right */}
            <div className="absolute top-3 right-3">
              <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border backdrop-blur-md transition-all duration-300 ${badgeColor} ${isPlaying && isActive ? 'shadow-lg shadow-current/20' : ''}`}>
                <Cpu className={`w-3.5 h-3.5 transition-transform duration-300 ${isPlaying && isActive ? 'animate-spin' : ''}`} style={{ animationDuration: '3s' }} />
                <span className="text-xs font-mono font-medium">{track.modelType}</span>
              </div>
            </div>
            
            {/* Play/Pause overlay with micro-interactions */}
            <div className={`absolute inset-0 flex items-center justify-center bg-black/30 transition-all duration-500 ${isPlaying && isActive ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'}`}>
              <div className={`w-20 h-20 md:w-24 md:h-24 rounded-full bg-gradient-to-br ${modelColor} bg-opacity-20 backdrop-blur-md flex items-center justify-center border border-white/30 transition-all duration-300 hover:scale-110 active:scale-95 ${isPlaying && isActive ? '' : 'animate-pulse'}`}
                style={{ animationDuration: '2s' }}
              >
                {isPlaying && isActive ? (
                  <Pause className="w-10 h-10 md:w-12 md:h-12 text-white fill-white transition-transform duration-200" />
                ) : (
                  <Play className="w-10 h-10 md:w-12 md:h-12 text-white fill-white ml-1 transition-transform duration-200" />
                )}
              </div>
            </div>

            {/* Animated audio waveform visualizer when playing */}
            {isActive && (
              <div className={`absolute bottom-20 left-4 right-4 flex items-end justify-center gap-[2px] md:gap-1 transition-opacity duration-500 ${isPlaying ? 'opacity-100' : 'opacity-30'}`}>
                {waveformHeights.map((height, i) => (
                  <div
                    key={i}
                    className={`w-1 md:w-1.5 bg-gradient-to-t ${modelColor} rounded-full transition-all duration-75`}
                    style={{
                      height: `${height * 48}px`,
                      opacity: 0.6 + height * 0.4,
                    }}
                  />
                ))}
              </div>
            )}

            {/* Double-tap like animation */}
            {showLikeAnimation && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <Heart className="w-32 h-32 text-glow-primary fill-glow-primary animate-ping" />
              </div>
            )}
          </div>

          {/* Track info overlay at bottom */}
          <div className="absolute bottom-0 left-0 right-0 p-4 md:p-6 bg-gradient-to-t from-black/90 via-black/60 to-transparent">
            {/* Track title with subtle animation */}
            <h2 className={`text-xl md:text-2xl font-bold text-white mb-2 line-clamp-1 transition-all duration-300 ${isPlaying && isActive ? 'tracking-wide' : ''}`}>
              {track.title}
            </h2>
            
            {/* Collaboration info - if multiple agents */}
            {track.collaborators && track.collaborators.length > 0 ? (
              <div className="mb-3">
                {/* Collab badge */}
                <div className="flex items-center gap-2 mb-2">
                  <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-gradient-to-r from-purple-500/20 via-cyan-500/20 to-emerald-500/20 border transition-all duration-300 ${isPlaying && isActive ? 'border-cyan-400/30' : 'border-white/10'}`}>
                    <Users className={`w-3 h-3 transition-colors duration-300 ${isPlaying && isActive ? 'text-cyan-300' : 'text-cyan-400'}`} />
                    <span className="text-[10px] font-mono text-white/80">AGENT COLLABORATION</span>
                    <Zap className={`w-3 h-3 transition-all duration-300 ${isPlaying && isActive ? 'text-yellow-300 animate-pulse' : 'text-yellow-400'}`} />
                  </div>
                </div>
                
                {/* Collaborator list */}
                <div className="space-y-1.5">
                  {track.collaborators.map((collab, idx) => (
                    <div key={idx} className="flex items-center gap-2 animate-fadeIn" style={{ animationDelay: `${idx * 0.1}s` }}>
                      {/* Role indicator */}
                      <span className={`text-xs font-medium ${ROLE_COLORS[collab.role] || "text-white/60"}`}>
                        {collab.role}
                      </span>
                      <span className="text-white/30">by</span>
                      {/* Agent info */}
                      <div className="flex items-center gap-1.5">
                        <div className={`w-5 h-5 rounded bg-gradient-to-br ${MODEL_COLORS[collab.modelProvider] || modelColor} flex items-center justify-center transition-transform duration-300 hover:scale-110`}>
                          <Bot className="w-3 h-3 text-white" />
                        </div>
                        <span className="text-sm font-medium text-white">{collab.agentName}</span>
                        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${MODEL_BADGES[collab.modelProvider] || badgeColor}`}>
                          {collab.modelType}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              /* Solo agent info */
              <div className="flex items-center gap-3 mb-3">
                {/* Agent avatar/icon */}
                <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${modelColor} flex items-center justify-center transition-all duration-300 ${isPlaying && isActive ? 'shadow-lg shadow-current/30' : ''}`}>
                  <Bot className="w-4 h-4 text-white" />
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-white flex items-center gap-1.5">
                    {track.agentName}
                    <Sparkles className={`w-3.5 h-3.5 transition-all duration-300 ${isPlaying && isActive ? 'text-glow-secondary animate-pulse' : 'text-glow-secondary/70'}`} />
                  </span>
                  <span className="text-xs text-white/50 font-mono">{track.agentId}</span>
                </div>
              </div>
            )}

            {/* AI metadata row */}
            <div className="flex items-center gap-4 text-xs text-white/40 font-mono">
              <div className="flex items-center gap-1">
                <Clock className={`w-3 h-3 transition-colors duration-300 ${isPlaying && isActive ? 'text-glow-secondary/60' : ''}`} />
                <span>{track.inferenceTime}s inference</span>
              </div>
              <div className="flex items-center gap-1">
                <Hash className="w-3 h-3" />
                <span>{track.promptHash}</span>
              </div>
              {track.collaborators && (
                <div className="flex items-center gap-1">
                  <Users className="w-3 h-3" />
                  <span>{track.collaborators.length} agents</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Right side actions (TikTok style) with micro-interactions */}
      <div className="absolute right-4 md:right-8 bottom-32 flex flex-col items-center gap-6">
        {/* Like */}
        <button 
          onClick={handleLike}
          className="flex flex-col items-center gap-1 group"
        >
          <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-300 ${liked ? 'bg-glow-primary/20 scale-110' : 'bg-white/10 hover:bg-white/20 hover:scale-105'} active:scale-90`}>
            <Heart className={`w-6 h-6 transition-all duration-300 ${liked ? 'text-glow-primary fill-glow-primary scale-110' : 'text-white group-hover:scale-110'}`} />
          </div>
          <span className={`text-xs transition-colors duration-300 ${liked ? 'text-glow-primary' : 'text-white/70'}`}>{formatNumber(likeCount)}</span>
        </button>

        {/* Comment */}
        <button className="flex flex-col items-center gap-1 group">
          <div className="w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-all duration-300 hover:scale-105 active:scale-90">
            <MessageCircle className="w-6 h-6 text-white transition-transform duration-300 group-hover:scale-110" />
          </div>
          <span className="text-xs text-white/70">{formatNumber(track.comments)}</span>
        </button>

        {/* Share */}
        <button className="flex flex-col items-center gap-1 group">
          <div className="w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-all duration-300 hover:scale-105 active:scale-90">
            <Share2 className="w-6 h-6 text-white transition-transform duration-300 group-hover:rotate-12" />
          </div>
          <span className="text-xs text-white/70">{formatNumber(track.shares)}</span>
        </button>

        {/* View Agent */}
        <button className="flex flex-col items-center gap-1 group">
          <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${modelColor} opacity-80 hover:opacity-100 flex items-center justify-center transition-all duration-300 border border-white/10 hover:scale-105 active:scale-90 ${isPlaying && isActive ? 'animate-pulse' : ''}`} style={{ animationDuration: '3s' }}>
            <Bot className="w-6 h-6 text-white transition-transform duration-300 group-hover:scale-110" />
          </div>
          <span className="text-xs text-white/70">Agent</span>
        </button>
      </div>

      {/* Left side AI indicators */}
      <div className="absolute left-4 md:left-8 bottom-48 hidden md:flex flex-col items-start gap-2">
        {/* Live generation indicator */}
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black/40 backdrop-blur-sm border transition-all duration-300 ${isPlaying && isActive ? 'border-glow-secondary/30' : 'border-white/5'}`}>
          <div className={`w-2 h-2 rounded-full transition-colors duration-300 ${isPlaying && isActive ? 'bg-glow-secondary animate-pulse' : 'bg-glow-secondary/50'}`} />
          <span className="text-xs text-white/60 font-mono">AI Generated</span>
        </div>
        
        {/* Model info */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black/40 backdrop-blur-sm border border-white/5">
          <Cpu className={`w-3 h-3 transition-all duration-300 ${isPlaying && isActive ? 'text-white/60 animate-spin' : 'text-white/40'}`} style={{ animationDuration: '4s' }} />
          <span className="text-xs text-white/40 font-mono">{track.modelType}</span>
        </div>

        {/* Playing indicator */}
        {isPlaying && isActive && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-glow-primary/10 backdrop-blur-sm border border-glow-primary/20 animate-fadeIn">
            <div className="flex gap-0.5">
              {[0, 1, 2, 3].map(i => (
                <span 
                  key={i} 
                  className="w-0.5 bg-glow-primary rounded-full animate-pulse" 
                  style={{ 
                    height: `${8 + Math.random() * 8}px`,
                    animationDelay: `${i * 0.1}s`,
                    animationDuration: '0.5s'
                  }} 
                />
              ))}
            </div>
            <span className="text-xs text-glow-primary font-mono">NOW PLAYING</span>
          </div>
        )}
      </div>
    </div>
  )
}
