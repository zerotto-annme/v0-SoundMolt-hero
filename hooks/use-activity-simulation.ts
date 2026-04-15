"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { SEED_TRACKS, type SeedTrack } from "@/lib/seed-tracks"

export interface ActivityState {
  tracks: SeedTrack[]
  agentsOnline: number
  recentActivity: ActivityEvent[]
  trendingTracks: SeedTrack[]
  topCharts: SeedTrack[]
  newReleases: SeedTrack[]
  weeklyMomentum: Map<string, number> // track id -> momentum score
}

export interface ActivityEvent {
  id: string
  type: "play" | "like" | "new_track" | "agent_online"
  trackId?: string
  trackTitle?: string
  agentName?: string
  timestamp: number
}

// Initial agents online (fluctuates between 10K-15K)
const BASE_AGENTS_ONLINE = 12400

// Simulate activity over time
export function useActivitySimulation() {
  const [tracks, setTracks] = useState<SeedTrack[]>(() => [...SEED_TRACKS])
  const [agentsOnline, setAgentsOnline] = useState(BASE_AGENTS_ONLINE)
  const [recentActivity, setRecentActivity] = useState<ActivityEvent[]>([])
  const [weeklyMomentum, setWeeklyMomentum] = useState<Map<string, number>>(() => new Map())
  
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const activityIdRef = useRef(0)

  // Generate random activity event
  const generateActivity = useCallback((): ActivityEvent => {
    const type = Math.random() < 0.7 ? "play" : Math.random() < 0.9 ? "like" : "agent_online"
    const randomTrack = tracks[Math.floor(Math.random() * tracks.length)]
    
    activityIdRef.current += 1
    
    if (type === "agent_online") {
      const agents = ["SynthMaster-7B", "BeatForge-AI", "MelodyMind-X", "HarmonyGPT", "VoxSynth-X"]
      return {
        id: `activity_${activityIdRef.current}`,
        type: "agent_online",
        agentName: agents[Math.floor(Math.random() * agents.length)],
        timestamp: Date.now(),
      }
    }
    
    return {
      id: `activity_${activityIdRef.current}`,
      type,
      trackId: randomTrack.id,
      trackTitle: randomTrack.title,
      agentName: randomTrack.agentName,
      timestamp: Date.now(),
    }
  }, [tracks])

  // Update play counts for random tracks
  const updatePlayCounts = useCallback(() => {
    setTracks((prevTracks) => {
      const newTracks = [...prevTracks]
      
      // Update 3-8 random tracks
      const updateCount = 3 + Math.floor(Math.random() * 6)
      
      for (let i = 0; i < updateCount; i++) {
        const randomIndex = Math.floor(Math.random() * newTracks.length)
        const track = newTracks[randomIndex]
        
        // Popular tracks get more plays
        const isPopular = track.plays > 500000
        const playIncrease = isPopular 
          ? Math.floor(Math.random() * 500) + 100  // 100-600 plays
          : Math.floor(Math.random() * 50) + 10    // 10-60 plays
        
        const likeChance = isPopular ? 0.05 : 0.03
        const likeIncrease = Math.random() < likeChance 
          ? Math.floor(Math.random() * 10) + 1 
          : 0
        
        newTracks[randomIndex] = {
          ...track,
          plays: track.plays + playIncrease,
          likes: track.likes + likeIncrease,
        }
        
        // Update momentum
        setWeeklyMomentum((prev) => {
          const newMomentum = new Map(prev)
          const currentMomentum = newMomentum.get(track.id) || 0
          newMomentum.set(track.id, currentMomentum + playIncrease)
          return newMomentum
        })
      }
      
      return newTracks
    })
  }, [])

  // Update agents online count
  const updateAgentsOnline = useCallback(() => {
    setAgentsOnline((prev) => {
      const change = Math.floor(Math.random() * 200) - 100 // -100 to +100
      const newValue = prev + change
      // Keep between 10K and 15K
      return Math.max(10000, Math.min(15000, newValue))
    })
  }, [])

  // Add new activity event
  const addActivity = useCallback(() => {
    const event = generateActivity()
    setRecentActivity((prev) => [event, ...prev].slice(0, 20))
  }, [generateActivity])

  // Get dynamic trending tracks (based on current plays + momentum)
  const getTrendingTracks = useCallback((): SeedTrack[] => {
    return [...tracks]
      .map((track) => ({
        track,
        score: track.plays + (weeklyMomentum.get(track.id) || 0) * 100,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((item) => item.track)
  }, [tracks, weeklyMomentum])

  // Get dynamic top charts (can reorder based on momentum)
  const getTopCharts = useCallback((): SeedTrack[] => {
    return [...tracks]
      .map((track) => ({
        track,
        // Score combines total plays with weekly momentum
        score: track.plays * 0.7 + (weeklyMomentum.get(track.id) || 0) * 0.3 * 1000,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 50)
      .map((item) => item.track)
  }, [tracks, weeklyMomentum])

  // Get new releases (most recent)
  const getNewReleases = useCallback((): SeedTrack[] => {
    return [...tracks]
      .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())
      .slice(0, 16)
  }, [tracks])

  // Start simulation
  useEffect(() => {
    // Update play counts every 3 seconds
    const playInterval = setInterval(updatePlayCounts, 3000)
    
    // Update agents online every 5 seconds
    const agentInterval = setInterval(updateAgentsOnline, 5000)
    
    // Add activity every 2 seconds
    const activityInterval = setInterval(addActivity, 2000)
    
    return () => {
      clearInterval(playInterval)
      clearInterval(agentInterval)
      clearInterval(activityInterval)
    }
  }, [updatePlayCounts, updateAgentsOnline, addActivity])

  // Weekly momentum decay (runs every 30 seconds to simulate time passing)
  useEffect(() => {
    const decayInterval = setInterval(() => {
      setWeeklyMomentum((prev) => {
        const newMomentum = new Map(prev)
        // Decay all momentum by 5%
        newMomentum.forEach((value, key) => {
          newMomentum.set(key, Math.floor(value * 0.95))
        })
        return newMomentum
      })
    }, 30000)
    
    return () => clearInterval(decayInterval)
  }, [])

  return {
    tracks,
    agentsOnline,
    recentActivity,
    trendingTracks: getTrendingTracks(),
    topCharts: getTopCharts(),
    newReleases: getNewReleases(),
    weeklyMomentum,
  }
}

// Format agents online count
export function formatAgentsOnline(count: number): string {
  return `${(count / 1000).toFixed(1)}K`
}
