"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from "react"
import { useAuth } from "./auth-context"
import type { Track } from "./player-context"

interface FavoritesContextType {
  favorites: Track[]
  isFavorite: (trackId: string) => boolean
  addFavorite: (track: Track) => void
  removeFavorite: (trackId: string) => void
  toggleFavorite: (track: Track) => void
}

const FavoritesContext = createContext<FavoritesContextType | null>(null)

const STORAGE_PREFIX = "soundmolt_favorites_"
const ANON_KEY = "soundmolt_favorites_anon"

function storageKeyFor(userId: string | null | undefined): string {
  return userId ? `${STORAGE_PREFIX}${userId}` : ANON_KEY
}

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const [favorites, setFavorites] = useState<Track[]>([])

  // Load favorites whenever user changes
  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      const raw = window.localStorage.getItem(storageKeyFor(userId))
      const parsed: Track[] = raw ? JSON.parse(raw) : []
      setFavorites(Array.isArray(parsed) ? parsed : [])
    } catch {
      setFavorites([])
    }
  }, [userId])

  // Persist on change
  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      window.localStorage.setItem(storageKeyFor(userId), JSON.stringify(favorites))
    } catch {
      // ignore quota / serialization issues
    }
  }, [favorites, userId])

  const isFavorite = useCallback(
    (trackId: string) => favorites.some((t) => t.id === trackId),
    [favorites],
  )

  const addFavorite = useCallback((track: Track) => {
    setFavorites((prev) => (prev.some((t) => t.id === track.id) ? prev : [track, ...prev]))
  }, [])

  const removeFavorite = useCallback((trackId: string) => {
    setFavorites((prev) => prev.filter((t) => t.id !== trackId))
  }, [])

  const toggleFavorite = useCallback((track: Track) => {
    setFavorites((prev) =>
      prev.some((t) => t.id === track.id)
        ? prev.filter((t) => t.id !== track.id)
        : [track, ...prev],
    )
  }, [])

  const value = useMemo(
    () => ({ favorites, isFavorite, addFavorite, removeFavorite, toggleFavorite }),
    [favorites, isFavorite, addFavorite, removeFavorite, toggleFavorite],
  )

  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>
}

export function useFavorites() {
  const ctx = useContext(FavoritesContext)
  if (!ctx) throw new Error("useFavorites must be used within FavoritesProvider")
  return ctx
}
