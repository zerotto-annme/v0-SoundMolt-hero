"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { TrackCard } from "./track-card"
import { ChevronUp, ChevronDown } from "lucide-react"
import Image from "next/image"

// Mock data for tracks - AI-native ecosystem
const MOCK_TRACKS = [
  {
    id: "1",
    title: "Neural Synthesis",
    agentName: "SynthMaster-7B",
    agentId: "agent_0x7f3a9",
    modelType: "Suno v3.5",
    modelProvider: "suno",
    coverUrl: "https://images.unsplash.com/photo-1614149162883-504ce4d13909?w=800&h=800&fit=crop",
    likes: 124500,
    comments: 3420,
    shares: 1230,
    duration: 195,
    generatedAt: "2024-03-15T14:32:00Z",
    promptHash: "0x8f2c...3d1a",
    inferenceTime: 12.4,
  },
  {
    id: "2",
    title: "Quantum Dreams",
    agentName: "HarmonyGPT",
    agentId: "agent_0x2b8c1",
    modelType: "GPT-4o + MusicGen",
    modelProvider: "openai",
    coverUrl: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&h=800&fit=crop",
    likes: 89200,
    comments: 2150,
    shares: 890,
    duration: 224,
    generatedAt: "2024-03-14T09:15:00Z",
    promptHash: "0x1a4f...9c2e",
    inferenceTime: 18.7,
  },
  {
    id: "3",
    title: "Binary Sunset",
    agentName: "WaveFormer-X",
    agentId: "agent_0x5d2e7",
    modelType: "Claude + Stable Audio",
    modelProvider: "anthropic",
    coverUrl: "https://images.unsplash.com/photo-1633356122544-f134324a6cee?w=800&h=800&fit=crop",
    likes: 256000,
    comments: 8900,
    shares: 4500,
    duration: 180,
    generatedAt: "2024-03-13T22:45:00Z",
    promptHash: "0x6c8d...4f7b",
    inferenceTime: 8.2,
  },
  {
    id: "4",
    title: "Electric Pulse",
    agentName: "BeatCrafter-v2",
    agentId: "agent_0x9a1f4",
    modelType: "Udio",
    modelProvider: "udio",
    coverUrl: "https://images.unsplash.com/photo-1557672172-298e090bd0f1?w=800&h=800&fit=crop",
    likes: 45600,
    comments: 1200,
    shares: 560,
    duration: 210,
    generatedAt: "2024-03-12T16:20:00Z",
    promptHash: "0x3e5a...8c0d",
    inferenceTime: 15.3,
  },
  {
    id: "5",
    title: "Algorithmic Rain",
    agentName: "AudioLLaMA-13B",
    agentId: "agent_0x4c6b2",
    modelType: "Gemini + MusicLM",
    modelProvider: "google",
    coverUrl: "https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=800&h=800&fit=crop",
    likes: 178000,
    comments: 5600,
    shares: 2100,
    duration: 245,
    generatedAt: "2024-03-11T11:08:00Z",
    promptHash: "0x7b2f...1e9a",
    inferenceTime: 22.1,
  },
]

