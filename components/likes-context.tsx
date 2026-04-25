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

interface LikesContextType {
  /** Synchronous read: is this track currently liked by the logged-in user? */
  isLiked: (trackId: string) => boolean
  /**
   * Toggle like for the current user. Optimistic; rolls back on API failure.
   * Resolves to the track's new total like count from the junction table
   * (organic-only — does NOT include admin boost; the UI is responsible for
   * adding the boost delta when displaying total counts). Resolves to `null`
   * when the user is not logged in or the API call failed.
   */
  toggleLike: (trackId: string) => Promise<number | null>
  /** True once the initial hydration fetch for the current user has resolved. */
  hydrated: boolean
  /**
   * Live snapshot of the user's liked-track-id set. Exposed so views like
   * /liked can detect when a brand-new like has appeared (and trigger a
   * fresh server fetch to get the full Track payload). Read-only — mutate
   * via `toggleLike`.
   */
  likedIds: ReadonlySet<string>
}

const LikesContext = createContext<LikesContextType | null>(null)

/**
 * Tracks the current user's set of liked track IDs in memory so any
 * Like button anywhere in the app can render its toggled state
 * synchronously on first paint. Hydrated from /api/me/likes?ids_only=1
 * on auth and refreshed on user change.
 *
 * Mirrors the FavoritesProvider shape so consumers (TrackCard, modal,
 * etc.) follow a single pattern for both reactions.
 */
export function LikesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id ?? null

  const [likedIds, setLikedIds] = useState<Set<string>>(() => new Set())
  const [hydrated, setHydrated] = useState(false)
  // Tracks the "user-id this state was loaded for", so when auth flips
  // mid-flight we drop stale responses instead of clobbering fresh state.
  const loadedForRef = useRef<string | null>(null)

  // Hydrate on auth change. Anonymous users have no likes — we just
  // mark hydrated and clear state. This effect intentionally tolerates
  // the API being unreachable: the toggle path will surface the error.
  useEffect(() => {
    let cancelled = false

    async function hydrate() {
      if (!userId) {
        setLikedIds(new Set())
        loadedForRef.current = null
        setHydrated(true)
        return
      }

      setHydrated(false)
      try {
        const { data: sess } = await supabase.auth.getSession()
        const token = sess?.session?.access_token
        if (!token) {
          // Auth said we have a user but Supabase has no session token —
          // can happen during a transient logout race. Clear and bail.
          if (!cancelled) {
            setLikedIds(new Set())
            setHydrated(true)
          }
          return
        }

        const res = await fetch("/api/me/likes?ids_only=1", {
          method: "GET",
          headers: { authorization: `Bearer ${token}` },
          cache: "no-store",
        })

        if (cancelled) return
        if (!res.ok) {
          console.warn("[likes] hydrate failed:", res.status)
          setLikedIds(new Set())
          setHydrated(true)
          return
        }

        const json = (await res.json()) as { ids?: string[] }
        if (cancelled) return
        loadedForRef.current = userId
        setLikedIds(new Set(json.ids ?? []))
        setHydrated(true)
      } catch (e) {
        if (!cancelled) {
          console.warn("[likes] hydrate threw:", e)
          setLikedIds(new Set())
          setHydrated(true)
        }
      }
    }

    hydrate()
    return () => {
      cancelled = true
    }
  }, [userId])

  const isLiked = useCallback((trackId: string) => likedIds.has(trackId), [likedIds])

  // Per-track op counter. Each toggle bumps the counter for that trackId
  // and remembers its own version; only the most-recent op for a track is
  // allowed to apply rollback or commit a result. This prevents an
  // out-of-order completion (rapid double-toggle, network reorder) from
  // clobbering the user's latest intent. Kept in a ref so updating it
  // doesn't trigger re-renders.
  const opCounterRef = useRef<Map<string, number>>(new Map())

  const toggleLike = useCallback(
    async (trackId: string): Promise<number | null> => {
      if (!userId) return null

      const wasLiked = likedIds.has(trackId)
      const myOp = (opCounterRef.current.get(trackId) ?? 0) + 1
      opCounterRef.current.set(trackId, myOp)

      // Optimistic update.
      setLikedIds((prev) => {
        const next = new Set(prev)
        if (wasLiked) next.delete(trackId)
        else next.add(trackId)
        return next
      })

      try {
        const { data: sess } = await supabase.auth.getSession()
        const token = sess?.session?.access_token
        if (!token) throw new Error("No session token")

        console.log("[likes] toggle start", { trackId, wasLiked })

        const res = await fetch(`/api/me/likes/${encodeURIComponent(trackId)}`, {
          method: wasLiked ? "DELETE" : "POST",
          headers: { authorization: `Bearer ${token}` },
        })

        if (!res.ok) {
          // Pull the body so the actual PG error (constraint, FK, etc.)
          // shows up in the browser console instead of an opaque status.
          const body = await res.text().catch(() => "")
          throw new Error(`Like API ${res.status}: ${body}`)
        }

        const json = (await res.json()) as { total_likes?: number | null }
        console.log("[likes] toggle ok", { trackId, total_likes: json.total_likes })
        // Only the latest op for this track is allowed to report its
        // total back. A stale completion would otherwise return a count
        // that no longer matches the user's current state.
        if (opCounterRef.current.get(trackId) !== myOp) return null
        return typeof json.total_likes === "number" ? json.total_likes : null
      } catch (e) {
        // Rollback on failure — but only if this is still the latest op
        // for the track. Otherwise a newer toggle has already taken over
        // and our rollback would corrupt state.
        console.warn("[likes] toggle failed:", e)
        if (opCounterRef.current.get(trackId) === myOp) {
          setLikedIds((prev) => {
            const next = new Set(prev)
            if (wasLiked) next.add(trackId)
            else next.delete(trackId)
            return next
          })
        }
        return null
      }
    },
    [likedIds, userId]
  )

  const value = useMemo<LikesContextType>(
    () => ({ isLiked, toggleLike, hydrated, likedIds }),
    [isLiked, toggleLike, hydrated, likedIds]
  )

  return <LikesContext.Provider value={value}>{children}</LikesContext.Provider>
}

export function useLikes() {
  const ctx = useContext(LikesContext)
  if (!ctx) throw new Error("useLikes must be used within LikesProvider")
  return ctx
}
