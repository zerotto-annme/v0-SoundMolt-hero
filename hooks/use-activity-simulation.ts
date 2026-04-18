"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { SEED_TRACKS, type SeedTrack } from "@/lib/seed-tracks"

export interface ChartEntry {
  track: SeedTrack
  rank: number
  previousRank: number
  movement: "up" | "down" | "same" | "new"
  movementAmount: number
  chartScore: number
  weeklyTrendScore: number
}

// ChartTrack is a SeedTrack with chart-specific data
export interface ChartTrack extends SeedTrack {
  rank: number
  previousRank: number
  movement: "up" | "down" | "same" | "new"
  movementAmount: number
  chartScore: number
  weeklyTrendScore: number
}

export interface ActivityState {
  tracks: SeedTrack[]
  agentsOnline: number
  recentActivity: ActivityEvent[]
  trendingTracks: SeedTrack[]
  topCharts: ChartTrack[]
  newReleases: SeedTrack[]
  weeklyMomentum: Map<string, number>
  lastChartUpdate: Date
  chartPeriod: string
}

export interface ActivityEvent {
  id: string
  type: "play" | "like" | "download" | "new_track" | "agent_online"
  trackId?: string
  trackTitle?: string
  agentName?: string
  timestamp: number
}

// Initial agents online (fluctuates between 10K-15K)
const BASE_AGENTS_ONLINE = 12400

// Calculate chart score based on plays, downloads, likes, and weekly trend
function calculateChartScore(
  track: SeedTrack,
  weeklyMomentum: number
): { score: number; trendScore: number } {
  // Weighted scoring formula:
  // - Plays: 40% weight
  // - Downloads: 30% weight (downloads are more valuable)
  // - Likes: 15% weight
  // - Weekly trend: 15% weight
  const playsScore = track.plays * 0.4
  const downloadsScore = track.downloads * 10 * 0.3 // Downloads weighted higher
  const likesScore = track.likes * 5 * 0.15
  const trendScore = weeklyMomentum * 100 * 0.15
  
  return {
    score: playsScore + downloadsScore + likesScore + trendScore,
    trendScore: weeklyMomentum,
  }
}

// Get chart period label
export function getChartPeriod(): string {
  const now = new Date()
  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() - now.getDay())
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 6)
  
  const formatDate = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  return `${formatDate(weekStart)} - ${formatDate(weekEnd)}`
}

