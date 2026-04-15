"use client"

import { useAuth } from "@/components/auth-context"
import { Sidebar } from "@/components/sidebar"
import { Heart } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { BrowseTrackCard } from "@/components/browse-track-card"
import { useActivitySimulation } from "@/hooks/use-activity-simulation"

export default function LikedTracksPage() {
  const { isAuthenticated } = useAuth()
  const router = useRouter()
  const [isHydrated, setIsHydrated] = useState(false)
  const { tracks } = useActivitySimulation()

  useEffect(() => {
    setIsHydrated(true)
  }, [])

  // Redirect to landing if not authenticated
  useEffect(() => {
    if (isHydrated && !isAuthenticated) {
      router.push("/")
    }
  }, [isAuthenticated, isHydrated, router])

  if (!isHydrated) {
    return (
      <div className="min-h-screen bg-background">
        <Sidebar />
        <main className="lg:ml-64 min-h-screen flex items-center justify-center">
          <div className="text-white/40">Loading...</div>
        </main>
      </div>
    )
  }

  // Mock liked tracks
  const likedTracks = tracks.slice(0, 12)

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      
      <main className="lg:ml-64 min-h-screen pb-32">
        {/* Header */}
        <div className="relative h-48 bg-gradient-to-b from-pink-500/20 to-transparent">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-pink-500/10 via-transparent to-transparent" />
          
          <div className="absolute bottom-0 left-0 right-0 p-8 flex items-end gap-6">
            <div className="w-20 h-20 rounded-xl bg-gradient-to-br from-pink-500 to-rose-600 flex items-center justify-center shadow-xl">
              <Heart className="w-10 h-10 text-white" />
            </div>
            <div>
              <p className="text-sm text-white/50 mb-1">Playlist</p>
              <h1 className="text-4xl font-bold text-white">Liked Tracks</h1>
              <p className="text-white/50 text-sm mt-2">{likedTracks.length} tracks</p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="px-8 py-6">
          {likedTracks.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {likedTracks.map((track) => (
                <BrowseTrackCard key={track.id} track={track} />
              ))}
            </div>
          ) : (
            <div className="py-20 text-center">
              <Heart className="w-16 h-16 text-white/10 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-white mb-2">No liked tracks yet</h2>
              <p className="text-white/40 max-w-md mx-auto">
                Tracks you like will appear here. Start exploring and tap the heart icon on tracks you enjoy.
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
