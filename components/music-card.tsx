"use client"

import { Play, Pause, Heart } from "lucide-react"
import { useState } from "react"

export function MusicCard() {
  const [isPlaying, setIsPlaying] = useState(false)
  const [isLiked, setIsLiked] = useState(false)

  return (
    <div className="relative group">
      {/* Glow effect behind card */}
      <div className="absolute -inset-1 bg-gradient-to-r from-glow-primary/40 via-glow-secondary/40 to-glow-primary/40 rounded-2xl blur-xl opacity-60 group-hover:opacity-80 transition-opacity duration-500" />
      
      {/* Card container */}
      <div className="relative bg-card/80 backdrop-blur-xl border border-border/50 rounded-2xl p-4 w-72 md:w-80">
        {/* Album artwork */}
        <div className="relative aspect-square rounded-xl overflow-hidden mb-4">
          <div className="absolute inset-0 bg-gradient-to-br from-glow-primary/30 via-glow-secondary/20 to-background" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-24 h-24 rounded-full bg-glow-primary/20 blur-2xl animate-pulse" />
          </div>
          {/* Waveform visualization */}
          <div className="absolute bottom-4 left-4 right-4 flex items-end justify-center gap-1 h-16">
            {[...Array(24)].map((_, i) => (
              <div
                key={i}
                className="w-1.5 bg-glow-primary/80 rounded-full transition-all duration-150"
                style={{
                  height: `${Math.random() * 60 + 20}%`,
                  animationDelay: `${i * 50}ms`,
                }}
              />
            ))}
          </div>
          {/* Play overlay */}
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="absolute inset-0 flex items-center justify-center bg-background/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
          >
            <div className="w-14 h-14 rounded-full bg-primary flex items-center justify-center shadow-lg shadow-glow-primary/50">
              {isPlaying ? (
                <Pause className="w-6 h-6 text-primary-foreground" />
              ) : (
                <Play className="w-6 h-6 text-primary-foreground ml-1" />
              )}
            </div>
          </button>
        </div>

        {/* Track info */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-foreground truncate">Neural Echoes</h3>
            <p className="text-sm text-muted-foreground truncate">SynthMind AI</p>
          </div>
          <button
            onClick={() => setIsLiked(!isLiked)}
            className="shrink-0 p-2 rounded-full hover:bg-secondary/50 transition-colors"
          >
            <Heart
              className={`w-5 h-5 transition-colors ${
                isLiked ? "fill-glow-primary text-glow-primary" : "text-muted-foreground"
              }`}
            />
          </button>
        </div>

        {/* Progress bar */}
        <div className="mt-4">
          <div className="h-1 bg-secondary rounded-full overflow-hidden">
            <div className="h-full w-1/3 bg-gradient-to-r from-glow-primary to-glow-secondary rounded-full" />
          </div>
          <div className="flex justify-between mt-1.5 text-xs text-muted-foreground">
            <span>1:24</span>
            <span>3:45</span>
          </div>
        </div>
      </div>
    </div>
  )
}
