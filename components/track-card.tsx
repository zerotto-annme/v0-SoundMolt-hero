"use client"

import { useState } from "react"
import Image from "next/image"
import { Heart, MessageCircle, Share2, Play, Pause, User } from "lucide-react"
import { Button } from "@/components/ui/button"

interface TrackCardProps {
  track: {
    id: string
    title: string
    artist: string
    coverUrl: string
    likes: number
    comments: number
    shares: number
    duration: number
  }
  isActive: boolean
  onTogglePlay: () => void
  isPlaying: boolean
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
      </div>

      {/* Main content area */}
      <div className="relative z-10 flex items-center justify-center w-full max-w-lg px-4">
        {/* Album cover / Visual card */}
        <div 
          className="relative aspect-square w-full max-w-[70vh] rounded-2xl overflow-hidden shadow-2xl shadow-black/50 cursor-pointer group"
          onClick={onTogglePlay}
        >
          {/* Glow effect */}
          <div className="absolute -inset-1 bg-gradient-to-br from-glow-primary/30 via-transparent to-glow-secondary/30 rounded-2xl blur-xl opacity-60" />
          
          {/* Cover image */}
          <div className="relative w-full h-full rounded-2xl overflow-hidden">
            <Image
              src={track.coverUrl}
              alt={track.title}
              fill
              className="object-cover transition-transform duration-500 group-hover:scale-105"
              priority
            />
            
            {/* Play/Pause overlay */}
            <div className={`absolute inset-0 flex items-center justify-center bg-black/30 transition-opacity duration-300 ${isPlaying && isActive ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'}`}>
              <div className="w-20 h-20 md:w-24 md:h-24 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center border border-white/30 transition-transform duration-300 hover:scale-110">
                {isPlaying && isActive ? (
                  <Pause className="w-10 h-10 md:w-12 md:h-12 text-white fill-white" />
                ) : (
                  <Play className="w-10 h-10 md:w-12 md:h-12 text-white fill-white ml-1" />
                )}
              </div>
            </div>

            {/* Audio visualizer bars when playing */}
            {isPlaying && isActive && (
              <div className="absolute bottom-4 left-4 right-4 flex items-end justify-center gap-1">
                {Array.from({ length: 32 }).map((_, i) => (
                  <div
                    key={i}
                    className="w-1 bg-white/80 rounded-full animate-pulse"
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
          <div className="absolute bottom-0 left-0 right-0 p-4 md:p-6 bg-gradient-to-t from-black/80 via-black/40 to-transparent">
            <h2 className="text-xl md:text-2xl font-bold text-white mb-1 line-clamp-1">
              {track.title}
            </h2>
            <p className="text-sm md:text-base text-white/70 flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-glow-primary/30 flex items-center justify-center">
                <User className="w-3 h-3 text-glow-primary" />
              </span>
              {track.artist}
            </p>
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

        {/* View Artist */}
        <button className="flex flex-col items-center gap-1 group">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-glow-primary/30 to-glow-secondary/30 hover:from-glow-primary/50 hover:to-glow-secondary/50 flex items-center justify-center transition-all duration-300 border border-white/10">
            <User className="w-6 h-6 text-white" />
          </div>
          <span className="text-xs text-white/70">Artist</span>
        </button>
      </div>
    </div>
  )
}
