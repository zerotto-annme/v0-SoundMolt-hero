"use client"

import { useAuth } from "@/components/auth-context"
import { Sidebar } from "@/components/sidebar"
import { Heart } from "lucide-react"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import { BrowseTrackCard } from "@/components/browse-track-card"
import { useFavorites } from "@/components/favorites-context"
import { supabase } from "@/lib/supabase"
import type { Track } from "@/components/player-context"

/**
 * "My Favorites" page.
 *
 * Reads the current user's favorites directly from the DB junction
 * table (public.track_favorites joined to public.tracks) via
 * /api/me/favorites?full=1 — no mock data, no localStorage. Mirrors the
 * /liked page architecture so behavior is consistent: fetch on auth
 * change, prune locally when the FavoritesProvider's id set drops a
 * track, refetch when a brand-new favorite appears that we don't have
 * a Track payload for yet, and an epoch guard against late responses.
 */
export default function FavoritesPage() {
  const { isAuthenticated, authReady, authVersion, user } = useAuth()
  const { isFavorite, favoriteIds } = useFavorites()
  const router = useRouter()

  const [favoriteTracks, setFavoriteTracks] = useState<Track[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchEpochRef = useRef(0)
  const lastIdsKeyRef = useRef<string>("")

  useEffect(() => {
    if (authReady && !isAuthenticated) {
      router.push("/")
    }
  }, [isAuthenticated, authReady, router])

  const fetchFavorites = useCallback(async () => {
    if (!user?.id) return
    const myEpoch = ++fetchEpochRef.current
    setLoading(true)
    setError(null)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess?.session?.access_token
      if (myEpoch !== fetchEpochRef.current) return
      if (!token) {
        setError("Not signed in")
        setFavoriteTracks([])
        return
      }
      const res = await fetch("/api/me/favorites?full=1", {
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      })
      if (myEpoch !== fetchEpochRef.current) return
      if (!res.ok) {
        const text = await res.text().catch(() => "")
        console.warn("[/favorites] fetch failed", { status: res.status, body: text })
        setError(`Failed to load favorites (${res.status})${text ? `: ${text}` : ""}`)
        setFavoriteTracks([])
        return
      }
      const json = (await res.json()) as { tracks?: Track[] }
      if (myEpoch !== fetchEpochRef.current) return
      const next = Array.isArray(json.tracks) ? json.tracks : []
      console.log("[/favorites] fetch ok", { count: next.length })
      setFavoriteTracks(next)
      lastIdsKeyRef.current = next.map((t) => t.id).sort().join(",")
    } catch (e) {
      if (myEpoch !== fetchEpochRef.current) return
      console.warn("[/favorites] fetch threw", e)
      setError(e instanceof Error ? e.message : "Failed to load favorites")
      setFavoriteTracks([])
    } finally {
      if (myEpoch === fetchEpochRef.current) setLoading(false)
    }
  }, [user?.id])

  useEffect(() => {
    if (!authReady) return
    if (!user?.id) {
      fetchEpochRef.current++
      setFavoriteTracks([])
      lastIdsKeyRef.current = ""
      setLoading(false)
      return
    }
    fetchFavorites()
  }, [authReady, authVersion, user?.id, fetchFavorites])

  // React to FavoritesProvider changes: prune unfavorited rows in
  // place; refetch when a brand-new id appears.
  useEffect(() => {
    if (!user?.id) return
    setFavoriteTracks((prev) => {
      const pruned = prev.filter((t) => isFavorite(t.id))
      if (pruned.length === prev.length) return prev
      lastIdsKeyRef.current = pruned.map((t) => t.id).sort().join(",")
      return pruned
    })
    let needsRefetch = false
    favoriteIds.forEach((id) => {
      if (!favoriteTracks.some((t) => t.id === id)) needsRefetch = true
    })
    if (needsRefetch) fetchFavorites()
  }, [isFavorite, favoriteIds, favoriteTracks, user?.id, fetchFavorites])

  if (!authReady) {
    return (
      <div className="min-h-screen bg-background">
        <Sidebar />
        <main className="lg:ml-64 min-h-screen flex items-center justify-center">
          <div className="text-white/40">Loading...</div>
        </main>
      </div>
    )
  }

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
              <h1 className="text-4xl font-bold text-white">My Favorites</h1>
              <p className="text-white/50 text-sm mt-2">
                {loading ? "Loading…" : `${favoriteTracks.length} tracks`}
              </p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="px-8 py-6">
          {loading ? (
            <div className="py-20 text-center text-white/40">Loading your favorites…</div>
          ) : error ? (
            <div className="py-20 text-center">
              <p className="text-white/60">{error}</p>
              <button
                onClick={fetchFavorites}
                className="mt-4 px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white text-sm"
              >
                Try again
              </button>
            </div>
          ) : favoriteTracks.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {favoriteTracks.map((track) => (
                <BrowseTrackCard key={track.id} track={track} />
              ))}
            </div>
          ) : (
            <div className="py-20 text-center">
              <Heart className="w-16 h-16 text-white/10 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-white mb-2">No favorites yet</h2>
              <p className="text-white/40 max-w-md mx-auto">
                Tap the favorite button on any track to save it here for quick access.
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
