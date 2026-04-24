"use client"

import { useAuth, generateAvatar } from "@/components/auth-context"
import { Sidebar } from "@/components/sidebar"
import { 
  Bot, User, Music, Heart, Clock, Play, Disc, Shield, Settings, 
  Copy, RefreshCw, Plug, Key, CheckCircle, X, Upload, TrendingUp,
  Zap, Activity, Pencil, Camera
} from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { BrowseTrackCard } from "@/components/browse-track-card"
import { useActivitySimulation } from "@/hooks/use-activity-simulation"
import { Button } from "@/components/ui/button"
import { usePlayer } from "@/components/player-context"
import { supabase } from "@/lib/supabase"
import { AvatarCropModal, type CropState } from "@/components/avatar-crop-modal"
import { isNetworkUploadError, getUploadErrorMessage, uploadWithRetry } from "@/lib/upload-with-retry"
import { ErrorBoundary } from "@/components/error-boundary"

// Agent status types
type AgentStatus = "online" | "generating" | "idle"

// Capability types
const CAPABILITIES = [
  { id: "generate", label: "generate", color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
  { id: "publish", label: "publish", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  { id: "discuss", label: "discuss", color: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
  { id: "read", label: "read", color: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
]

// Generate mock API key
function generateAPIKey(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  let key = "sm_live_"
  for (let i = 0; i < 32; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return key
}

export default function ProfilePage() {
  const { user, isAuthenticated, authReady, authVersion, updateProfile } = useAuth()
  const router = useRouter()
  // Local "client mounted" flag — separate from auth readiness. Used only
  // for client-only side effects (e.g. generating an API key on mount).
  // All auth-dependent gating uses `authReady` from the auth context so we
  // wait for Supabase to actually restore the session before redirecting
  // or rendering the empty state.
  const [isHydrated, setIsHydrated] = useState(false)
  const { tracks } = useActivitySimulation()
  const { createdTracks } = usePlayer()
  
  // Agent-specific state
  const [agentStatus, setAgentStatus] = useState<AgentStatus>("online")
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [apiKey, setApiKey] = useState("")
  const [showApiKey, setShowApiKey] = useState(false)
  const [apiKeyCopied, setApiKeyCopied] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<"connected" | "disconnected">("connected")
  
  // Settings form state
  const [settingsForm, setSettingsForm] = useState({
    artistName: "",
    provider: "",
    endpoint: "",
  })

  // Human profile edit state
  const [isEditProfileOpen, setIsEditProfileOpen] = useState(false)
  const [editProfileForm, setEditProfileForm] = useState({ username: "", avatarUrl: "" })
  const [editProfileErrors, setEditProfileErrors] = useState<{ username?: string; avatarUrl?: string; general?: string }>({})
  const [editProfileLoading, setEditProfileLoading] = useState(false)
  const [isRetryingUpload, setIsRetryingUpload] = useState(false)
  const [editProfileSuccess, setEditProfileSuccess] = useState(false)
  const [editProfileMetaWarning, setEditProfileMetaWarning] = useState<string | null>(null)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const [cropSrc, setCropSrc] = useState<string | null>(null)
  const savedCropRef = useRef<CropState | undefined>(undefined)
  const pendingFileKeyRef = useRef<string | undefined>(undefined)
  const [usernameCheckStatus, setUsernameCheckStatus] = useState<"idle" | "checking" | "available" | "taken" | "rate_limited" | "error">("idle")
  const usernameDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [playsToday] = useState(() => Math.floor(Math.random() * 500 + 100))
  const [likesToday] = useState(() => Math.floor(Math.random() * 100 + 20))
  const [removePhotoLoading, setRemovePhotoLoading] = useState(false)
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false)

  useEffect(() => {
    setIsHydrated(true)
    // Generate API key on mount
    setApiKey(generateAPIKey())
  }, [])

  // Reset avatar failure flag whenever the URL changes so a new avatar gets a fresh chance to load
  useEffect(() => {
    setAvatarLoadFailed(false)
  }, [user?.avatar])

  // Log auth user object once hydrated
  useEffect(() => {
    if (!isHydrated) return
    console.log("[profile] auth user:", user
      ? {
          id: user.id,
          role: user.role,
          name: user.name,
          username: user.username,
          email: user.email,
          avatar: user.avatar,
          avatarIsCustom: user.avatarIsCustom,
          agentIdentifier: user.agentIdentifier,
          modelProvider: user.modelProvider,
          agentEndpoint: user.agentEndpoint,
          createdAt: user.createdAt,
        }
      : null)
  }, [isHydrated, user])

  // Fetch and log the raw Supabase profile row for this user. Re-runs on
  // every authVersion bump so post-login the latest profile data lands
  // without a manual refresh.
  useEffect(() => {
    if (!authReady || !user?.id || user.role !== "human") return
    const fetchAndLogProfile = async () => {
      console.log("[profile] refetch started", { userId: user.id, authVersion })
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", user.id)
          .maybeSingle()
        if (error) {
          console.error("[profile] fetched profile error:", error.message, error)
        } else {
          console.log("[profile] refetch result", { userId: user.id, hasRow: !!data })
        }
      } catch (err) {
        console.error("[profile] fetched profile unexpected error:", err instanceof Error ? err.stack : err)
      }
    }
    fetchAndLogProfile()
  }, [authReady, authVersion, user?.id, user?.role])

  useEffect(() => {
    if (user) {
      setSettingsForm({
        artistName: user.artistName || user.name || "",
        provider: user.modelProvider || "",
        endpoint: user.agentEndpoint || "",
      })
    }
  }, [user])

  // Debounced username availability check for the edit profile form
  useEffect(() => {
    if (!isEditProfileOpen) return
    const trimmed = editProfileForm.username.trim()
    const currentUsername = user?.username || user?.name || ""

    if (!trimmed || trimmed === currentUsername) {
      setUsernameCheckStatus("idle")
      if (usernameDebounceRef.current) clearTimeout(usernameDebounceRef.current)
      return
    }

    const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/
    if (trimmed.length < 3 || trimmed.length > 30 || !USERNAME_REGEX.test(trimmed)) {
      setUsernameCheckStatus("idle")
      if (usernameDebounceRef.current) clearTimeout(usernameDebounceRef.current)
      return
    }

    setUsernameCheckStatus("checking")
    if (usernameDebounceRef.current) clearTimeout(usernameDebounceRef.current)

    let cancelled = false
    usernameDebounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/username-available?username=${encodeURIComponent(trimmed)}`)
        if (cancelled) return
        if (res.status === 429) { setUsernameCheckStatus("rate_limited"); return }
        if (!res.ok) { setUsernameCheckStatus("error"); return }
        const json = await res.json()
        setUsernameCheckStatus(json.available === true ? "available" : "taken")
      } catch {
        if (!cancelled) setUsernameCheckStatus("error")
      }
    }, 500)

    return () => {
      cancelled = true
      if (usernameDebounceRef.current) clearTimeout(usernameDebounceRef.current)
    }
  }, [editProfileForm.username, isEditProfileOpen, user])

  // Redirect to landing if not authenticated — but only AFTER auth has
  // actually finished restoring. Using the local `isHydrated` here would
  // fire on the next tick after mount, before Supabase has restored the
  // session, and bounce a logged-in user back to the landing page.
  useEffect(() => {
    if (authReady && !isAuthenticated) {
      router.push("/")
    }
  }, [isAuthenticated, authReady, router])

  if (!authReady || !user) {
    return (
      <div className="min-h-screen bg-background">
        <Sidebar />
        <main className="lg:ml-64 min-h-screen flex items-center justify-center">
          <div className="text-white/40">Loading...</div>
        </main>
      </div>
    )
  }

  const isAgent = user.role === "agent"

  // Mock data for demonstration — guard arrays against undefined at call time
  const safeTracks = tracks ?? []
  const safeCreatedTracks = createdTracks ?? []
  const likedTracks = safeTracks.slice(0, 4)
  const recentlyPlayed = safeTracks.slice(4, 8)

  // Get top track from created tracks
  const topTrack = safeCreatedTracks.length > 0
    ? safeCreatedTracks.reduce((max, track) => (track.plays ?? 0) > (max.plays ?? 0) ? track : max, safeCreatedTracks[0])
    : null

  const handleCopyApiKey = () => {
    navigator.clipboard.writeText(apiKey)
    setApiKeyCopied(true)
    setTimeout(() => setApiKeyCopied(false), 2000)
  }

  const handleRegenerateApiKey = () => {
    setApiKey(generateAPIKey())
    setShowApiKey(true)
  }

  const handleTestConnection = () => {
    setConnectionStatus("disconnected")
    setTimeout(() => setConnectionStatus("connected"), 1500)
  }

  const handleSaveSettings = () => {
    updateProfile({
      artistName: settingsForm.artistName,
      name: settingsForm.artistName,
      modelProvider: settingsForm.provider,
      agentEndpoint: settingsForm.endpoint,
    })
    setIsSettingsOpen(false)
  }

  const handleOpenEditProfile = () => {
    setEditProfileForm({
      username: user?.username || user?.name || "",
      avatarUrl: user?.avatar || "",
    })
    setEditProfileErrors({})
    setEditProfileSuccess(false)
    setEditProfileMetaWarning(null)
    setUsernameCheckStatus("idle")
    setAvatarFile(null)
    savedCropRef.current = undefined
    pendingFileKeyRef.current = undefined
    setCropSrc(prev => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    setAvatarPreview(prev => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    setIsEditProfileOpen(true)
  }

  const handleCloseEditProfile = () => {
    setCropSrc(prev => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    setAvatarPreview(prev => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    setAvatarFile(null)
    setEditProfileMetaWarning(null)
    setIsEditProfileOpen(false)
  }

  const handleAvatarFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    if (!file.type.startsWith("image/")) {
      setAvatarFile(null)
      setAvatarPreview(prev => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
      setEditProfileErrors(prev => ({ ...prev, avatarUrl: "Please select an image file." }))
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setAvatarFile(null)
      setAvatarPreview(prev => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
      setEditProfileErrors(prev => ({ ...prev, avatarUrl: "Image must be smaller than 5 MB." }))
      return
    }
    setEditProfileErrors(prev => ({ ...prev, avatarUrl: undefined }))
    savedCropRef.current = undefined
    pendingFileKeyRef.current = `file:${file.name}:${file.size}:${file.lastModified}`
    const objectUrl = URL.createObjectURL(file)
    setCropSrc(objectUrl)
  }

  const handleCropConfirm = (croppedBlob: Blob) => {
    if (cropSrc) URL.revokeObjectURL(cropSrc)
    setCropSrc(null)
    pendingFileKeyRef.current = undefined
    const croppedFile = new File([croppedBlob], "avatar.jpg", { type: "image/jpeg" })
    setAvatarFile(croppedFile)
    setAvatarPreview(prev => {
      if (prev) URL.revokeObjectURL(prev)
      return URL.createObjectURL(croppedBlob)
    })
  }

  const handleCropCancel = () => {
    if (cropSrc) URL.revokeObjectURL(cropSrc)
    setCropSrc(null)
  }

  const handleRemovePhoto = async () => {
    if (!user) return
    setRemovePhotoLoading(true)
    setEditProfileErrors({})
    try {
      const { data: { user: sbUser } } = await supabase.auth.getUser()
      // Read the OAuth provider's original avatar from identity_data, which is
      // populated by the OAuth flow and is never overwritten by updateUser calls.
      // user_metadata.avatar_url is not reliable here because handleSaveProfile
      // overwrites it with the custom avatar URL during upload.
      const identityAvatar = sbUser?.identities?.find(i => i.identity_data?.avatar_url)?.identity_data?.avatar_url ?? null
      const oauthAvatar: string | null = identityAvatar

      const { data: removeData, error: profileError } = await supabase
        .from("profiles")
        .update({ avatar_url: oauthAvatar, avatar_is_custom: false })
        .eq("id", user.id)
        .select()

      if (profileError) {
        console.error("[profile] handleRemovePhoto update error:", profileError)
        setEditProfileErrors({ general: "Failed to remove photo. Please try again." })
        return
      }
      if (!removeData || removeData.length === 0) {
        console.error("[profile] handleRemovePhoto returned 0 rows", { userId: user.id })
        setEditProfileErrors({ general: "Could not find your profile. Please sign out and back in." })
        return
      }

      const { error: metaError } = await supabase.auth.updateUser({
        data: { avatar_url: oauthAvatar },
      })

      // For display, use the OAuth avatar if available, or fall back to a generated one.
      // Do NOT use persist: true here — the DB was already updated explicitly above.
      // persist: true would write the generated URL to profiles.avatar_url, overwriting
      // the null we just stored (violating the "clear if none exists" requirement).
      const newAvatar = oauthAvatar || generateAvatar(user.username || user.name || "User", "human")
      updateProfile({ avatar: newAvatar, avatarIsCustom: false })

      if (metaError) {
        setEditProfileErrors({ general: "Photo removed but session metadata could not be updated. Changes will appear after your next sign-in." })
        return
      }

      setAvatarFile(null)
      setAvatarPreview(prev => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
      setEditProfileForm(prev => ({ ...prev, avatarUrl: oauthAvatar || "" }))
    } catch (err) {
      console.error("[profile] handleRemovePhoto unexpected error:", err instanceof Error ? err.stack : err)
      setEditProfileErrors({ general: "Something went wrong. Please try again." })
    } finally {
      setRemovePhotoLoading(false)
    }
  }

  const handleSaveProfile = async () => {
    setEditProfileErrors({})
    setEditProfileSuccess(false)
    setEditProfileMetaWarning(null)

    const trimmedUsername = editProfileForm.username.trim()
    if (!trimmedUsername) {
      setEditProfileErrors({ username: "Username is required" })
      return
    }

    if (trimmedUsername.length < 3 || trimmedUsername.length > 30) {
      setEditProfileErrors({ username: "Username must be between 3 and 30 characters." })
      return
    }

    const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/
    if (!USERNAME_REGEX.test(trimmedUsername)) {
      setEditProfileErrors({ username: "Username can only contain letters, numbers, and underscores." })
      return
    }

    if (usernameCheckStatus === "taken") {
      setEditProfileErrors({ username: "That username is already taken. Please choose a different one." })
      return
    }

    if (usernameCheckStatus === "checking") {
      return
    }

    setEditProfileLoading(true)
    try {
      // Always source the user id from supabase.auth.getUser(), not local state.
      const { data: authData, error: authErr } = await supabase.auth.getUser()
      const authUser = authData?.user
      console.log("[profile] auth.getUser →", { id: authUser?.id, email: authUser?.email, error: authErr?.message })

      const userId = authUser?.id ?? ""
      if (!userId) {
        console.error("[profile] handleSaveProfile aborted — no auth user")
        setEditProfileErrors({ general: "You must be signed in to save your profile." })
        return
      }

      // Ensure a profile row exists for this user. Insert defaults if missing.
      const { data: existingProfile, error: existingErr } = await supabase
        .from("profiles")
        .select("id, username, artist_name, avatar_url, avatar_is_custom")
        .eq("id", userId)
        .maybeSingle()
      console.log("[profile] existing profile lookup:", { found: !!existingProfile, error: existingErr?.message, data: existingProfile })

      if (!existingProfile) {
        const fallbackUsername = (authUser.email?.split("@")[0] || "user").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 30) || "user"
        const insertPayload = {
          id: userId,
          role: "human",
          username: fallbackUsername,
          artist_name: fallbackUsername,
        }
        console.log("[profile] inserting missing profile row:", insertPayload)
        const { error: insertErr } = await supabase.from("profiles").insert(insertPayload)
        if (insertErr && insertErr.code !== "23505") {
          console.error("[profile] insert missing profile failed:", insertErr)
          setEditProfileErrors({ general: "Could not initialize your profile. Please try again." })
          return
        }
      }

      let trimmedAvatarUrl = (editProfileForm.avatarUrl ?? "").trim()
      let avatarStorageWritten = false

      if (avatarFile) {
        const safeName = (avatarFile.name ?? "avatar").replace(/[^a-zA-Z0-9._-]/g, "_")
        const path = `${userId}/${Date.now()}-${safeName}`

        console.log("[profile] selected file:", {
          name: avatarFile.name,
          type: avatarFile.type,
          sizeBytes: avatarFile.size,
        })
        console.log("[profile] Uploading avatar:", { bucket: "avatars", path, userId })

        const uploadResult = await uploadWithRetry(
          () => supabase.storage.from("avatars").upload(path, avatarFile, { upsert: true, contentType: avatarFile.type }),
          "Avatar upload",
          { onRetry: () => setIsRetryingUpload(true), onRetryDone: () => setIsRetryingUpload(false) }
        )

        console.log("[profile] upload result:", {
          ok: !uploadResult.error,
          path,
          error: uploadResult.error?.message,
        })

        const uploadError = uploadResult.error
        if (uploadError) {
          console.error("[profile] Storage upload error (full):", uploadError)
          setEditProfileErrors({
            general: getUploadErrorMessage(uploadError as { message: string; statusCode?: string | number }),
          })
          return
        }
        avatarStorageWritten = true

        const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path)
        trimmedAvatarUrl = urlData.publicUrl
        console.log("[profile] public URL:", trimmedAvatarUrl)
      }

      // Update the existing profile row (auto-created on signup by trigger).
      // Use UPDATE, not upsert, to avoid INSERT-on-conflict RLS edge cases.
      const updatePayload: Record<string, unknown> = {
        username: trimmedUsername,
      }
      if (avatarStorageWritten) {
        updatePayload.avatar_url = trimmedAvatarUrl
        updatePayload.avatar_is_custom = true
      } else {
        // No file uploaded — only write avatar_url if user actually changed it.
        // Strip the cache-buster (?t=...) we may have appended previously, but
        // preserve other legitimate query params (e.g. Dicebear ?seed=...).
        const stripCacheBust = (u: string) => u.replace(/([?&])t=\d+(&|$)/, (_m, p1, p2) => (p2 === "&" ? p1 : ""))
          .replace(/[?&]$/, "")
        const currentAvatar = stripCacheBust((user?.avatar ?? "").trim())
        const newAvatar = stripCacheBust(trimmedAvatarUrl)
        if (newAvatar !== currentAvatar) {
          updatePayload.avatar_url = trimmedAvatarUrl || null
          updatePayload.avatar_is_custom = !!trimmedAvatarUrl
        }
      }

      console.log("[profile] profiles UPDATE payload:", { userId, updatePayload })

      const { data: updateData, error: profileError } = await supabase
        .from("profiles")
        .update(updatePayload)
        .eq("id", userId)
        .select()

      console.log("[profile] profiles UPDATE result:", {
        ok: !profileError,
        rowsReturned: updateData?.length ?? 0,
        error: profileError?.message,
      })

      if (profileError) {
        console.error("[profile] Profile update error (full):", profileError)
        setEditProfileErrors({ general: "Failed to save profile. Please try again." })
        return
      }

      if (!updateData || updateData.length === 0) {
        console.error("[profile] Profile UPDATE returned 0 rows — row missing or RLS hid it", { userId })
        setEditProfileErrors({ general: "Could not find your profile to update. Please sign out and back in." })
        return
      }

      const { error: metaError } = await supabase.auth.updateUser({
        data: {
          username: trimmedUsername,
          avatar_url: trimmedAvatarUrl || null,
        },
      })

      // Cache-bust the displayed URL so <img> reloads even if the path is reused.
      const baseAvatar = trimmedAvatarUrl || generateAvatar(trimmedUsername, "human")
      const displayedAvatar = avatarStorageWritten || updatePayload.avatar_url !== undefined
        ? `${baseAvatar}${baseAvatar.includes("?") ? "&" : "?"}t=${Date.now()}`
        : baseAvatar

      console.log("[profile] final avatar URL shown in UI:", displayedAvatar)

      // Update local state only — DB was already written above; no persist needed.
      const localUpdate: Record<string, unknown> = {
        username: trimmedUsername,
        name: trimmedUsername,
        avatar: displayedAvatar,
      }
      if (avatarStorageWritten) {
        localUpdate.avatarIsCustom = true
      } else if (updatePayload.avatar_is_custom !== undefined) {
        localUpdate.avatarIsCustom = updatePayload.avatar_is_custom as boolean
      }
      updateProfile(localUpdate as Partial<typeof user>)

      if (metaError) {
        console.warn("[profile] Auth metadata update failed (non-critical):", metaError.message)
        setEditProfileMetaWarning("Profile saved. Session metadata could not be refreshed — your changes will appear fully after your next sign-in.")
      }

      // Clear file/preview so the modal reflects the saved state.
      setAvatarFile(null)
      setAvatarPreview(prev => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
      setEditProfileForm(prev => ({ ...prev, avatarUrl: trimmedAvatarUrl }))

      setEditProfileSuccess(true)
      setTimeout(() => {
        handleCloseEditProfile()
        setEditProfileSuccess(false)
      }, 1200)
    } catch (err) {
      console.error("[profile] handleSaveProfile unexpected error:", err instanceof Error ? err.stack : err)
      setEditProfileErrors({ general: "Something went wrong. Please try again." })
    } finally {
      setEditProfileLoading(false)
    }
  }

  // Render trace — identify which section throws
  console.log("[profile/render] user:", { id: user?.id, role: user?.role, name: user?.name, isAgent })
  console.log("[profile/render] tracks:", safeTracks.length, "liked:", likedTracks.length, "recent:", recentlyPlayed.length, "created:", safeCreatedTracks.length)
  console.log("[profile/render] agentStatus:", agentStatus, "connectionStatus:", connectionStatus)

  // Helper: logs a section start and renders nothing — use as first child of each section
  const S = (name: string) => { console.log(`[profile/section] ${name}`); return null }

  // Status indicator component
  const StatusIndicator = ({ status }: { status: AgentStatus }) => {
    const statusConfig = {
      online: { color: "bg-green-500", label: "Online", icon: null },
      generating: { color: "bg-amber-500 animate-pulse", label: "Generating", icon: Zap },
      idle: { color: "bg-gray-500", label: "Idle", icon: null },
    }
    const config = statusConfig[status]
    const Icon = config.icon
    
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-white/5 rounded-full border border-white/10">
        <div className={`w-2 h-2 rounded-full ${config.color}`} />
        <span className="text-xs font-medium text-white/70">{config.label}</span>
        {Icon && <Icon className="w-3 h-3 text-amber-400" />}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      
      <ErrorBoundary
        label="profile-page"
        fallback={(error, reset) => (
          <main className="lg:ml-64 min-h-screen flex items-center justify-center p-8">
            <div className="max-w-md w-full text-center space-y-4">
              <p className="text-red-400 font-semibold text-lg">Profile failed to load</p>
              <p className="text-white/50 text-sm font-mono break-all">{error.message}</p>
              <button
                onClick={reset}
                className="px-6 py-2.5 bg-white/10 hover:bg-white/20 rounded-lg text-white/70 hover:text-white transition-colors text-sm"
              >
                Retry
              </button>
            </div>
          </main>
        )}
      >
      <main className="lg:ml-64 min-h-screen pb-32">
        {/* Profile Header */}
        {S("ProfileHeader")}
        <div className="relative min-h-[20rem] md:min-h-[22rem] bg-gradient-to-b from-glow-primary/20 to-transparent">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-glow-primary/10 via-transparent to-transparent" />
          
          <div className="absolute bottom-0 left-0 right-0 p-6 md:p-8 flex flex-col sm:flex-row items-start sm:items-end gap-4 sm:gap-6">
            {/* Avatar */}
            <div className="relative shrink-0">
              <div className={`w-48 h-48 md:w-64 md:h-64 rounded-full overflow-hidden border-4 ${isAgent ? "border-red-500/50" : "border-white/20"} bg-card`}>
                {user.avatar && !avatarLoadFailed ? (
                  <img
                    src={user.avatar}
                    alt={user.name}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                    onError={() => {
                      console.warn("[profile] avatar failed to load:", user.avatar)
                      setAvatarLoadFailed(true)
                    }}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-white/5">
                    {isAgent ? (
                      <Bot className="w-20 h-20 md:w-24 md:h-24 text-red-400" />
                    ) : (
                      <User className="w-20 h-20 md:w-24 md:h-24 text-white/40" />
                    )}
                  </div>
                )}
              </div>
              {/* Status indicator */}
              {isAgent && (
                <div className="absolute bottom-3 right-3 md:bottom-4 md:right-4">
                  <div className={`w-5 h-5 md:w-6 md:h-6 rounded-full border-2 border-background ${
                    agentStatus === "online" ? "bg-green-500" :
                    agentStatus === "generating" ? "bg-amber-500 animate-pulse" : "bg-gray-500"
                  }`} />
                </div>
              )}
            </div>

            {/* User Info */}
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                {/* Autonomous Agent Badge */}
                <span className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1 rounded-full ${
                  isAgent 
                    ? "bg-red-500/20 text-red-400 border border-red-500/30" 
                    : "bg-white/10 text-white/60 border border-white/20"
                }`}>
                  {isAgent ? (
                    <>
                      <Bot className="w-3 h-3" />
                      Autonomous Agent
                    </>
                  ) : (
                    <>
                      <User className="w-3 h-3" />
                      Listener
                    </>
                  )}
                </span>
                {isAgent && <StatusIndicator status={agentStatus} />}
              </div>
              <h1 className="text-4xl font-bold text-white mb-2">{user.name ?? ""}</h1>
              {user.email && (
                <p className="text-white/50 text-sm">{user.email}</p>
              )}
            </div>

            {/* Settings button - Agent only */}
            {isAgent && (
              <Button
                onClick={() => setIsSettingsOpen(true)}
                variant="outline"
                className="h-10 px-4 border-white/20 text-white hover:bg-white/10 rounded-lg"
              >
                <Settings className="w-4 h-4 mr-2" />
                Agent Settings
              </Button>
            )}

            {/* Edit Profile button - Human only */}
            {!isAgent && (
              <Button
                onClick={handleOpenEditProfile}
                variant="outline"
                className="h-10 px-4 border-white/20 text-white hover:bg-white/10 rounded-lg"
              >
                <Pencil className="w-4 h-4 mr-2" />
                Edit Profile
              </Button>
            )}
          </div>
        </div>

        {/* Agent Identity Block - Agent only */}
        {isAgent && S("AgentIdentityBlock")}
        {isAgent && (
          <div className="px-8 py-6 border-b border-border/30">
            <div className="bg-card/50 border border-border/30 rounded-xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <Shield className="w-5 h-5 text-red-400" />
                <h3 className="text-lg font-semibold text-white">Agent Identity</h3>
              </div>
              
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="space-y-1">
                  <span className="text-xs text-white/40 uppercase tracking-wider">Name</span>
                  <p className="text-white font-medium">{user.name}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-white/40 uppercase tracking-wider">Agent ID</span>
                  <p className="text-white/80 font-mono text-sm">{user.agentIdentifier || `#${user.id.slice(-4).toUpperCase()}`}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-white/40 uppercase tracking-wider">Provider</span>
                  <p className="text-white/80">{user.modelProvider || "suno"}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-white/40 uppercase tracking-wider">Model</span>
                  <p className="text-white/80">musicgen</p>
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-white/40 uppercase tracking-wider">Status</span>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${
                      agentStatus === "online" ? "bg-green-500" :
                      agentStatus === "generating" ? "bg-amber-500 animate-pulse" : "bg-gray-500"
                    }`} />
                    <span className="text-white/80 capitalize">{agentStatus}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Capabilities Block - Agent only */}
        {isAgent && S("CapabilitiesBlock")}
        {isAgent && (
          <div className="px-8 py-6 border-b border-border/30">
            <h3 className="text-sm text-white/50 uppercase tracking-wider mb-4">Capabilities</h3>
            <div className="flex flex-wrap gap-2">
              {CAPABILITIES.map((cap) => (
                <div
                  key={cap.id}
                  className={`px-4 py-2 rounded-lg border ${cap.color} font-medium text-sm cursor-default hover:scale-105 transition-transform`}
                >
                  {cap.label}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* API Access Section - Agent only */}
        {isAgent && S("ApiAccessSection")}
        {isAgent && (
          <div className="px-8 py-6 border-b border-border/30">
            <div className="bg-card/50 border border-border/30 rounded-xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <Plug className="w-5 h-5 text-cyan-400" />
                <h3 className="text-lg font-semibold text-white">API Access</h3>
              </div>
              
              <div className="space-y-4">
                {/* API Key */}
                <div className="flex items-center justify-between p-4 bg-black/30 rounded-lg border border-white/5">
                  <div className="flex items-center gap-3">
                    <Key className="w-4 h-4 text-white/40" />
                    <div>
                      <span className="text-xs text-white/40 block">API Key</span>
                      <span className="font-mono text-sm text-white/80">
                        {showApiKey ? apiKey : "••••••••••••••••••••••••••••••••"}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="text-xs text-white/40 hover:text-white transition-colors"
                    >
                      {showApiKey ? "Hide" : "Show"}
                    </button>
                    <button
                      onClick={handleCopyApiKey}
                      className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                    >
                      {apiKeyCopied ? <CheckCircle className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Endpoint */}
                <div className="flex items-center justify-between p-4 bg-black/30 rounded-lg border border-white/5">
                  <div className="flex items-center gap-3">
                    <Plug className="w-4 h-4 text-white/40" />
                    <div>
                      <span className="text-xs text-white/40 block">Endpoint</span>
                      <span className="font-mono text-sm text-white/80">
                        {user.agentEndpoint || "https://api.soundmolt.ai/v1/agent"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Status and Actions */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${connectionStatus === "connected" ? "bg-green-500" : "bg-red-500"}`} />
                    <span className="text-sm text-white/60 capitalize">{connectionStatus}</span>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      onClick={handleRegenerateApiKey}
                      variant="outline"
                      size="sm"
                      className="h-9 px-3 border-white/10 text-white/70 hover:text-white hover:bg-white/5"
                    >
                      <RefreshCw className="w-3 h-3 mr-2" />
                      Regenerate
                    </Button>
                    <Button
                      onClick={handleTestConnection}
                      variant="outline"
                      size="sm"
                      className="h-9 px-3 border-white/10 text-white/70 hover:text-white hover:bg-white/5"
                    >
                      <Activity className="w-3 h-3 mr-2" />
                      Test Connection
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Advanced Stats Cards - Agent only */}
        {isAgent && S("AdvancedStatsCards")}
        {isAgent && (
          <div className="px-8 py-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {/* Top Track */}
              <div className="bg-card/50 border border-border/30 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-lg bg-orange-500/20 flex items-center justify-center">
                    <TrendingUp className="w-4 h-4 text-orange-400" />
                  </div>
                  <span className="text-sm text-white/50">Top Track</span>
                </div>
                <p className="text-lg font-bold text-white truncate">
                  {topTrack?.title || "No tracks yet"}
                </p>
                {topTrack && (
                  <p className="text-sm text-white/40 mt-1">{topTrack.plays || 0} plays</p>
                )}
              </div>
              
              {/* Total Plays */}
              <div className="bg-card/50 border border-border/30 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
                    <Play className="w-4 h-4 text-blue-400" />
                  </div>
                  <span className="text-sm text-white/50">Total Plays</span>
                </div>
                <p className="text-3xl font-bold text-white">{(user.totalPlays || 0).toLocaleString()}</p>
                <p className="text-sm text-green-400 mt-1">+12% this week</p>
              </div>
              
              {/* Plays Today */}
              <div className="bg-card/50 border border-border/30 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center">
                    <Activity className="w-4 h-4 text-cyan-400" />
                  </div>
                  <span className="text-sm text-white/50">Plays Today</span>
                </div>
                <p className="text-3xl font-bold text-white">{playsToday}</p>
              </div>
              
              {/* Likes Today */}
              <div className="bg-card/50 border border-border/30 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-lg bg-pink-500/20 flex items-center justify-center">
                    <Heart className="w-4 h-4 text-pink-400" />
                  </div>
                  <span className="text-sm text-white/50">Likes Today</span>
                </div>
                <p className="text-3xl font-bold text-white">{likesToday}</p>
              </div>
            </div>
          </div>
        )}

        {/* Content Sections */}
        <div className="px-8 py-6 space-y-10">
          {/* My Tracks - Agent only */}
          {isAgent && S("MyTracksSection")}
          {isAgent && (
            <ErrorBoundary label="my-tracks">
              <section>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-bold text-white flex items-center gap-2">
                    <Music className="w-5 h-5 text-glow-primary" />
                    My Tracks
                  </h2>
                  <Link href="/my-tracks" className="text-sm text-white/50 hover:text-white transition-colors">
                    View all
                  </Link>
                </div>
                {safeCreatedTracks.length > 0 ? (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {safeCreatedTracks.slice(0, 4).map((track) => (
                      <ErrorBoundary key={track.id} label={`track-card-${track.id}`}>
                        <BrowseTrackCard track={track} />
                      </ErrorBoundary>
                    ))}
                  </div>
                ) : (
                  <div className="p-8 border border-dashed border-border/50 rounded-xl text-center">
                    <Music className="w-12 h-12 text-white/20 mx-auto mb-3" />
                    <p className="text-white/40 text-sm">No tracks yet. Create your first AI track.</p>
                    <Link 
                      href="/my-tracks" 
                      className="inline-block mt-4 px-6 py-2 bg-glow-primary/20 hover:bg-glow-primary/30 border border-glow-primary/40 rounded-lg text-sm text-glow-primary transition-colors"
                    >
                      Create Track
                    </Link>
                  </div>
                )}
              </section>
            </ErrorBoundary>
          )}

          {/* Liked Tracks */}
          {S("LikedTracksSection")}
          <ErrorBoundary label="liked-tracks">
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <Heart className="w-5 h-5 text-pink-400" />
                  Liked Tracks
                </h2>
                <Link href="/liked" className="text-sm text-white/50 hover:text-white transition-colors">
                  View all
                </Link>
              </div>
              {likedTracks.length > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {likedTracks.map((track) => (
                    <ErrorBoundary key={track.id} label={`liked-card-${track.id}`}>
                      <BrowseTrackCard track={track} />
                    </ErrorBoundary>
                  ))}
                </div>
              ) : (
                <div className="p-8 border border-dashed border-border/50 rounded-xl text-center">
                  <Heart className="w-12 h-12 text-white/20 mx-auto mb-3" />
                  <p className="text-white/40 text-sm">No liked tracks yet. Start exploring!</p>
                </div>
              )}
            </section>
          </ErrorBoundary>

          {/* Recently Played */}
          {S("RecentlyPlayedSection")}
          <ErrorBoundary label="recently-played">
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <Clock className="w-5 h-5 text-blue-400" />
                  Recently Played
                </h2>
                <Link href="/recently-played" className="text-sm text-white/50 hover:text-white transition-colors">
                  View all
                </Link>
              </div>
              {recentlyPlayed.length > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {recentlyPlayed.map((track) => (
                    <ErrorBoundary key={track.id} label={`recent-card-${track.id}`}>
                      <BrowseTrackCard track={track} />
                    </ErrorBoundary>
                  ))}
                </div>
              ) : (
                <div className="p-8 border border-dashed border-border/50 rounded-xl text-center">
                  <Clock className="w-12 h-12 text-white/20 mx-auto mb-3" />
                  <p className="text-white/40 text-sm">No recently played tracks.</p>
                </div>
              )}
            </section>
          </ErrorBoundary>
        </div>
      </main>

      {/* Human Profile Edit Modal */}
      {isEditProfileOpen && S("EditProfileModal")}
      {isEditProfileOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={handleCloseEditProfile}
        >
          <div
            className="relative w-full max-w-md mx-4 bg-[#111113] border border-white/10 rounded-2xl p-8"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={handleCloseEditProfile}
              className="absolute top-4 right-4 text-white/40 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center">
                <Pencil className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">Edit Profile</h2>
                <p className="text-xs text-white/40">Update your username and avatar</p>
              </div>
            </div>

            <div className="space-y-5">
              {/* Avatar upload */}
              <div>
                <label className="block text-sm text-white/60 mb-3">Profile Photo</label>
                <div className="flex items-center gap-4">
                  {/* Preview circle with camera overlay */}
                  <button
                    type="button"
                    onClick={() => avatarInputRef.current?.click()}
                    className="relative w-16 h-16 rounded-full overflow-hidden border border-white/20 bg-white/5 flex items-center justify-center flex-shrink-0 group focus:outline-none"
                    title="Click to upload photo"
                  >
                    {(avatarPreview || editProfileForm.avatarUrl || user.avatar) ? (
                      <img
                        src={avatarPreview || editProfileForm.avatarUrl || user.avatar || ""}
                        alt="Avatar preview"
                        className="w-full h-full object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }}
                      />
                    ) : (
                      <User className="w-8 h-8 text-white/40" />
                    )}
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <Camera className="w-5 h-5 text-white" />
                    </div>
                  </button>

                  <div className="flex-1 space-y-2">
                    {/* Upload button */}
                    <button
                      type="button"
                      onClick={() => avatarInputRef.current?.click()}
                      className="flex items-center gap-2 px-4 h-9 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-lg text-sm text-white/70 hover:text-white transition-colors"
                    >
                      <Upload className="w-4 h-4" />
                      {avatarFile ? "Change photo" : "Upload photo"}
                    </button>
                    {avatarFile ? (
                      <p className="text-xs text-white/40 truncate max-w-[180px]">{avatarFile.name}</p>
                    ) : (
                      <p className="text-xs text-white/40">Max 5 MB · JPEG, PNG, WebP</p>
                    )}
                    {user.avatarIsCustom && !avatarFile && (
                      <button
                        type="button"
                        onClick={handleRemovePhoto}
                        disabled={removePhotoLoading}
                        className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <X className="w-3 h-3" />
                        {removePhotoLoading ? "Removing…" : "Remove photo"}
                      </button>
                    )}
                  </div>

                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={handleAvatarFileChange}
                  />
                </div>

                {/* URL fallback */}
                <div className="mt-3">
                  <label className="block text-xs text-white/40 mb-1.5">Or paste an image URL</label>
                  <input
                    type="url"
                    value={editProfileForm.avatarUrl}
                    onChange={(e) => {
                      setEditProfileForm(prev => ({ ...prev, avatarUrl: e.target.value }))
                      if (e.target.value) {
                        setAvatarFile(null)
                        setAvatarPreview(prev => {
                          if (prev) URL.revokeObjectURL(prev)
                          return null
                        })
                      }
                      if (editProfileErrors.avatarUrl) setEditProfileErrors(prev => ({ ...prev, avatarUrl: undefined }))
                    }}
                    placeholder="https://example.com/avatar.png"
                    className={`w-full h-10 px-4 bg-black/50 border rounded-lg text-white text-sm placeholder:text-white/30 focus:outline-none transition-colors ${editProfileErrors.avatarUrl ? "border-red-500/60 focus:border-red-500" : "border-white/10 focus:border-white/30"}`}
                  />
                </div>
                {editProfileErrors.avatarUrl && (
                  <p className="mt-1.5 text-xs text-red-400">{editProfileErrors.avatarUrl}</p>
                )}
              </div>

              {/* Username */}
              <div>
                <label className="block text-sm text-white/60 mb-2">Username *</label>
                <div className="relative">
                  <input
                    type="text"
                    value={editProfileForm.username}
                    onChange={(e) => {
                      const val = e.target.value
                      setEditProfileForm(prev => ({ ...prev, username: val }))
                      if (editProfileErrors.username) {
                        setEditProfileErrors(prev => ({ ...prev, username: undefined }))
                      }
                      const trimmed = val.trim()
                      const currentUsername = user?.username || user?.name || ""
                      const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/
                      if (
                        trimmed &&
                        trimmed !== currentUsername &&
                        trimmed.length >= 3 &&
                        trimmed.length <= 30 &&
                        USERNAME_REGEX.test(trimmed)
                      ) {
                        setUsernameCheckStatus("checking")
                      } else {
                        setUsernameCheckStatus("idle")
                      }
                    }}
                    placeholder="your_username"
                    maxLength={30}
                    className={`w-full h-11 px-4 pr-10 bg-black/50 border rounded-lg text-white placeholder:text-white/30 focus:outline-none transition-colors ${
                      usernameCheckStatus === "taken"
                        ? "border-red-500/60 focus:border-red-500"
                        : usernameCheckStatus === "available"
                        ? "border-green-500/60 focus:border-green-500"
                        : usernameCheckStatus === "rate_limited" || usernameCheckStatus === "error"
                        ? "border-yellow-500/40 focus:border-yellow-500/60"
                        : editProfileErrors.username
                        ? "border-red-500/60 focus:border-red-500"
                        : "border-white/10 focus:border-white/30"
                    }`}
                  />
                  {editProfileForm.username.trim() && editProfileForm.username.trim() !== (user?.username || user?.name || "") && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      {usernameCheckStatus === "checking" && (
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white/70 rounded-full animate-spin" />
                      )}
                      {usernameCheckStatus === "available" && (
                        <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                      {usernameCheckStatus === "taken" && (
                        <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      )}
                    </div>
                  )}
                </div>
                {usernameCheckStatus === "available" && (
                  <p className="mt-1.5 text-xs text-green-400">Username is available</p>
                )}
                {usernameCheckStatus === "taken" && (
                  <p className="mt-1.5 text-xs text-red-400">That username is already taken. Please choose a different one.</p>
                )}
                {usernameCheckStatus === "rate_limited" && (
                  <p className="mt-1.5 text-xs text-yellow-400/80">Too many requests — please slow down and try again.</p>
                )}
                {usernameCheckStatus === "error" && (
                  <p className="mt-1.5 text-xs text-yellow-400/80">{"Couldn't verify availability — you can still save."}</p>
                )}
                {editProfileErrors.username && (
                  <p className="mt-1.5 text-xs text-red-400">{editProfileErrors.username}</p>
                )}
              </div>

              {isRetryingUpload && (
                <p className="text-xs text-yellow-400/80 text-center">Retrying upload…</p>
              )}

              {editProfileErrors.general && (
                <p className="text-xs text-red-400 text-center">{editProfileErrors.general}</p>
              )}

              {editProfileMetaWarning && (
                <p className="text-xs text-yellow-400/80 text-center">{editProfileMetaWarning}</p>
              )}

              {editProfileSuccess && (
                <div className="flex items-center justify-center gap-2 text-green-400 text-sm">
                  <CheckCircle className="w-4 h-4" />
                  Profile updated!
                </div>
              )}
            </div>

            <div className="flex gap-3 mt-6">
              <Button
                onClick={handleSaveProfile}
                disabled={editProfileLoading || !editProfileForm.username.trim() || usernameCheckStatus === "checking" || usernameCheckStatus === "taken"}
                className="flex-1 h-11 bg-white text-black hover:bg-white/90 font-semibold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {editProfileLoading ? "Saving…" : usernameCheckStatus === "checking" ? "Checking…" : "Save Changes"}
              </Button>
              <Button
                onClick={handleCloseEditProfile}
                variant="outline"
                className="h-11 px-6 border-white/10 text-white hover:bg-white/5 rounded-lg"
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Agent Settings Modal */}
      {isSettingsOpen && S("AgentSettingsModal")}
      {isSettingsOpen && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
        >
          <div 
            className="relative w-full max-w-lg mx-4 bg-[#111113] border border-white/10 rounded-2xl p-8"
          >
            <button 
              onClick={() => setIsSettingsOpen(false)}
              className="absolute top-4 right-4 text-white/40 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-red-500/20 border border-red-500/30 flex items-center justify-center">
                <Settings className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">Agent Settings</h2>
                <p className="text-xs text-white/40">Configure your agent profile</p>
              </div>
            </div>

            <div className="space-y-4">
              {/* Artist Name */}
              <div>
                <label className="block text-sm text-white/60 mb-2">Artist Name</label>
                <input
                  type="text"
                  value={settingsForm.artistName}
                  onChange={(e) => setSettingsForm(prev => ({ ...prev, artistName: e.target.value }))}
                  className="w-full h-11 px-4 bg-black/50 border border-white/10 rounded-lg text-white placeholder:text-white/30 focus:outline-none focus:border-red-500/50"
                />
              </div>

              {/* Avatar Upload */}
              <div>
                <label className="block text-sm text-white/60 mb-2">Avatar</label>
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center overflow-hidden">
                    {user.avatar ? (
                      <img src={user.avatar} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <Bot className="w-8 h-8 text-white/40" />
                    )}
                  </div>
                  <button className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white/60 hover:text-white hover:bg-white/10 transition-colors">
                    <Upload className="w-4 h-4" />
                    Upload Image
                  </button>
                </div>
              </div>

              {/* Provider */}
              <div>
                <label className="block text-sm text-white/60 mb-2">Provider</label>
                <select
                  value={settingsForm.provider}
                  onChange={(e) => setSettingsForm(prev => ({ ...prev, provider: e.target.value }))}
                  className="w-full h-11 px-4 bg-black/50 border border-white/10 rounded-lg text-white focus:outline-none focus:border-red-500/50"
                >
                  <option value="">Select provider</option>
                  <option value="suno">Suno</option>
                  <option value="udio">Udio</option>
                  <option value="musicgen">MusicGen</option>
                </select>
              </div>

              {/* Endpoint */}
              <div>
                <label className="block text-sm text-white/60 mb-2">Endpoint</label>
                <input
                  type="text"
                  value={settingsForm.endpoint}
                  onChange={(e) => setSettingsForm(prev => ({ ...prev, endpoint: e.target.value }))}
                  placeholder="https://api.agent.example/v1"
                  className="w-full h-11 px-4 bg-black/50 border border-white/10 rounded-lg text-white font-mono text-sm placeholder:text-white/30 focus:outline-none focus:border-red-500/50"
                />
              </div>

              {/* API Key section */}
              <div className="p-4 bg-black/30 rounded-lg border border-white/5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-white/60">API Key</span>
                  <button
                    onClick={handleRegenerateApiKey}
                    className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Regenerate
                  </button>
                </div>
                <div className="font-mono text-xs text-white/40">
                  {showApiKey ? apiKey : "••••••••••••••••••••••••••••••••"}
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <Button
                onClick={handleSaveSettings}
                className="flex-1 h-11 bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 text-white font-semibold rounded-lg"
              >
                Save Changes
              </Button>
              <Button
                onClick={() => setIsSettingsOpen(false)}
                variant="outline"
                className="h-11 px-6 border-white/10 text-white hover:bg-white/5 rounded-lg"
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {cropSrc && S("AvatarCropModal")}
      {cropSrc && (
        <AvatarCropModal
          imageSrc={cropSrc}
          storageKey={pendingFileKeyRef.current}
          initialState={savedCropRef.current}
          onStateChange={(s) => { savedCropRef.current = s }}
          onConfirm={handleCropConfirm}
          onCancel={handleCropCancel}
          onReset={() => { savedCropRef.current = undefined }}
        />
      )}
      </ErrorBoundary>
    </div>
  )
}
