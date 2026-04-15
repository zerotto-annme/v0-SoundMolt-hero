"use client"

import { useEffect } from "react"
import { usePlayer } from "./player-context"
import { useAuth } from "./auth-context"
import { createClient } from "@/lib/supabase/client"

// This component tracks when tracks are played and saves to Supabase
export function RecentlyPlayedTracker() {
  const { registerTrackPlayCallback } = usePlayer()
  const { user } = useAuth()

  useEffect(() => {
    if (!user) return

    const supabase = createClient()

    const unregister = registerTrackPlayCallback(async (trackId: string) => {
      // Save to recently played in Supabase
      try {
        await supabase
          .from("recently_played")
          .insert({ user_id: user.id, track_id: trackId })
      } catch (e) {
        console.error("Failed to save recently played:", e)
      }
    })

    return unregister
  }, [user, registerTrackPlayCallback])

  return null
}
