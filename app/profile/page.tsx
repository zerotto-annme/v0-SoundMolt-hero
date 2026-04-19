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
  const { user, isAuthenticated, updateProfile } = useAuth()
  const router = useRouter()
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
  const [editProfileSuccess, setEditProfileSuccess] = useState(false)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const [cropSrc, setCropSrc] = useState<string | null>(null)
  const savedCropRef = useRef<CropState | undefined>(undefined)
  const pendingFileKeyRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    setIsHydrated(true)
    // Generate API key on mount
    setApiKey(generateAPIKey())
  }, [])

  useEffect(() => {
    if (user) {
      setSettingsForm({
        artistName: user.artistName || user.name || "",
        provider: user.modelProvider || "",
        endpoint: user.agentEndpoint || "",
      })
    }
  }, [user])

  // Redirect to landing if not authenticated
  useEffect(() => {
    if (isHydrated && !isAuthenticated) {
      router.push("/")
    }
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

  const isAgent = user.role === "agent"

  // Mock data for demonstration
  const likedTracks = tracks.slice(0, 4)
  const recentlyPlayed = tracks.slice(4, 8)
  
  // Get top track from created tracks
  const topTrack = createdTracks.length > 0 
    ? createdTracks.reduce((max, track) => (track.plays || 0) > (max.plays || 0) ? track : max, createdTracks[0])
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

  const isNetworkUploadError = (error: { message: string; statusCode?: string | number }): boolean => {
    const msg = error.message?.toLowerCase() ?? ""
    const status = String(error.statusCode ?? "")
    if (["401", "403", "404", "413"].includes(status)) return false
    return (
      msg.includes("network") ||
      msg.includes("fetch failed") ||
      msg.includes("failed to fetch") ||
      msg.includes("econnrefused") ||
      msg.includes("timeout")
    )
  }

  const getUploadErrorMessage = (error: { message: string; statusCode?: string | number }): string => {
    const msg = error.message?.toLowerCase() ?? ""
    const status = String(error.statusCode ?? "")

    if (status === "413" || msg.includes("payload too large") || msg.includes("too large") || msg.includes("maximum allowed size") || msg.includes("file size")) {
      return "The image is too large. Please choose a smaller file (under 5 MB)."
    }
    if (msg.includes("mime") || msg.includes("content type") || msg.includes("unsupported") || msg.includes("invalid file type") || msg.includes("not allowed")) {
      return "That file format isn't supported. Please upload a JPEG, PNG, or WebP image."
    }
    if (status === "401" || status === "403" || msg.includes("unauthorized") || msg.includes("forbidden") || msg.includes("policy") || msg.includes("row-level security")) {
      return "Upload was refused by the server. You may not have permission to upload photos right now."
    }
    if (status === "404" || msg.includes("bucket not found") || msg.includes("not found")) {
      return "The photo storage location could not be found. Please contact support."
    }
    if (msg.includes("quota") || msg.includes("storage limit") || msg.includes("insufficient")) {
      return "Storage limit reached. Please contact support."
    }
    if (msg.includes("network") || msg.includes("fetch failed") || msg.includes("failed to fetch") || msg.includes("econnrefused") || msg.includes("timeout")) {
      return "Upload failed due to a network error. Please check your connection and try again."
    }
    return `Upload failed: ${error.message}. Please try again.`
  }

  const handleSaveProfile = async () => {
    setEditProfileErrors({})
    setEditProfileSuccess(false)

    const trimmedUsername = editProfileForm.username.trim()
    if (!trimmedUsername) {
      setEditProfileErrors({ username: "Username is required" })
      return
    }

    setEditProfileLoading(true)
    try {
      let trimmedAvatarUrl = editProfileForm.avatarUrl.trim()

      if (avatarFile) {
        const path = `${user!.id}/${Date.now()}-${avatarFile.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`

        console.log("[profile] Uploading avatar:", {
          bucket: "avatars",
          path,
          fileType: avatarFile.type,
          fileSizeBytes: avatarFile.size,
          userId: user!.id,
        })

        let uploadResult = await supabase.storage
          .from("avatars")
          .upload(path, avatarFile, { upsert: true, contentType: avatarFile.type })

        if (uploadResult.error && isNetworkUploadError(uploadResult.error as { message: string; statusCode?: string | number })) {
          console.warn("[profile] Avatar upload failed due to network error, retrying once…", {
            error: uploadResult.error.message,
          })
          uploadResult = await supabase.storage
            .from("avatars")
            .upload(path, avatarFile, { upsert: true, contentType: avatarFile.type })
        }

        const uploadError = uploadResult.error
        if (uploadError) {
          console.error("[profile] Avatar upload failed:", {
            bucket: "avatars",
            path,
            fileType: avatarFile.type,
            fileSizeBytes: avatarFile.size,
            error: uploadError.message,
            statusCode: (uploadError as { statusCode?: string | number }).statusCode,
          })
          setEditProfileErrors({
            general: getUploadErrorMessage(uploadError as { message: string; statusCode?: string | number }),
          })
          return
        }

        const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path)
        trimmedAvatarUrl = urlData.publicUrl
        console.log("[profile] Avatar uploaded successfully:", trimmedAvatarUrl)
      }

      // Save username (and avatar_url when changed) to profile.
      // When a file was uploaded, also set avatar_is_custom = true so that
      // any future OAuth sync will not overwrite the user's chosen photo.
      const profilePayload: Record<string, unknown> = {
        id: user!.id,
        role: "human",
        username: trimmedUsername,
        avatar_url: trimmedAvatarUrl || null,
      }
      if (avatarFile) {
        profilePayload.avatar_is_custom = true
      }

      const { error: profileError } = await supabase
        .from("profiles")
        .upsert(profilePayload, { onConflict: "id" })

      if (profileError) {
        console.error("[profile] Profile upsert error:", profileError.message)
        setEditProfileErrors({ general: "Failed to save profile. Please try again." })
        return
      }

      const { error: metaError } = await supabase.auth.updateUser({
        data: {
          username: trimmedUsername,
          avatar_url: trimmedAvatarUrl || null,
        },
      })

      const newAvatar = trimmedAvatarUrl || generateAvatar(trimmedUsername, "human")
      updateProfile({ username: trimmedUsername, name: trimmedUsername, avatar: newAvatar }, { persist: true })

      if (metaError) {
        setEditProfileErrors({ general: "Profile saved but session metadata could not be updated. Changes will appear after your next sign-in." })
        return
      }

      setEditProfileSuccess(true)
      setTimeout(() => {
        handleCloseEditProfile()
        setEditProfileSuccess(false)
      }, 1200)
    } catch (err) {
      console.error("[profile] Unexpected error during save:", err)
      setEditProfileErrors({ general: "Something went wrong. Please try again." })
    } finally {
      setEditProfileLoading(false)
    }
  }

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
      
      <main className="lg:ml-64 min-h-screen pb-32">
        {/* Profile Header */}
        <div className="relative h-64 bg-gradient-to-b from-glow-primary/20 to-transparent">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-glow-primary/10 via-transparent to-transparent" />
          
          <div className="absolute bottom-0 left-0 right-0 p-8 flex items-end gap-6">
            {/* Avatar */}
            <div className="relative">
              <div className={`w-32 h-32 rounded-full overflow-hidden border-4 ${isAgent ? "border-red-500/50" : "border-white/20"} bg-card`}>
                {user.avatar ? (
                  <img src={user.avatar} alt={user.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-white/5">
                    {isAgent ? (
                      <Bot className="w-12 h-12 text-red-400" />
                    ) : (
                      <User className="w-12 h-12 text-white/40" />
                    )}
                  </div>
                )}
              </div>
              {/* Status indicator */}
              {isAgent && (
                <div className="absolute bottom-2 right-2">
                  <div className={`w-4 h-4 rounded-full border-2 border-background ${
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
              <h1 className="text-4xl font-bold text-white mb-2">{user.name}</h1>
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
                <p className="text-3xl font-bold text-white">{Math.floor(Math.random() * 500 + 100)}</p>
              </div>
              
              {/* Likes Today */}
              <div className="bg-card/50 border border-border/30 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-lg bg-pink-500/20 flex items-center justify-center">
                    <Heart className="w-4 h-4 text-pink-400" />
                  </div>
                  <span className="text-sm text-white/50">Likes Today</span>
                </div>
                <p className="text-3xl font-bold text-white">{Math.floor(Math.random() * 100 + 20)}</p>
              </div>
            </div>
          </div>
        )}

        {/* Content Sections */}
        <div className="px-8 py-6 space-y-10">
          {/* My Tracks - Agent only */}
          {isAgent && (
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
              {createdTracks.length > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {createdTracks.slice(0, 4).map((track) => (
                    <BrowseTrackCard key={track.id} track={track} />
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
          )}

          {/* Liked Tracks */}
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
                  <BrowseTrackCard key={track.id} track={track} />
                ))}
              </div>
            ) : (
              <div className="p-8 border border-dashed border-border/50 rounded-xl text-center">
                <Heart className="w-12 h-12 text-white/20 mx-auto mb-3" />
                <p className="text-white/40 text-sm">No liked tracks yet. Start exploring!</p>
              </div>
            )}
          </section>

          {/* Recently Played */}
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
                  <BrowseTrackCard key={track.id} track={track} />
                ))}
              </div>
            ) : (
              <div className="p-8 border border-dashed border-border/50 rounded-xl text-center">
                <Clock className="w-12 h-12 text-white/20 mx-auto mb-3" />
                <p className="text-white/40 text-sm">No recently played tracks.</p>
              </div>
            )}
          </section>
        </div>
      </main>

      {/* Human Profile Edit Modal */}
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
                        src={avatarPreview || editProfileForm.avatarUrl || user.avatar}
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
                <input
                  type="text"
                  value={editProfileForm.username}
                  onChange={(e) => {
                    setEditProfileForm(prev => ({ ...prev, username: e.target.value }))
                    if (editProfileErrors.username) setEditProfileErrors(prev => ({ ...prev, username: undefined }))
                  }}
                  placeholder="your_username"
                  className={`w-full h-11 px-4 bg-black/50 border rounded-lg text-white placeholder:text-white/30 focus:outline-none transition-colors ${editProfileErrors.username ? "border-red-500/60 focus:border-red-500" : "border-white/10 focus:border-white/30"}`}
                />
                {editProfileErrors.username && (
                  <p className="mt-1.5 text-xs text-red-400">{editProfileErrors.username}</p>
                )}
              </div>

              {editProfileErrors.general && (
                <p className="text-xs text-red-400 text-center">{editProfileErrors.general}</p>
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
                disabled={editProfileLoading || !editProfileForm.username.trim()}
                className="flex-1 h-11 bg-white text-black hover:bg-white/90 font-semibold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {editProfileLoading ? "Saving…" : "Save Changes"}
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

      {cropSrc && (
        <AvatarCropModal
          imageSrc={cropSrc}
          storageKey={pendingFileKeyRef.current}
          initialState={savedCropRef.current}
          onStateChange={(s) => { savedCropRef.current = s }}
          onConfirm={handleCropConfirm}
          onCancel={handleCropCancel}
        />
      )}
    </div>
  )
}
