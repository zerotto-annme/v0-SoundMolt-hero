"use client"

import { useCallback, useState } from "react"
import { useAuth, generateAvatar, type UserProfile } from "@/components/auth-context"
import { supabase } from "@/lib/supabase"
import {
  ensureProfile,
  fetchProfile,
  updateProfile as svcUpdateProfile,
  withCacheBust,
  UsernameTakenError,
  type ProfileRow,
} from "@/lib/profile-service"

export { UsernameTakenError }

export type UseCurrentProfileResult = {
  // The currently signed-in user, or null. Same shape as auth-context.user.
  user: UserProfile | null
  // Alias for `user` — the spec calls it `profile` in some places.
  profile: UserProfile | null
  // True once Supabase has restored (or definitively cleared) the session.
  authReady: boolean
  // True once the public.profiles row has been loaded (or determined absent).
  // While false, the UI should render a skeleton — never show the email
  // prefix as a temporary username.
  profileReady: boolean
  // True while a refreshProfile() / updateProfile() call is in-flight.
  loading: boolean
  // Re-fetch the profile from the DB and push the result into global state.
  refreshProfile: () => Promise<void>
  // Save changes to the DB and update global state immediately. Throws
  // `UsernameTakenError` on 23505 — callers should catch and show a nice
  // message. The avatar URL in returned state is cache-busted with the
  // row's `updated_at` (or Date.now() if column is absent).
  updateProfile: (updates: { username?: string; avatar_url?: string | null }) => Promise<ProfileRow>
}

function applyRowToContext(
  row: ProfileRow,
  ctxUpdate: (u: Partial<UserProfile>) => void,
  fallbackEmail: string | null,
) {
  const username = row.username || fallbackEmail?.split("@")[0] || "User"
  const baseAvatar = row.avatar_url || generateAvatar(username, "human")
  const version = row.updated_at ?? Date.now()
  const avatar = withCacheBust(baseAvatar, version)
  ctxUpdate({
    username: row.username ?? undefined,
    name: username,
    avatar,
    avatarIsCustom: !!row.avatar_is_custom,
    artistName: row.artist_name ?? undefined,
  })
}

export function useCurrentProfile(): UseCurrentProfileResult {
  const ctx = useAuth()
  const [loading, setLoading] = useState(false)

  const refreshProfile = useCallback(async () => {
    setLoading(true)
    try {
      const { data: authData } = await supabase.auth.getUser()
      const sb = authData?.user
      if (!sb) return
      const row = await fetchProfile(sb.id)
      if (!row) return
      applyRowToContext(row, ctx.updateProfile, sb.email ?? null)
    } finally {
      setLoading(false)
    }
  }, [ctx])

  const updateProfile = useCallback(
    async (updates: { username?: string; avatar_url?: string | null }) => {
      setLoading(true)
      try {
        // Always source the user id from supabase.auth.getUser(), not local
        // context — covers the case where context is briefly stale after a
        // tab focus / token refresh.
        const { data: authData, error: authErr } = await supabase.auth.getUser()
        const sb = authData?.user
        if (!sb || authErr) {
          throw new Error("You must be signed in to save your profile.")
        }
        // Make sure a row exists before we try to update.
        await ensureProfile(sb)
        // Build DB-shaped updates — `avatar_is_custom` is auto-derived from
        // the presence of avatar_url.
        const dbUpdates: Record<string, unknown> = {}
        if (typeof updates.username === "string" && updates.username.trim()) {
          const trimmed = updates.username.trim()
          dbUpdates.username = trimmed
          dbUpdates.artist_name = trimmed
        }
        if (updates.avatar_url !== undefined) {
          dbUpdates.avatar_url = updates.avatar_url || null
          dbUpdates.avatar_is_custom = !!updates.avatar_url
        }
        const row = await svcUpdateProfile(sb, dbUpdates)
        applyRowToContext(row, ctx.updateProfile, sb.email ?? null)
        return row
      } finally {
        setLoading(false)
      }
    },
    [ctx],
  )

  return {
    user: ctx.user,
    profile: ctx.user,
    authReady: ctx.authReady,
    profileReady: ctx.profileReady,
    loading,
    refreshProfile,
    updateProfile,
  }
}