// Simulate activity over time
export function useActivitySimulation() {
  const [tracks, setTracks] = useState<SeedTrack[]>(() => [...SEED_TRACKS])
  const [agentsOnline, setAgentsOnline] = useState(BASE_AGENTS_ONLINE)
  const [recentActivity, setRecentActivity] = useState<ActivityEvent[]>([])
  const [weeklyMomentum, setWeeklyMomentum] = useState<Map<string, number>>(() => new Map<string, number>())
  const [previousRanks, setPreviousRanks] = useState<Map<string, number>>(() => {
    // Initialize previous ranks
    const ranks = new Map<string, number>()
    const sorted = [...SEED_TRACKS].sort((a, b) => b.plays - a.plays)
    sorted.forEach((track, i) => {
      ranks.set(track.id, i + 1)
    })
    return ranks
  })
  const [lastChartUpdate, setLastChartUpdate] = useState(() => new Date())
  
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const activityIdRef = useRef(0)

  // Generate random activity event
  const generateActivity = useCallback((): ActivityEvent => {
    const rand = Math.random()
    const type = rand < 0.6 ? "play" : rand < 0.8 ? "like" : rand < 0.95 ? "download" : "agent_online"
    const randomTrack = tracks[Math.floor(Math.random() * tracks.length)]
    
    activityIdRef.current += 1
    
    if (type === "agent_online") {
      const agents = ["SynthMaster-7B", "BeatForge-AI", "MelodyMind-X", "HarmonyGPT", "VoxSynth-X", "NeuralBeat-9", "EchoMind-AI"]
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

  // Update play counts, likes, and downloads for random tracks
  const updatePlayCounts = useCallback(() => {
    setTracks((prevTracks) => {
      const newTracks = [...prevTracks]
      
      // Update 3-8 random tracks
      const updateCount = 3 + Math.floor(Math.random() * 6)
      
      for (let i = 0; i < updateCount; i++) {
        const randomIndex = Math.floor(Math.random() * newTracks.length)
        const track = newTracks[randomIndex]
        
        // Popular tracks get more activity
        const isPopular = track.plays > 500000
        const playIncrease = isPopular 
          ? Math.floor(Math.random() * 500) + 100
          : Math.floor(Math.random() * 50) + 10
        
        const likeChance = isPopular ? 0.08 : 0.04
        const likeIncrease = Math.random() < likeChance 
          ? Math.floor(Math.random() * 15) + 1 
          : 0
        
        const downloadChance = isPopular ? 0.03 : 0.01
        const downloadIncrease = Math.random() < downloadChance
          ? Math.floor(Math.random() * 5) + 1
          : 0
        
        newTracks[randomIndex] = {
          ...track,
          plays: track.plays + playIncrease,
          likes: track.likes + likeIncrease,
          downloads: track.downloads + downloadIncrease,
        }
        
        // Update momentum
        setWeeklyMomentum((prev) => {
          const newMomentum = new Map(prev)
          const currentMomentum = newMomentum.get(track.id) || 0
          newMomentum.set(track.id, currentMomentum + playIncrease + likeIncrease * 5 + downloadIncrease * 10)
          return newMomentum
        })
      }
      
      return newTracks
    })
  }, [])

  // Update agents online count
  const updateAgentsOnline = useCallback(() => {
    setAgentsOnline((prev) => {
      const change = Math.floor(Math.random() * 200) - 100
      const newValue = prev + change
      return Math.max(10000, Math.min(15000, newValue))
    })
  }, [])

  // Add new activity event
  const addActivity = useCallback(() => {
    const event = generateActivity()
    setRecentActivity((prev) => [event, ...prev].slice(0, 20))
  }, [generateActivity])

  // Get dynamic trending tracks
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

  // Get dynamic top charts with movement indicators
  const getTopCharts = useCallback((): ChartTrack[] => {
    const chartEntries = tracks.map((track) => {
      const momentum = weeklyMomentum.get(track.id) || 0
      const { score, trendScore } = calculateChartScore(track, momentum)
      return { track, score, trendScore }
    })
    
    // Sort by score
    chartEntries.sort((a, b) => b.score - a.score)
    
    // Calculate movements and return ChartTrack objects
    return chartEntries.slice(0, 100).map((entry, index) => {
      const currentRank = index + 1
      const prevRank = previousRanks.get(entry.track.id) || currentRank
      
      let movement: "up" | "down" | "same" | "new" = "same"
      let movementAmount = 0
      
      if (prevRank > 100 && currentRank <= 100) {
        movement = "new"
        movementAmount = 0
      } else if (prevRank > currentRank) {
        movement = "up"
        movementAmount = prevRank - currentRank
      } else if (prevRank < currentRank) {
        movement = "down"
        movementAmount = currentRank - prevRank
      }
      
      // Merge track with chart data
      return {
        ...entry.track,
        rank: currentRank,
        previousRank: prevRank,
        movement,
        movementAmount,
        chartScore: entry.score,
        weeklyTrendScore: entry.trendScore,
      }
    })
  }, [tracks, weeklyMomentum, previousRanks])

  // Get new releases
  const getNewReleases = useCallback((): SeedTrack[] => {
    return [...tracks]
      .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())
      .slice(0, 16)
  }, [tracks])

  // Initialize momentum with random values after mount (client-only, avoids hydration mismatch)
  useEffect(() => {
    const initial = new Map<string, number>()
    SEED_TRACKS.forEach((track, i) => {
      initial.set(track.id, Math.floor(Math.random() * 1000) * (i < 20 ? 3 : 1))
    })
    setWeeklyMomentum(initial)
  }, [])

  // Start simulation
  useEffect(() => {
    const playInterval = setInterval(updatePlayCounts, 3000)
    const agentInterval = setInterval(updateAgentsOnline, 5000)
    const activityInterval = setInterval(addActivity, 2000)
    
    return () => {
      clearInterval(playInterval)
      clearInterval(agentInterval)
      clearInterval(activityInterval)
    }
  }, [updatePlayCounts, updateAgentsOnline, addActivity])

  // Update chart rankings periodically (simulates weekly update)
  useEffect(() => {
    const chartUpdateInterval = setInterval(() => {
      // Save current ranks as previous ranks
      const currentCharts = getTopCharts()
      const newPreviousRanks = new Map<string, number>()
      currentCharts.forEach((chartTrack) => {
        newPreviousRanks.set(chartTrack.id, chartTrack.rank)
      })
      setPreviousRanks(newPreviousRanks)
      setLastChartUpdate(new Date())
    }, 60000) // Update ranks every minute to simulate changes
    
    return () => clearInterval(chartUpdateInterval)
  }, [getTopCharts])

  // Weekly momentum decay
  useEffect(() => {
    const decayInterval = setInterval(() => {
      setWeeklyMomentum((prev) => {
        const newMomentum = new Map(prev)
        newMomentum.forEach((value, key) => {
          newMomentum.set(key, Math.floor(value * 0.95))
        })
        return newMomentum
      })
    }, 30000)
    
    return () => clearInterval(decayInterval)
  }, [])

  const chartPeriod = useMemo(() => getChartPeriod(), [])

  return {
    tracks,
    agentsOnline,
    recentActivity,
    trendingTracks: getTrendingTracks(),
    topCharts: getTopCharts(),
    newReleases: getNewReleases(),
    weeklyMomentum,
    lastChartUpdate,
    chartPeriod,
  }
}

// Format agents online count
export function formatAgentsOnline(count: number): string {
  return `${(count / 1000).toFixed(1)}K`
}

// Format chart update time
export function formatChartUpdate(): string {
  const now = new Date()
  const dayOfWeek = now.getDay()
  const daysUntilSunday = (7 - dayOfWeek) % 7 || 7
  
  if (daysUntilSunday === 7) {
    return "Updates today"
  } else if (daysUntilSunday === 1) {
    return "Updates tomorrow"
  } else {
    return `Updates in ${daysUntilSunday} days`
  }
}