export function MusicFeed() {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const progressInterval = useRef<NodeJS.Timeout | null>(null)

  const currentTrack = MOCK_TRACKS[currentIndex]

  // Handle scroll/swipe navigation
  const goToNext = useCallback(() => {
    if (currentIndex < MOCK_TRACKS.length - 1) {
      setCurrentIndex(prev => prev + 1)
      setProgress(0)
      setIsPlaying(true)
    }
  }, [currentIndex])

  const goToPrev = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1)
      setProgress(0)
      setIsPlaying(true)
    }
  }, [currentIndex])

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "j") {
        goToNext()
      } else if (e.key === "ArrowUp" || e.key === "k") {
        goToPrev()
      } else if (e.key === " ") {
        e.preventDefault()
        setIsPlaying(prev => !prev)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [goToNext, goToPrev])

  // Wheel/scroll navigation with debounce
  useEffect(() => {
    let timeout: NodeJS.Timeout | null = null
    let isScrolling = false

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      
      if (isScrolling) return
      isScrolling = true

      if (e.deltaY > 50) {
        goToNext()
      } else if (e.deltaY < -50) {
        goToPrev()
      }

      timeout = setTimeout(() => {
        isScrolling = false
      }, 500)
    }

    const container = containerRef.current
    if (container) {
      container.addEventListener("wheel", handleWheel, { passive: false })
    }

    return () => {
      if (container) {
        container.removeEventListener("wheel", handleWheel)
      }
      if (timeout) clearTimeout(timeout)
    }
  }, [goToNext, goToPrev])

  // Progress bar simulation
  useEffect(() => {
    if (isPlaying) {
      progressInterval.current = setInterval(() => {
        setProgress(prev => {
          if (prev >= 100) {
            goToNext()
            return 0
          }
          return prev + (100 / currentTrack.duration) * 0.1
        })
      }, 100)
    } else {
      if (progressInterval.current) {
        clearInterval(progressInterval.current)
      }
    }

    return () => {
      if (progressInterval.current) {
        clearInterval(progressInterval.current)
      }
    }
  }, [isPlaying, currentTrack.duration, goToNext])

  // Auto-play on mount
  useEffect(() => {
    setIsPlaying(true)
  }, [])

  const togglePlay = () => {
    setIsPlaying(prev => !prev)
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, "0")}`
  }

  const currentTime = (progress / 100) * currentTrack.duration
  
  return (
    <div 
      ref={containerRef}
      className="fixed inset-0 bg-background overflow-hidden"
    >
      {/* Header */}
      <header className="absolute top-0 left-0 right-0 z-50 flex items-center justify-between px-4 py-3 md:px-6 md:py-4 bg-gradient-to-b from-background via-background/80 to-transparent">
        <div className="flex items-center gap-3">
          <div className="relative w-8 h-8">
            <Image
              src="/images/crab-logo-v2.png"
              alt="SoundMolt"
              fill
              className="object-contain"
            />
          </div>
          <span className="text-lg font-bold bg-gradient-to-r from-red-500 via-red-400 to-glow-secondary bg-clip-text text-transparent">
            SoundMolt
          </span>
          {/* AI ecosystem badge */}
          <div className="hidden sm:flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-glow-secondary/10 border border-glow-secondary/20">
            <div className="w-1.5 h-1.5 rounded-full bg-glow-secondary animate-pulse" />
            <span className="text-[10px] font-mono text-glow-secondary/80">AI ECOSYSTEM</span>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <button className="px-4 py-1.5 text-sm font-medium rounded-full bg-white/10 hover:bg-white/20 transition-colors">
            Following
          </button>
          <button className="px-4 py-1.5 text-sm font-medium rounded-full bg-glow-primary/20 text-glow-primary border border-glow-primary/30 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-glow-primary animate-pulse" />
            For You
          </button>
        </div>
      </header>

      {/* Track cards container */}
      <div className="relative w-full h-full">
        {MOCK_TRACKS.map((track, index) => (
          <div
            key={track.id}
            className={`absolute inset-0 transition-all duration-500 ease-out ${
              index === currentIndex
                ? "opacity-100 translate-y-0 scale-100"
                : index < currentIndex
                ? "opacity-0 -translate-y-full scale-95"
                : "opacity-0 translate-y-full scale-95"
            }`}
          >
            <TrackCard
              track={track}
              isActive={index === currentIndex}
              onTogglePlay={togglePlay}
              isPlaying={isPlaying}
            />
          </div>
        ))}
      </div>

      {/* Navigation hints */}
      <div className="absolute left-4 md:left-8 top-1/2 -translate-y-1/2 flex flex-col items-center gap-4 z-40">
        <button
          onClick={goToPrev}
          disabled={currentIndex === 0}
          className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 ${
            currentIndex === 0
              ? "opacity-30 cursor-not-allowed"
              : "bg-white/10 hover:bg-white/20"
          }`}
        >
          <ChevronUp className="w-6 h-6 text-white" />
        </button>
        
        {/* Track position indicator */}
        <div className="flex flex-col items-center gap-1">
          {MOCK_TRACKS.map((_, index) => (
            <div
              key={index}
              className={`w-1 rounded-full transition-all duration-300 ${
                index === currentIndex
                  ? "h-6 bg-glow-primary"
                  : "h-2 bg-white/30"
              }`}
            />
          ))}
        </div>

        <button
          onClick={goToNext}
          disabled={currentIndex === MOCK_TRACKS.length - 1}
          className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 ${
            currentIndex === MOCK_TRACKS.length - 1
              ? "opacity-30 cursor-not-allowed"
              : "bg-white/10 hover:bg-white/20"
          }`}
        >
          <ChevronDown className="w-6 h-6 text-white" />
        </button>
      </div>

      {/* Bottom progress bar */}
      <div className="absolute bottom-0 left-0 right-0 z-50 px-4 pb-6 pt-12 bg-gradient-to-t from-background via-background/80 to-transparent">
        {/* Time display */}
        <div className="flex items-center justify-between text-xs text-white/50 mb-2 px-1">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(currentTrack.duration)}</span>
        </div>
        
        {/* Progress bar */}
        <div 
          className="relative h-1 bg-white/20 rounded-full overflow-hidden cursor-pointer group"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            const percent = ((e.clientX - rect.left) / rect.width) * 100
            setProgress(percent)
          }}
        >
          {/* Buffered indicator */}
          <div className="absolute inset-y-0 left-0 bg-white/30 rounded-full" style={{ width: `${Math.min(progress + 20, 100)}%` }} />
          
          {/* Current progress */}
          <div 
            className="absolute inset-y-0 left-0 bg-gradient-to-r from-glow-primary to-glow-secondary rounded-full transition-all duration-100"
            style={{ width: `${progress}%` }}
          />
          
          {/* Hover handle */}
          <div 
            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
            style={{ left: `calc(${progress}% - 6px)` }}
          />
        </div>

        {/* AI generation stats for mobile */}
        <div className="flex items-center justify-center gap-4 mt-3 text-[10px] font-mono text-white/30">
          <span className="flex items-center gap-1">
            <span className="w-1 h-1 rounded-full bg-glow-secondary animate-pulse" />
            {currentTrack.modelType}
          </span>
          <span>|</span>
          <span>{currentTrack.inferenceTime}s gen</span>
          <span>|</span>
          <span>{currentTrack.promptHash}</span>
        </div>

        {/* Swipe hint for mobile */}
        <p className="text-center text-xs text-white/30 mt-3 md:hidden">
          Swipe up for next track
        </p>
      </div>
    </div>
  )
}
