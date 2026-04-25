"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useAuth } from "./auth-context"
import { supabase } from "@/lib/supabase"
import type { Track } from "./player-context"

interface FavoritesContextType {
  favorites: Track[]
  /** Live snapshot of the user's favorite-track-id set. Exposed so
   *  pages like /favorites can react to add/remove without resubscribing
   *  to the full `favorites` array (which only contains items the user
   *  has touched in-session, not the server-rendered list). */
  favoriteIds: ReadonlySet<string>
  isFavorite: (trackId: string) => boolean
  addFavorite: (track: Track) => void
  removeFavorite: (trackId: string) => void
  toggleFavorite: (track: Track) => void
}

const FavoritesContext = createContext<FavoritesContextType | null>(null)

/**
 * Tracks the current user's favorited tracks. Storage is the
 * `public.track_favorites` junction table (same one written by the
 * agent /api/tracks/:id/favorite endpoint and the user
 * /api/me/favorites endpoints — single source of truth).
 *
 * On auth, the provider fetches the user's favorite track IDs from
 * /api/me/favorites and intersects them with whatever Track objects
 * the user has handed it via addFavorite/toggleFavorite. We don't
 * fetch full Track objects on hydration because:
 *
 *   • Favorites are a private bookmark surface — the only consumer
 *     today is the toggle state of the favorite button + the visible
 *     `favorites` array on a future Library page. The current Library
 *     page builds its own track list by other means.
 *   • The user always has the Track in hand at the moment they
 *     toggle (it's in the modal, card, or player), so the in-memory
 *     `favorites` list will accumulate the right entries during the
 *     session without an extra round-trip on hydration.
 *
 * `isFavorite(id)` answers correctly whether or not the full Track
 * object has been loaded — it queries the hydrated ID set, not the
 * `favorites` array.
 *
 * Optimistic updates: add/remove/toggle update local state immediately
 * and roll back on API failure so buttons feel instant.
 */
export function FavoritesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id ?? null

  const [favorites, setFavorites] = useState<Track[]>([])
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => new Set())
  const userScopeRef = useRef<string | null>(null)

  // Hydrate on user change. Anonymous => empty.
  useEffect(() => {
    let cancelled = false

    async function hydrate() {
      // Reset whenever the active user changes so a previous user's
      // favorites can never leak into a new session's UI.
      setFavorites([])
      setFavoriteIds(new Set())
      userScopeRef.current = userId

      if (!userId) return

      try {
        const { data: sess } = await supabase.auth.getSession()
        const token = sess?.session?.access_token
        if (!token) return

        const res = await fetch("/api/me/favorites", {
          method: "GET",
          headers: { authorization: `Bearer ${token}` },
          cache: "no-store",
        })

        if (cancelled || userScopeRef.current !== userId) return
        if (!res.ok) {
          console.warn("[favorites] hydrate failed:", res.status)
          return
        }

        const json = (await res.json()) as { ids?: string[] }
        if (cancelled || userScopeRef.current !== userId) return
        setFavoriteIds(new Set(json.ids ?? []))
      } catch (e) {
        if (!cancelled) console.warn("[favorites] hydrate threw:", e)
      }
    }

    hydrate()
    return () => {
      cancelled = true
    }
  }, [userId])

  const isFavorite = useCallback(
    (trackId: string) => favoriteIds.has(trackId),
    [favoriteIds],
  )

  // Per-track op counter so that an out-of-order completion (rapid
  // double-toggle, slow network) can't roll back the user's latest
  // intent. Only the most-recent op for a track may apply rollback.
  const opCounterRef = useRef<Map<string, number>>(new Map())

  // Internal: persist to API. Returns true on success, false on failure.
  const persist = useCallback(
    async (trackId: string, action: "add" | "remove"): Promise<boolean> => {
      if (!userId) return false
      try {
        const { data: sess } = await supabase.auth.getSession()
        const token = sess?.session?.access_token
        if (!token) return false

        const res = await fetch(`/api/me/favorites/${encodeURIComponent(trackId)}`, {
          method: action === "add" ? "POST" : "DELETE",
          headers: { authorization: `Bearer ${token}` },
        })
        return res.ok
      } catch (e) {
        console.warn("[favorites] persist threw:", e)
        return false
      }
    },
    [userId],
  )

  const addFavorite = useCallback(
    (track: Track) => {
      if (!userId) return
      if (favoriteIds.has(track.id)) return
      const myOp = (opCounterRef.current.get(track.id) ?? 0) + 1
      opCounterRef.current.set(track.id, myOp)
      // Optimistic.
      setFavoriteIds((prev) => new Set(prev).add(track.id))
      setFavorites((prev) =>
        prev.some((t) => t.id === track.id) ? prev : [track, ...prev],
      )
      persist(track.id, "add").then((ok) => {
        // Stale completion guard — a newer op has taken over.
        if (opCounterRef.current.get(track.id) !== myOp) return
        if (!ok) {
          setFavoriteIds((prev) => {
            const next = new Set(prev)
            next.delete(track.id)
            return next
          })
          setFavorites((prev) => prev.filter((t) => t.id !== track.id))
        }
      })
    },
    [favoriteIds, persist, userId],
  )

  const removeFavorite = useCallback(
    (trackId: string) => {
      if (!userId) return
      if (!favoriteIds.has(trackId)) return
      const removedTrack = favorites.find((t) => t.id === trackId) ?? null
      const myOp = (opCounterRef.current.get(trackId) ?? 0) + 1
      opCounterRef.current.set(trackId, myOp)
      // Optimistic.
      setFavoriteIds((prev) => {
        const next = new Set(prev)
        next.delete(trackId)
        return next
      })
      setFavorites((prev) => prev.filter((t) => t.id !== trackId))
      persist(trackId, "remove").then((ok) => {
        if (opCounterRef.current.get(trackId) !== myOp) return
        if (!ok) {
          setFavoriteIds((prev) => new Set(prev).add(trackId))
          if (removedTrack) {
            setFavorites((prev) =>
              prev.some((t) => t.id === trackId) ? prev : [removedTrack, ...prev],
            )
          }
        }
      })
    },
    [favoriteIds, favorites, persist, userId],
  )

  const toggleFavorite = useCallback(
    (track: Track) => {
      if (favoriteIds.has(track.id)) removeFavorite(track.id)
      else addFavorite(track)
    },
    [favoriteIds, addFavorite, removeFavorite],
  )

  const value = useMemo(
    () => ({ favorites, favoriteIds, isFavorite, addFavorite, removeFavorite, toggleFavorite }),
    [favorites, favoriteIds, isFavorite, addFavorite, removeFavorite, toggleFavorite],
  )

  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>
}

export function useFavorites() {
  const ctx = useContext(FavoritesContext)
  if (!ctx) throw new Error("useFavorites must be used within FavoritesProvider")
  return ctx
}
