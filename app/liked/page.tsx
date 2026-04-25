"use client"

import { useAuth } from "@/components/auth-context"
import { Sidebar } from "@/components/sidebar"
import { Heart } from "lucide-react"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import { BrowseTrackCard } from "@/components/browse-track-card"
import { useLikes } from "@/components/likes-context"
import { supabase } from "@/lib/supabase"
import type { Track } from "@/components/player-context"

/**
 * "Liked Tracks" page.
 *
 * Reads the current user's likes directly from the DB junction table
 * (public.track_likes joined to public.tracks) via /api/me/likes — no
 * mock data, no localStorage. The list is keyed off authVersion so
 * post-login it refetches without requiring a manual refresh, and it
 * also re-fetches whenever the in-memory LikesProvider's set of liked
 * IDs changes (so unlike-from-modal is reflected immediately).
 */
export default function LikedTracksPage() {
  const { isAuthenticated, authReady, authVersion, user } = useAuth()
  const { isLiked, likedIds } = useLikes()
  const router = useRouter()

  const [likedTracks, setLikedTracks] = useState<Track[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Monotonic fetch epoch. Each fetch captures its own epoch value;
  // when the response lands we drop it on the floor unless the epoch
  // is still current. Guards against (a) auth flipping mid-fetch
  // (would otherwise show the previous user's tracks under a new
  // session) and (b) overlapping refetches racing each other.
  const fetchEpochRef = useRef(0)
  // Snapshot of the liked-id set last reflected in `likedTracks`.
  // Used to detect when a NEW like appears while the page is open
  // (e.g. user likes a track from the modal), which requires a fresh
  // server fetch — prune-only logic can't synthesize the joined Track
  // payload for a brand-new entry.
  const lastIdsKeyRef = useRef<string>("")

  // Redirect to landing if not authenticated, but only AFTER the
  // initial Supabase session restore — otherwise a logged-in user
  // gets bounced on first paint.
  useEffect(() => {
    if (authReady && !isAuthenticated) {
      router.push("/")
    }
  }, [isAuthenticated, authReady, router])

  const fetchLiked = useCallback(async () => {
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
        setLikedTracks([])
        return
      }
      const res = await fetch("/api/me/likes", {
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      })
      if (myEpoch !== fetchEpochRef.current) return
      if (!res.ok) {
        const text = await res.text().catch(() => "")
        setError(`Failed to load liked tracks (${res.status})${text ? `: ${text}` : ""}`)
        setLikedTracks([])
        return
      }
      const json = (await res.json()) as { tracks?: Track[] }
      if (myEpoch !== fetchEpochRef.current) return
      const next = Array.isArray(json.tracks) ? json.tracks : []
      setLikedTracks(next)
      lastIdsKeyRef.current = next.map((t) => t.id).sort().join(",")
    } catch (e) {
      if (myEpoch !== fetchEpochRef.current) return
      setError(e instanceof Error ? e.message : "Failed to load liked tracks")
      setLikedTracks([])
    } finally {
      if (myEpoch === fetchEpochRef.current) setLoading(false)
    }
  }, [user?.id])

  // Fetch on user change / post-login. authVersion bumps on every
  // session-affecting auth event so we refetch promptly after sign-in.
  useEffect(() => {
    if (!authReady) return
    if (!user?.id) {
      // Sign-out: invalidate any in-flight fetch.
      fetchEpochRef.current++
      setLikedTracks([])
      lastIdsKeyRef.current = ""
      setLoading(false)
      return
    }
    fetchLiked()
  }, [authReady, authVersion, user?.id, fetchLiked])

  // React to LikesProvider changes:
  //   - if a currently-shown track is no longer liked → prune locally
  //     (no server roundtrip needed).
  //   - if a brand-new id appears in the provider set that we don't
  //     yet have a Track payload for → trigger a fresh server fetch
  //     so we can render the new card. (We need the joined Track row;
  //     the provider only knows the id.)
  useEffect(() => {
    if (!user?.id) return
    // Prune unliked rows in-place. Returning the same array reference
    // when nothing changed prevents an infinite re-render loop (this
    // effect depends on `likedTracks`).
    setLikedTracks((prev) => {
      const pruned = prev.filter((t) => isLiked(t.id))
      if (pruned.length === prev.length) return prev
      lastIdsKeyRef.current = pruned.map((t) => t.id).sort().join(",")
      return pruned
    })
    // Detect new likes (provider knows ids we don't render yet).
    let needsRefetch = false
    likedIds.forEach((id) => {
      if (!likedTracks.some((t) => t.id === id)) needsRefetch = true
    })
    if (needsRefetch) fetchLiked()
  }, [isLiked, likedIds, likedTracks, user?.id, fetchLiked])

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
              <h1 className="text-4xl font-bold text-white">Liked Tracks</h1>
              <p className="text-white/50 text-sm mt-2">
                {loading ? "Loading…" : `${likedTracks.length} tracks`}
              </p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="px-8 py-6">
          {loading ? (
            <div className="py-20 text-center text-white/40">Loading your liked tracks…</div>
          ) : error ? (
            <div className="py-20 text-center">
              <p className="text-white/60">{error}</p>
              <button
                onClick={fetchLiked}
                className="mt-4 px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white text-sm"
              >
                Try again
              </button>
            </div>
          ) : likedTracks.length > 0 ? (
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
