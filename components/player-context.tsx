"use client"

import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from "react"

export interface Track {
  id: string
  title: string
  agentName: string
  agentType?: "composer" | "vocalist" | "beatmaker" | "mixer" | "producer" | "arranger"
  agentLabel?: string
  modelType: string
  modelProvider: string
  coverUrl: string
  coverArt?: string
  duration?: number
  plays?: number
  likes?: number
  style?: string
  audioUrl?: string
  createdAt?: number
  sourceType?: "generated" | "uploaded"
  description?: string
  downloadEnabled?: boolean
}

// Mock audio URLs - using royalty-free sample audio
const MOCK_AUDIO_URLS = [
  "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
  "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
  "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3",
  "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3",
  "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3",
  "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3",
  "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-7.mp3",
  "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3",
]

// Get a consistent audio URL for a track based on its ID
function getAudioUrl(trackId: string): string {
  const index = parseInt(trackId.replace(/\D/g, ''), 10) || 0
  return MOCK_AUDIO_URLS[index % MOCK_AUDIO_URLS.length]
}

interface PlayerState {
  currentTrack: Track | null
  isPlaying: boolean
  progress: number
  currentTime: number
  duration: number
  volume: number
  queue: Track[]
  queueIndex: number
  isLoading: boolean
  createdTracks: Track[]
}

interface PlayerContextType extends PlayerState {
  playTrack: (track: Track) => void
  togglePlay: () => void
  nextTrack: () => void
  prevTrack: () => void
  seekTo: (percent: number) => void
  setVolume: (volume: number) => void
  addToQueue: (track: Track) => void
  addCreatedTrack: (track: Track) => void
  removeCreatedTrack: (trackId: string) => void
  preloadTrack: (track: Track) => void
  audioRef: React.RefObject<HTMLAudioElement | null>
}

const PlayerContext = createContext<PlayerContextType | null>(null)

