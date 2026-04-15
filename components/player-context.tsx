"use client"

import { createContext, useContext, useState, useCallback, type ReactNode } from "react"

export interface Track {
  id: string
  title: string
  agentName: string
  modelType: string
  modelProvider: string
  coverUrl: string
  duration?: number
  plays?: number
}

interface PlayerState {
  currentTrack: Track | null
  isPlaying: boolean
  progress: number
  volume: number
  queue: Track[]
  queueIndex: number
}

interface PlayerContextType extends PlayerState {
  playTrack: (track: Track) => void
  togglePlay: () => void
  nextTrack: () => void
  prevTrack: () => void
  setProgress: (progress: number) => void
  setVolume: (volume: number) => void
  addToQueue: (track: Track) => void
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
  const [state, setState] = useState<PlayerState>({
    currentTrack: null,
    isPlaying: false,
    progress: 0,
    volume: 80,
    queue: [],
    queueIndex: -1,
  })

  const playTrack = useCallback((track: Track) => {
    setState((prev) => {
      const existingIndex = prev.queue.findIndex((t) => t.id === track.id)
      if (existingIndex >= 0) {
        return {
          ...prev,
          currentTrack: track,
          isPlaying: true,
          progress: 0,
          queueIndex: existingIndex,
        }
      }
      const newQueue = [...prev.queue, track]
      return {
        ...prev,
        currentTrack: track,
        isPlaying: true,
        progress: 0,
        queue: newQueue,
        queueIndex: newQueue.length - 1,
      }
    })
  }, [])

  const togglePlay = useCallback(() => {
    setState((prev) => ({ ...prev, isPlaying: !prev.isPlaying }))
  }, [])

  const nextTrack = useCallback(() => {
    setState((prev) => {
      if (prev.queue.length === 0 || prev.queueIndex >= prev.queue.length - 1) {
        return prev
      }
      const newIndex = prev.queueIndex + 1
      return {
        ...prev,
        currentTrack: prev.queue[newIndex],
        queueIndex: newIndex,
        progress: 0,
        isPlaying: true,
      }
    })
  }, [])

  const prevTrack = useCallback(() => {
    setState((prev) => {
      if (prev.queue.length === 0 || prev.queueIndex <= 0) {
        return { ...prev, progress: 0 }
      }
      const newIndex = prev.queueIndex - 1
      return {
        ...prev,
        currentTrack: prev.queue[newIndex],
        queueIndex: newIndex,
        progress: 0,
        isPlaying: true,
      }
    })
  }, [])

  const setProgress = useCallback((progress: number) => {
    setState((prev) => ({ ...prev, progress }))
  }, [])

  const setVolume = useCallback((volume: number) => {
    setState((prev) => ({ ...prev, volume }))
  }, [])

  const addToQueue = useCallback((track: Track) => {
    setState((prev) => ({
      ...prev,
      queue: [...prev.queue, track],
    }))
  }, [])

  return (
    <PlayerContext.Provider
      value={{
        ...state,
        playTrack,
        togglePlay,
        nextTrack,
        prevTrack,
        setProgress,
        setVolume,
        addToQueue,
      }}
    >
      {children}
    </PlayerContext.Provider>
  )
}
