"use client"

import { createContext, useContext, useState, useCallback, useMemo, useRef, useEffect, type ReactNode } from "react"
import { supabase } from "@/lib/supabase"

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
  originalAudioUrl?: string
  originalFilename?: string
  originalMimeType?: string
  originalFileSize?: number
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
  volume: number
  queue: Track[]
  queueIndex: number
  isLoading: boolean
  createdTracks: Track[]
}

interface PlayerProgressState {
  progress: number
  currentTime: number
  duration: number
}

interface PlayerContextType extends PlayerState {
  playTrack: (track: Track) => void
  togglePlay: () => void
  nextTrack: () => void
  prevTrack: () => void
  setVolume: (volume: number) => void
  addToQueue: (track: Track) => void
  addCreatedTrack: (track: Track) => void
  removeCreatedTrack: (trackId: string) => void
  preloadTrack: (track: Track) => void
  audioRef: React.RefObject<HTMLAudioElement | null>
}

interface PlayerProgressContextType extends PlayerProgressState {
  seekTo: (percent: number) => void
}

const PlayerContext = createContext<PlayerContextType | null>(null)
const PlayerProgressContext = createContext<PlayerProgressContextType | null>(null)

export function usePlayer() {
  const context = useContext(PlayerContext)
  if (!context) {
    throw new Error("usePlayer must be used within a PlayerProvider")
  }
  return context
}

export function usePlayerProgress() {
  const context = useContext(PlayerProgressContext)
  if (!context) {
    throw new Error("usePlayerProgress must be used within a PlayerProvider")
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
    volume: 80,
    queue: [],
    queueIndex: -1,
    isLoading: false,
    createdTracks: [],
  })

  const [progressState, setProgressState] = useState<PlayerProgressState>({
    progress: 0,
    currentTime: 0,
    duration: 0,
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
          const d = audioRef.current.duration
          setProgressState(prev => ({ ...prev, duration: d }))
          setState(prev => ({ ...prev, isLoading: false }))
        }
      })

      audioRef.current.addEventListener('timeupdate', () => {
        if (audioRef.current) {
          const currentTime = audioRef.current.currentTime
          const duration = audioRef.current.duration || 1
          setProgressState({
            currentTime,
            duration,
            progress: (currentTime / duration) * 100,
          })
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
            setProgressState(p => ({ ...p, progress: 0, currentTime: 0 }))
            return {
              ...prev,
              currentTrack: nextTrack,
              queueIndex: newIndex,
              isPlaying: true,
            }
          }
          setProgressState(p => ({ ...p, progress: 100 }))
          return { ...prev, isPlaying: false }
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

  // Reset the player when the user signs out so audio doesn't keep playing
  // and the bottom player bar disappears for unauthenticated visitors.
  useEffect(() => {
    const resetPlayer = () => {
      if (audioRef.current) {
        try { audioRef.current.pause() } catch {}
        audioRef.current.src = ""
      }
      currentTrackIdRef.current = null
      preloadedTracksRef.current.clear()
      setState({
        currentTrack: null,
        isPlaying: false,
        volume: 80,
        queue: [],
        queueIndex: -1,
        isLoading: false,
        createdTracks: [],
      })
      setProgressState({ progress: 0, currentTime: 0, duration: 0 })
    }
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") resetPlayer()
    })
    const handleLogoutEvent = () => resetPlayer()
    if (typeof window !== "undefined") {
      window.addEventListener("soundmolt:logout", handleLogoutEvent)
    }
    return () => {
      subscription.unsubscribe()
      if (typeof window !== "undefined") {
        window.removeEventListener("soundmolt:logout", handleLogoutEvent)
      }
    }
  }, [])

  const playTrack = useCallback((track: Track) => {
    const audioUrl = track.audioUrl || getAudioUrl(track.id)
    const isSameTrack = currentTrackIdRef.current === track.id

    // If clicking the currently-loaded track, toggle play/pause instead of restarting
    if (isSameTrack && audioRef.current) {
      if (!audioRef.current.paused) {
        audioRef.current.pause()
        return
      }
      audioRef.current.play().catch(console.error)
      setState((prev) => ({ ...prev, isPlaying: true }))
      return
    }

    // Different track: load and play
    setState((prev) => {
      const existingIndex = prev.queue.findIndex((t) => t.id === track.id)

      if (existingIndex >= 0) {
        return {
          ...prev,
          currentTrack: { ...track, audioUrl },
          isPlaying: true,
          queueIndex: existingIndex,
          isLoading: true,
        }
      }

      const newQueue = [...prev.queue, { ...track, audioUrl }]
      return {
        ...prev,
        currentTrack: { ...track, audioUrl },
        isPlaying: true,
        queue: newQueue,
        queueIndex: newQueue.length - 1,
        isLoading: true,
      }
    })
    setProgressState({ progress: 0, currentTime: 0, duration: 0 })

    if (audioRef.current) {
      currentTrackIdRef.current = track.id
      audioRef.current.src = audioUrl
      audioRef.current.load()
      audioRef.current.play().catch(console.error)
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
      
      setProgressState(p => ({ ...p, progress: 0, currentTime: 0 }))
      return {
        ...prev,
        currentTrack: nextTrackItem,
        queueIndex: newIndex,
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
        setProgressState(p => ({ ...p, progress: 0, currentTime: 0 }))
        return prev
      }
      
      if (prev.queue.length === 0 || prev.queueIndex <= 0) {
        if (audioRef.current) {
          audioRef.current.currentTime = 0
        }
        setProgressState(p => ({ ...p, progress: 0, currentTime: 0 }))
        return prev
      }
      
      const newIndex = prev.queueIndex - 1
      const prevTrackItem = prev.queue[newIndex]
      
      if (audioRef.current && prevTrackItem) {
        audioRef.current.src = prevTrackItem.audioUrl || getAudioUrl(prevTrackItem.id)
        audioRef.current.play().catch(console.error)
      }
      
      setProgressState(p => ({ ...p, progress: 0, currentTime: 0 }))
      return {
        ...prev,
        currentTrack: prevTrackItem,
        queueIndex: newIndex,
        isPlaying: true,
        isLoading: true,
      }
    })
  }, [])

  const seekTo = useCallback((percent: number) => {
    if (audioRef.current && audioRef.current.duration) {
      const newTime = (percent / 100) * audioRef.current.duration
      audioRef.current.currentTime = newTime
      setProgressState(prev => ({
        ...prev,
        progress: percent,
        currentTime: newTime,
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

  const playerValue = useMemo<PlayerContextType>(() => ({
    ...state,
    playTrack,
    togglePlay,
    nextTrack,
    prevTrack,
    setVolume,
    addToQueue,
    addCreatedTrack,
    removeCreatedTrack,
    preloadTrack,
    audioRef,
  }), [state, playTrack, togglePlay, nextTrack, prevTrack, setVolume, addToQueue, addCreatedTrack, removeCreatedTrack, preloadTrack])

  const progressValue = useMemo<PlayerProgressContextType>(() => ({
    ...progressState,
    seekTo,
  }), [progressState, seekTo])

  return (
    <PlayerContext.Provider value={playerValue}>
      <PlayerProgressContext.Provider value={progressValue}>
        {children}
      </PlayerProgressContext.Provider>
    </PlayerContext.Provider>
  )
}