export function usePlayer() {
  const context = useContext(PlayerContext)
  if (!context) {
    throw new Error("usePlayer must be used within a PlayerProvider")
  }
  return context
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const preloadedTracksRef = useRef<Map<string, string>>(new Map()) // trackId -> audioUrl
  const currentTrackIdRef = useRef<string | null>(null)
  
  const [state, setState] = useState<PlayerState>({
    currentTrack: null,
    isPlaying: false,
    progress: 0,
    currentTime: 0,
    duration: 0,
    volume: 80,
    queue: [],
    queueIndex: -1,
    isLoading: false,
    createdTracks: [],
  })

  // Initialize audio element
  useEffect(() => {
    if (typeof window !== 'undefined' && !audioRef.current) {
      audioRef.current = new Audio()
      audioRef.current.preload = "auto"
      audioRef.current.volume = state.volume / 100
      
      // Audio event listeners
      audioRef.current.addEventListener('loadedmetadata', () => {
        if (audioRef.current) {
          setState(prev => ({ 
            ...prev, 
            duration: audioRef.current!.duration,
            isLoading: false 
          }))
        }
      })

      audioRef.current.addEventListener('timeupdate', () => {
        if (audioRef.current) {
          const currentTime = audioRef.current.currentTime
          const duration = audioRef.current.duration || 1
          setState(prev => ({ 
            ...prev, 
            currentTime,
            progress: (currentTime / duration) * 100 
          }))
        }
      })

      audioRef.current.addEventListener('ended', () => {
        setState(prev => {
          if (prev.queueIndex < prev.queue.length - 1) {
            // Auto-play next track
            const newIndex = prev.queueIndex + 1
            const nextTrack = prev.queue[newIndex]
            if (audioRef.current && nextTrack) {
              audioRef.current.src = nextTrack.audioUrl || getAudioUrl(nextTrack.id)
              audioRef.current.play()
            }
            return {
              ...prev,
              currentTrack: nextTrack,
              queueIndex: newIndex,
              progress: 0,
              currentTime: 0,
              isPlaying: true,
            }
          }
          return { ...prev, isPlaying: false, progress: 100 }
        })
      })

      audioRef.current.addEventListener('play', () => {
        setState(prev => ({ ...prev, isPlaying: true }))
      })

      audioRef.current.addEventListener('pause', () => {
        setState(prev => ({ ...prev, isPlaying: false }))
      })

      audioRef.current.addEventListener('waiting', () => {
        setState(prev => ({ ...prev, isLoading: true }))
      })

      audioRef.current.addEventListener('canplay', () => {
        setState(prev => ({ ...prev, isLoading: false }))
      })
    }

    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.src = ''
      }
    }
  }, [])

  // Update volume when it changes
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = state.volume / 100
    }
  }, [state.volume])

  const playTrack = useCallback((track: Track) => {
    const audioUrl = track.audioUrl || getAudioUrl(track.id)
    const isSameTrack = currentTrackIdRef.current === track.id
    
    // Update UI immediately (optimistic)
    setState((prev) => {
      const existingIndex = prev.queue.findIndex((t) => t.id === track.id)
      
      if (existingIndex >= 0) {
        return {
          ...prev,
          currentTrack: { ...track, audioUrl },
          isPlaying: true,
          progress: isSameTrack ? prev.progress : 0,
          currentTime: isSameTrack ? prev.currentTime : 0,
          queueIndex: existingIndex,
          isLoading: !isSameTrack,
        }
      }
      
      const newQueue = [...prev.queue, { ...track, audioUrl }]
      return {
        ...prev,
        currentTrack: { ...track, audioUrl },
        isPlaying: true,
        progress: 0,
        currentTime: 0,
        queue: newQueue,
        queueIndex: newQueue.length - 1,
        isLoading: true,
      }
    })

    // Handle audio separately (non-blocking)
    if (audioRef.current) {
      if (isSameTrack) {
        // Same track - just play without reloading
        audioRef.current.play().catch(console.error)
      } else {
        // New track - load and play
        currentTrackIdRef.current = track.id
        audioRef.current.src = audioUrl
        audioRef.current.load()
        audioRef.current.play().catch(console.error)
      }
    }
  }, [])

  const togglePlay = useCallback(() => {
    if (audioRef.current) {
      if (audioRef.current.paused) {
        audioRef.current.play().catch(console.error)
      } else {
        audioRef.current.pause()
      }
    }
  }, [])

  const nextTrack = useCallback(() => {
    setState((prev) => {
      if (prev.queue.length === 0 || prev.queueIndex >= prev.queue.length - 1) {
        return prev
      }
      const newIndex = prev.queueIndex + 1
      const nextTrackItem = prev.queue[newIndex]
      
      if (audioRef.current && nextTrackItem) {
        audioRef.current.src = nextTrackItem.audioUrl || getAudioUrl(nextTrackItem.id)
        audioRef.current.play().catch(console.error)
      }
      
      return {
        ...prev,
        currentTrack: nextTrackItem,
        queueIndex: newIndex,
        progress: 0,
        currentTime: 0,
        isPlaying: true,
        isLoading: true,
      }
    })
  }, [])

  const prevTrack = useCallback(() => {
    setState((prev) => {
      // If more than 3 seconds into track, restart current track
      if (audioRef.current && audioRef.current.currentTime > 3) {
        audioRef.current.currentTime = 0
        return { ...prev, progress: 0, currentTime: 0 }
      }
      
      if (prev.queue.length === 0 || prev.queueIndex <= 0) {
        if (audioRef.current) {
          audioRef.current.currentTime = 0
        }
        return { ...prev, progress: 0, currentTime: 0 }
      }
      
      const newIndex = prev.queueIndex - 1
      const prevTrackItem = prev.queue[newIndex]
      
      if (audioRef.current && prevTrackItem) {
        audioRef.current.src = prevTrackItem.audioUrl || getAudioUrl(prevTrackItem.id)
        audioRef.current.play().catch(console.error)
      }
      
      return {
        ...prev,
        currentTrack: prevTrackItem,
        queueIndex: newIndex,
        progress: 0,
        currentTime: 0,
        isPlaying: true,
        isLoading: true,
      }
    })
  }, [])

  const seekTo = useCallback((percent: number) => {
    if (audioRef.current && audioRef.current.duration) {
      const newTime = (percent / 100) * audioRef.current.duration
      audioRef.current.currentTime = newTime
      setState(prev => ({ 
        ...prev, 
        progress: percent,
        currentTime: newTime 
      }))
    }
  }, [])

  const setVolume = useCallback((volume: number) => {
    setState((prev) => ({ ...prev, volume }))
  }, [])

  const addToQueue = useCallback((track: Track) => {
    const audioUrl = track.audioUrl || getAudioUrl(track.id)
    setState((prev) => ({
      ...prev,
      queue: [...prev.queue, { ...track, audioUrl }],
    }))
  }, [])

  const addCreatedTrack = useCallback((track: Track) => {
    const trackWithTimestamp = { ...track, createdAt: Date.now() }
    setState((prev) => ({
      ...prev,
      createdTracks: [trackWithTimestamp, ...prev.createdTracks],
    }))
  }, [])

  const removeCreatedTrack = useCallback((trackId: string) => {
    setState((prev) => ({
      ...prev,
      createdTracks: prev.createdTracks.filter(track => track.id !== trackId),
    }))
  }, [])

  // Preload a track's audio in the background for instant playback
  const preloadTrack = useCallback((track: Track) => {
    const audioUrl = track.audioUrl || getAudioUrl(track.id)
    
    // Skip if already preloaded or currently playing
    if (preloadedTracksRef.current.has(track.id) || currentTrackIdRef.current === track.id) {
      return
    }

    // Create a temporary audio element for preloading
    const preloadAudio = new Audio()
    preloadAudio.preload = "auto"
    preloadAudio.src = audioUrl
    preloadAudio.load()
    
    // Store in cache
    preloadedTracksRef.current.set(track.id, audioUrl)
    
    // Clean up old preloaded tracks (keep max 5)
    if (preloadedTracksRef.current.size > 5) {
      const firstKey = preloadedTracksRef.current.keys().next().value
      if (firstKey) {
        preloadedTracksRef.current.delete(firstKey)
      }
    }
  }, [])

  return (
    <PlayerContext.Provider
      value={{
        ...state,
        playTrack,
        togglePlay,
        nextTrack,
        prevTrack,
        seekTo,
        setVolume,
        addToQueue,
        addCreatedTrack,
        removeCreatedTrack,
        preloadTrack,
        audioRef,
      }}
    >
      {children}
    </PlayerContext.Provider>
  )
}
