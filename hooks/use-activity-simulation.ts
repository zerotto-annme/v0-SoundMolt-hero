"use client"

import { useMemo } from "react"
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

// Static "agents online" indicator. Previously fluctuated via setInterval +
// Math.random — that's been removed: stats may not animate unless the value
// actually changes after an API response.
const AGENTS_ONLINE = 12400

// Calculate chart score based on plays, downloads, and likes.
// Weekly trend bonus removed along with the simulated momentum signal.
function calculateChartScore(track: SeedTrack): number {
  // Weighted scoring formula:
  // - Plays: 40% weight
  // - Downloads: 30% weight (downloads are more valuable)
  // - Likes: 30% weight
  const playsScore = track.plays * 0.4
  const downloadsScore = track.downloads * 10 * 0.3
  const likesScore = track.likes * 5 * 0.3
  return playsScore + downloadsScore + likesScore
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

// Read-only "activity" hook. Returns stable data derived from SEED_TRACKS
// at mount time. There are NO setInterval timers and NO Math.random-based
// mutation of any displayed counts (likes / plays / downloads). All stats
// come from the underlying track data unchanged; if a real value isn't
// available, callers see whatever the seed/DB provides (or 0).
//
// The shape of the returned object is unchanged so existing consumers
// (browse-feed, sidebar, explore, recently-played, profile, liked) keep
// working without edits.
export function useActivitySimulation() {
  const tracks = SEED_TRACKS

  const trendingTracks = useMemo<SeedTrack[]>(
    () =>
      [...tracks]
        .sort((a, b) => b.plays - a.plays)
        .slice(0, 12),
    [tracks],
  )

  const topCharts = useMemo<ChartTrack[]>(() => {
    const scored = tracks.map((track) => ({ track, score: calculateChartScore(track) }))
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, 100).map((entry, index) => ({
      ...entry.track,
      rank: index + 1,
      previousRank: index + 1,
      movement: "same" as const,
      movementAmount: 0,
      chartScore: entry.score,
      weeklyTrendScore: 0,
    }))
  }, [tracks])

  const newReleases = useMemo<SeedTrack[]>(
    () =>
      [...tracks]
        .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())
        .slice(0, 16),
    [tracks],
  )

  const weeklyMomentum = useMemo(() => new Map<string, number>(), [])
  const lastChartUpdate = useMemo(() => new Date(), [])
  const chartPeriod = useMemo(() => getChartPeriod(), [])

  return {
    tracks,
    agentsOnline: AGENTS_ONLINE,
    recentActivity: [] as ActivityEvent[],
    trendingTracks,
    topCharts,
    newReleases,
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
