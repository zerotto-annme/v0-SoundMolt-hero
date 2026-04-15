"use client"

import { useState, useEffect, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/components/auth-context"
import type { SeedTrack } from "@/lib/seed-tracks"

// Types for database records
export interface UserTrack {
  id: string
  user_id: string
  title: string
  agent_name: string
  agent_type: string | null
  agent_label: string | null
  model_type: string
  model_provider: string
  style: string
  cover_url: string | null
  duration: number
  prompt: string | null
  created_at: string
}

export interface LikedTrack {
  id: string
  user_id: string
  track_id: string
  created_at: string
}

export interface FollowedAgent {
  id: string
  user_id: string
  agent_name: string
  created_at: string
}

export interface RecentlyPlayed {
  id: string
  user_id: string
  track_id: string
  played_at: string
}

export function useUserTracks() {
  const { user } = useAuth()
  const [tracks, setTracks] = useState<UserTrack[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  const fetchTracks = useCallback(async () => {
    if (!user) {
      setTracks([])
      setLoading(false)
      return
    }

    setLoading(true)
    const { data, error } = await supabase
      .from("user_tracks")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })

    if (!error && data) {
      setTracks(data)
    }
    setLoading(false)
  }, [user, supabase])

  useEffect(() => {
    fetchTracks()
  }, [fetchTracks])

  const addTrack = async (track: Omit<UserTrack, "id" | "user_id" | "created_at">) => {
    if (!user) return null

    const { data, error } = await supabase
      .from("user_tracks")
      .insert({
        user_id: user.id,
        ...track,
      })
      .select()
      .single()

    if (!error && data) {
      setTracks((prev) => [data, ...prev])
      return data
    }
    return null
  }

  const deleteTrack = async (trackId: string) => {
    if (!user) return false

    const { error } = await supabase
      .from("user_tracks")
      .delete()
      .eq("id", trackId)
      .eq("user_id", user.id)

    if (!error) {
      setTracks((prev) => prev.filter((t) => t.id !== trackId))
      return true
    }
    return false
  }

  return { tracks, loading, addTrack, deleteTrack, refetch: fetchTracks }
}

export function useLikedTracks() {
  const { user } = useAuth()
  const [likedTrackIds, setLikedTrackIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  const fetchLiked = useCallback(async () => {
    if (!user) {
      setLikedTrackIds(new Set())
      setLoading(false)
      return
    }

    setLoading(true)
    const { data, error } = await supabase
      .from("liked_tracks")
      .select("track_id")
      .eq("user_id", user.id)

    if (!error && data) {
      setLikedTrackIds(new Set(data.map((d) => d.track_id)))
    }
    setLoading(false)
  }, [user, supabase])

  useEffect(() => {
    fetchLiked()
  }, [fetchLiked])

  const isLiked = useCallback((trackId: string) => likedTrackIds.has(trackId), [likedTrackIds])

  const toggleLike = async (trackId: string) => {
    if (!user) return false

    if (likedTrackIds.has(trackId)) {
      // Unlike
      const { error } = await supabase
        .from("liked_tracks")
        .delete()
        .eq("user_id", user.id)
        .eq("track_id", trackId)

      if (!error) {
        setLikedTrackIds((prev) => {
          const next = new Set(prev)
          next.delete(trackId)
          return next
        })
        return true
      }
    } else {
      // Like
      const { error } = await supabase
        .from("liked_tracks")
        .insert({ user_id: user.id, track_id: trackId })

      if (!error) {
        setLikedTrackIds((prev) => new Set(prev).add(trackId))
        return true
      }
    }
    return false
  }

  return { likedTrackIds, loading, isLiked, toggleLike, likeCount: likedTrackIds.size, refetch: fetchLiked }
}

export function useFollowedAgents() {
  const { user } = useAuth()
  const [followedAgents, setFollowedAgents] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  const fetchFollowed = useCallback(async () => {
    if (!user) {
      setFollowedAgents(new Set())
      setLoading(false)
      return
    }

    setLoading(true)
    const { data, error } = await supabase
      .from("followed_agents")
      .select("agent_name")
      .eq("user_id", user.id)

    if (!error && data) {
      setFollowedAgents(new Set(data.map((d) => d.agent_name)))
    }
    setLoading(false)
  }, [user, supabase])

  useEffect(() => {
    fetchFollowed()
  }, [fetchFollowed])

  const isFollowing = useCallback((agentName: string) => followedAgents.has(agentName), [followedAgents])

  const toggleFollow = async (agentName: string) => {
    if (!user) return false

    if (followedAgents.has(agentName)) {
      // Unfollow
      const { error } = await supabase
        .from("followed_agents")
        .delete()
        .eq("user_id", user.id)
        .eq("agent_name", agentName)

      if (!error) {
        setFollowedAgents((prev) => {
          const next = new Set(prev)
          next.delete(agentName)
          return next
        })
        return true
      }
    } else {
      // Follow
      const { error } = await supabase
        .from("followed_agents")
        .insert({ user_id: user.id, agent_name: agentName })

      if (!error) {
        setFollowedAgents((prev) => new Set(prev).add(agentName))
        return true
      }
    }
    return false
  }

  return { followedAgents, loading, isFollowing, toggleFollow, followCount: followedAgents.size, refetch: fetchFollowed }
}

export function useRecentlyPlayed() {
  const { user } = useAuth()
  const [recentTrackIds, setRecentTrackIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  const fetchRecent = useCallback(async () => {
    if (!user) {
      setRecentTrackIds([])
      setLoading(false)
      return
    }

    setLoading(true)
    const { data, error } = await supabase
      .from("recently_played")
      .select("track_id, played_at")
      .eq("user_id", user.id)
      .order("played_at", { ascending: false })
      .limit(50)

    if (!error && data) {
      // Remove duplicates, keep most recent
      const seen = new Set<string>()
      const unique = data.filter((d) => {
        if (seen.has(d.track_id)) return false
        seen.add(d.track_id)
        return true
      })
      setRecentTrackIds(unique.map((d) => d.track_id))
    }
    setLoading(false)
  }, [user, supabase])

  useEffect(() => {
    fetchRecent()
  }, [fetchRecent])

  const addRecentlyPlayed = async (trackId: string) => {
    if (!user) return false

    const { error } = await supabase
      .from("recently_played")
      .insert({ user_id: user.id, track_id: trackId })

    if (!error) {
      setRecentTrackIds((prev) => {
        // Move to front, remove duplicate
        const filtered = prev.filter((id) => id !== trackId)
        return [trackId, ...filtered].slice(0, 50)
      })
      return true
    }
    return false
  }

  return { recentTrackIds, loading, addRecentlyPlayed, refetch: fetchRecent }
}

// Combined hook for library page
export function useLibraryData() {
  const userTracks = useUserTracks()
  const likedTracks = useLikedTracks()
  const followedAgents = useFollowedAgents()
  const recentlyPlayed = useRecentlyPlayed()

  const loading = userTracks.loading || likedTracks.loading || followedAgents.loading || recentlyPlayed.loading

  return {
    userTracks,
    likedTracks,
    followedAgents,
    recentlyPlayed,
    loading,
  }
}
