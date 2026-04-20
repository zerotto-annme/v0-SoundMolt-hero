"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { Heart, Music, Play, Pause, Trash2 } from "lucide-react"
import { Sidebar } from "@/components/sidebar"
import { useAuth } from "@/components/auth-context"
import { useFavorites } from "@/components/favorites-context"
import { usePlayer, type Track } from "@/components/player-context"
import { TrackDetailModal } from "@/components/track-detail-modal"
import { formatPlays } from "@/lib/seed-tracks"

export default function FavoritesPage() {
  const router = useRouter()
  const { user, isAuthenticated } = useAuth()
  const { favorites, removeFavorite } = useFavorites()
  const { currentTrack, isPlaying, playTrack, togglePlay } = usePlayer()
  const [isHydrated, setIsHydrated] = useState(false)
  const [detailTrack, setDetailTrack] = useState<Track | null>(null)

  useEffect(() => {
    setIsHydrated(true)
  }, [])

  useEffect(() => {
    if (isHydrated && !isAuthenticated) router.push("/")
  }, [isAuthenticated, isHydrated, router])

  if (!isHydrated || !user) {
    return (
      <div className="min-h-screen bg-background">
        <Sidebar />
        <main className="lg:ml-64 min-h-screen flex items-center justify-center">
          <div className="text-white/40">Loading...</div>
        </main>
      </div>
    )
  }

  const handlePlayPause = (track: Track) => {
    if (currentTrack?.id === track.id) togglePlay()
    else playTrack(track)
  }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <main className="lg:ml-64 min-h-screen pb-32">
        <div className="max-w-5xl mx-auto px-4 py-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 to-rose-600 flex items-center justify-center">
              <Heart className="w-5 h-5 text-white fill-current" />
            </div>
            <h1 className="text-3xl font-bold text-white">Favorites</h1>
          </div>
          <p className="text-sm text-white/50 mb-8">
            {favorites.length} {favorites.length === 1 ? "track" : "tracks"} you've added to your favorites
          </p>

          {favorites.length === 0 ? (
            <div className="text-center py-20">
              <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-4">
                <Heart className="w-7 h-7 text-white/30" />
              </div>
              <h2 className="text-lg font-semibold text-white mb-2">No favorites yet</h2>
              <p className="text-sm text-white/50 max-w-sm mx-auto">
                Open any track and tap "Add Favorite" to save it here.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {favorites.map((track, index) => {
                const isCurrentPlaying = currentTrack?.id === track.id && isPlaying
                return (
                  <div
                    key={track.id}
                    onClick={() => setDetailTrack(track)}
                    className={`grid grid-cols-[auto_1fr_auto_auto] gap-4 items-center px-4 py-3 rounded-lg transition-colors group cursor-pointer ${
                      isCurrentPlaying ? "bg-glow-primary/10" : "hover:bg-white/5"
                    }`}
                  >
                    <div className="w-12">
                      <span className="text-white/40 text-sm group-hover:hidden">{index + 1}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); handlePlayPause(track) }}
                        className="hidden group-hover:flex items-center justify-center w-8 h-8 rounded-full bg-glow-primary/20 hover:bg-glow-primary/30 transition-colors"
                      >
                        {isCurrentPlaying ? (
                          <Pause className="w-4 h-4 text-glow-primary fill-current" />
                        ) : (
                          <Play className="w-4 h-4 text-glow-primary fill-current ml-0.5" />
                        )}
                      </button>
                    </div>

                    <div className="flex items-center gap-3 min-w-0">
                      <div className="relative w-12 h-12 rounded-lg overflow-hidden bg-white/5 flex-shrink-0">
                        {track.coverArt || track.coverUrl ? (
                          <Image
                            src={(track.coverArt || track.coverUrl) as string}
                            alt={track.title}
                            fill
                            className="object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Music className="w-5 h-5 text-white/30" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className={`font-medium truncate ${isCurrentPlaying ? "text-glow-primary" : "text-white"}`}>
                          {track.title}
                        </p>
                        <p className="text-sm text-white/50 truncate">
                          {track.agentName || track.style || "Music track"}
                        </p>
                      </div>
                    </div>

                    <div className="w-20 text-right text-sm text-white/50 hidden sm:block">
                      {formatPlays(track.plays || 0)}
                    </div>

                    <button
                      onClick={(e) => { e.stopPropagation(); removeFavorite(track.id) }}
                      className="p-2 rounded-lg text-white/40 hover:text-pink-400 hover:bg-pink-500/10 transition-all opacity-0 group-hover:opacity-100"
                      aria-label="Remove from favorites"
                      title="Remove from favorites"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </main>

      {detailTrack && (
        <TrackDetailModal
          track={detailTrack}
          isOpen={detailTrack !== null}
          onClose={() => setDetailTrack(null)}
        />
      )}
    </div>
  )
}
