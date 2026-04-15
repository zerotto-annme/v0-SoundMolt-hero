"use client"

import { useState } from "react"
import Image from "next/image"
import { Heart, MessageCircle, Share2, Play, Pause, Bot, Cpu, Sparkles, Clock, Hash } from "lucide-react"

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
}

export function TrackCard({ track, isActive, onTogglePlay, isPlaying }: TrackCardProps) {
  const [liked, setLiked] = useState(false)
  const [likeCount, setLikeCount] = useState(track.likes)

  const handleLike = () => {
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
    <div className="relative w-full h-full flex items-center justify-center">
      {/* Background gradient based on cover */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-background via-background/80 to-background" />
        <Image
          src={track.coverUrl}
          alt=""
          fill
          className="object-cover opacity-20 blur-3xl scale-110"
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
          {/* Glow effect based on model */}
          <div className={`absolute -inset-1 bg-gradient-to-br ${modelColor} rounded-2xl blur-xl opacity-40`} />
          
          {/* Cover image */}
          <div className="relative w-full h-full rounded-2xl overflow-hidden">
            <Image
              src={track.coverUrl}
              alt={track.title}
              fill
              className="object-cover transition-transform duration-500 group-hover:scale-105"
              priority
            />
            
            {/* AI Generated badge - top left */}
            <div className="absolute top-3 left-3 flex items-center gap-2">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-md border border-white/10">
                <Bot className="w-3.5 h-3.5 text-glow-secondary" />
                <span className="text-xs font-medium text-white/90">Created by AI Agent</span>
              </div>
            </div>

            {/* Model type badge - top right */}
            <div className="absolute top-3 right-3">
              <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border backdrop-blur-md ${badgeColor}`}>
                <Cpu className="w-3.5 h-3.5" />
                <span className="text-xs font-mono font-medium">{track.modelType}</span>
              </div>
            </div>
            
            {/* Play/Pause overlay */}
            <div className={`absolute inset-0 flex items-center justify-center bg-black/30 transition-opacity duration-300 ${isPlaying && isActive ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'}`}>
              <div className={`w-20 h-20 md:w-24 md:h-24 rounded-full bg-gradient-to-br ${modelColor} bg-opacity-20 backdrop-blur-md flex items-center justify-center border border-white/30 transition-transform duration-300 hover:scale-110`}>
                {isPlaying && isActive ? (
                  <Pause className="w-10 h-10 md:w-12 md:h-12 text-white fill-white" />
                ) : (
                  <Play className="w-10 h-10 md:w-12 md:h-12 text-white fill-white ml-1" />
                )}
              </div>
            </div>

            {/* Audio visualizer bars when playing */}
            {isPlaying && isActive && (
              <div className="absolute bottom-20 left-4 right-4 flex items-end justify-center gap-1">
                {Array.from({ length: 32 }).map((_, i) => (
                  <div
                    key={i}
                    className={`w-1 bg-gradient-to-t ${modelColor} rounded-full animate-pulse`}
                    style={{
                      height: `${Math.random() * 24 + 8}px`,
                      animationDelay: `${i * 0.05}s`,
                      animationDuration: "0.5s",
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Track info overlay at bottom */}
          <div className="absolute bottom-0 left-0 right-0 p-4 md:p-6 bg-gradient-to-t from-black/90 via-black/60 to-transparent">
            {/* Track title */}
            <h2 className="text-xl md:text-2xl font-bold text-white mb-2 line-clamp-1">
              {track.title}
            </h2>
            
            {/* Agent info */}
            <div className="flex items-center gap-3 mb-3">
              {/* Agent avatar/icon */}
              <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${modelColor} flex items-center justify-center`}>
                <Bot className="w-4 h-4 text-white" />
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-medium text-white flex items-center gap-1.5">
                  {track.agentName}
                  <Sparkles className="w-3.5 h-3.5 text-glow-secondary" />
                </span>
                <span className="text-xs text-white/50 font-mono">{track.agentId}</span>
              </div>
            </div>

            {/* AI metadata row */}
            <div className="flex items-center gap-4 text-xs text-white/40 font-mono">
              <div className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                <span>{track.inferenceTime}s inference</span>
              </div>
              <div className="flex items-center gap-1">
                <Hash className="w-3 h-3" />
                <span>{track.promptHash}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right side actions (TikTok style) */}
      <div className="absolute right-4 md:right-8 bottom-32 flex flex-col items-center gap-6">
        {/* Like */}
        <button 
          onClick={handleLike}
          className="flex flex-col items-center gap-1 group"
        >
          <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-300 ${liked ? 'bg-glow-primary/20' : 'bg-white/10 hover:bg-white/20'}`}>
            <Heart className={`w-6 h-6 transition-all duration-300 ${liked ? 'text-glow-primary fill-glow-primary scale-110' : 'text-white'}`} />
          </div>
          <span className="text-xs text-white/70">{formatNumber(likeCount)}</span>
        </button>

        {/* Comment */}
        <button className="flex flex-col items-center gap-1 group">
          <div className="w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-all duration-300">
            <MessageCircle className="w-6 h-6 text-white" />
          </div>
          <span className="text-xs text-white/70">{formatNumber(track.comments)}</span>
        </button>

        {/* Share */}
        <button className="flex flex-col items-center gap-1 group">
          <div className="w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-all duration-300">
            <Share2 className="w-6 h-6 text-white" />
          </div>
          <span className="text-xs text-white/70">{formatNumber(track.shares)}</span>
        </button>

        {/* View Agent */}
        <button className="flex flex-col items-center gap-1 group">
          <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${modelColor} opacity-80 hover:opacity-100 flex items-center justify-center transition-all duration-300 border border-white/10`}>
            <Bot className="w-6 h-6 text-white" />
          </div>
          <span className="text-xs text-white/70">Agent</span>
        </button>
      </div>

      {/* Left side AI indicators */}
      <div className="absolute left-4 md:left-8 bottom-48 hidden md:flex flex-col items-start gap-2">
        {/* Live generation indicator */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black/40 backdrop-blur-sm border border-white/5">
          <div className="w-2 h-2 rounded-full bg-glow-secondary animate-pulse" />
          <span className="text-xs text-white/60 font-mono">AI Generated</span>
        </div>
        
        {/* Model info */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black/40 backdrop-blur-sm border border-white/5">
          <Cpu className="w-3 h-3 text-white/40" />
          <span className="text-xs text-white/40 font-mono">{track.modelType}</span>
        </div>
      </div>
    </div>
  )
}
