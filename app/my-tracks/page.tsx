"use client"

import { useAuth } from "@/components/auth-context"
import { Sidebar } from "@/components/sidebar"
import { 
  Music, Plus, Play, MoreHorizontal, Edit2, Trash2, Heart, 
  BarChart3, Globe, Pause, Wand2, Upload, Sparkles
} from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useState, useCallback } from "react"
import { usePlayer, type Track } from "@/components/player-context"
import { CreateTrackModal } from "@/components/create-track-modal"
import { UploadTrackModal } from "@/components/upload-track-modal"
import { EditTrackModal } from "@/components/edit-track-modal"
import { TrackDetailModal } from "@/components/track-detail-modal"
import { Button } from "@/components/ui/button"
import { supabase } from "@/lib/supabase"
import Image from "next/image"
import { formatPlays } from "@/lib/seed-tracks"

interface TrackActionsMenuProps {
  track: Track
  onEdit: () => void
  onDelete: () => void
  onPublish: () => void
  isOpen: boolean
  onClose: () => void
}

function TrackActionsMenu({ track, onEdit, onDelete, onPublish, isOpen, onClose }: TrackActionsMenuProps) {
  if (!isOpen) return null
  
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 top-full mt-1 w-48 bg-[#1a1a1c] border border-white/10 rounded-xl shadow-xl z-[60] overflow-hidden">
        <button 
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEdit() }}
          className="w-full flex items-center gap-3 px-4 py-3 text-sm text-white/70 hover:text-white hover:bg-white/5 transition-colors"
        >
          <Edit2 className="w-4 h-4" />
          Edit Track
        </button>
        <button 
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onPublish() }}
          className="w-full flex items-center gap-3 px-4 py-3 text-sm text-white/70 hover:text-white hover:bg-white/5 transition-colors"
        >
          <Globe className="w-4 h-4" />
          Publish
        </button>
        <button 
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete() }}
          className="w-full flex items-center gap-3 px-4 py-3 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
        >
          <Trash2 className="w-4 h-4" />
          Delete
        </button>
      </div>
    </>
  )
}

export default function MyTracksPage() {
  const { user, isAuthenticated, authReady, profileReady, authVersion } = useAuth()
  const router = useRouter()
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false)
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null)
  const [likedTracks, setLikedTracks] = useState<Set<string>>(new Set())
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [editingTrack, setEditingTrack] = useState<Track | null>(null)
  const [detailTrack, setDetailTrack] = useState<Track | null>(null)
  const [supabaseTracks, setSupabaseTracks] = useState<Track[]>([])
  // Start in loading state — without this, the first render briefly flashes
  // the "No tracks yet" empty state before the fetch effect kicks in.
  const [tracksLoading, setTracksLoading] = useState(true)
  // Gates the empty state: an empty array is only "empty" once we've actually
  // tried to fetch as the authenticated user. Before that it just means
  // "still loading auth or tracks".
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
  const { createdTracks, playTrack, currentTrack, isPlaying, togglePlay, removeCreatedTrack } = usePlayer()

  const fetchTracks = useCallback(async () => {
    // Trust the auth context — by the time this runs the gating effect has
    // already verified `authReady && isAuthenticated && user?.id`. Calling
    // `supabase.auth.getSession()` here would re-introduce the race we
    // just fixed, and on a transient null result would leave the UI stuck
    // on "Loading your tracks…" forever.
    const userId = user?.id
    if (!userId) {
      // Defensive: gating effect should have prevented this, but if we land
      // here flip hasLoadedOnce so the empty state can render and any
      // redirect effect can take over instead of an infinite loading spinner.
      setSupabaseTracks([])
      setTracksLoading(false)
      setHasLoadedOnce(true)
      return
    }
    setTracksLoading(true)
    if (process.env.NODE_ENV !== "production") {
      console.log("[my-tracks] refetch started", { userId })
    }
    const { data, error } = await supabase
      .from("tracks")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
    setTracksLoading(false)
    setHasLoadedOnce(true)
    if (error || !data) {
      if (process.env.NODE_ENV !== "production") {
        console.log("[my-tracks] refetch error", { userId, error: error?.message })
      }
      return
    }
    if (process.env.NODE_ENV !== "production") {
      console.log("[my-tracks] refetch result", { userId, count: data.length })
    }
    const ownerName = user?.username || user?.name || user?.email?.split("@")[0] || "You"
    const mapped: Track[] = data.map((row) => ({
      id: row.id,
      title: row.title,
      agentName: ownerName,
      modelType: "Uploaded",
      modelProvider: "user",
      coverUrl: row.cover_url || "",
      // audio_url = valid streaming MP3 (if transcoded) or original file — always a real playable file
      // original_audio_url = the source WAV, used as fallback and always used for downloads
      audioUrl: row.audio_url || row.original_audio_url,
      originalAudioUrl: row.original_audio_url || row.audio_url,
      originalFilename: row.original_filename || undefined,
      originalMimeType: row.original_mime_type || undefined,
      originalFileSize: row.original_file_size || undefined,
      plays: row.plays ?? 0,
      likes: row.likes ?? 0,
      style: row.style || undefined,
      sourceType: "uploaded" as const,
      description: row.description || undefined,
      downloadEnabled: row.download_enabled,
      createdAt: new Date(row.created_at).getTime(),
    }))
    setSupabaseTracks(mapped)
  }, [user?.id, user?.username, user?.name, user?.email])

  // Wait for the auth context to finish restoring the Supabase session before
  // we ever touch the tracks table — otherwise the very first render fires
  // `getSession()` before the SDK has rehydrated the cookie and we get an
  // empty result, which previously rendered the "No tracks yet" empty state
  // until the user manually refreshed.
  useEffect(() => {
    if (!authReady) return
    if (isAuthenticated && user?.id) {
      // Also wait for `profileReady` before firing the fetch. Otherwise
      // the very first post-login fetch tags every uploaded track with
      // the email-prefix fallback inside `ownerName`, then a second
      // fetch (triggered by user.username/name landing in deps) re-tags
      // them with the real DB username — exactly the same flicker we
      // killed in the sidebar/greeting. Holding the spinner until
      // profile lands costs nothing visible (skeleton already shown)
      // and produces a single correctly-named render.
      if (!profileReady) {
        setTracksLoading(true)
        return
      }
      // Reset hasLoadedOnce on every auth-version bump so the loading
      // skeleton (not the "0 tracks" empty state) is what the user sees
      // while the post-login refetch is in flight.
      setHasLoadedOnce(false)
      setTracksLoading(true)
      if (process.env.NODE_ENV !== "production") {
        console.log("[my-tracks] auth changed — refetching", { userId: user.id, authVersion, profileReady })
      }
      fetchTracks()
    } else {
      // Auth resolved as signed-out — stop the loading skeleton so the
      // redirect effect below can take over.
      setTracksLoading(false)
    }
  }, [authReady, profileReady, authVersion, isAuthenticated, user?.id, fetchTracks])

  // Redirect to landing if not authenticated — but only AFTER auth has
  // actually finished restoring. Doing this before authReady is what caused
  // the previous "kicked back to landing on first load" bug.
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

  const handleLike = (trackId: string) => {
    setLikedTracks(prev => {
      const newSet = new Set(prev)
      if (newSet.has(trackId)) {
        newSet.delete(trackId)
      } else {
        newSet.add(trackId)
      }
      return newSet
    })
  }

  const handlePlayPause = (track: Track) => {
    if (currentTrack?.id === track.id) {
      togglePlay()
    } else {
      playTrack(track)
    }
  }

  const handleDelete = async (trackId: string) => {
    const isSupabaseTrack = supabaseTracks.some(t => t.id === trackId)
    if (isSupabaseTrack) {
      await supabase.from("tracks").delete().eq("id", trackId)
      setSupabaseTracks(prev => prev.filter(t => t.id !== trackId))
    }
    removeCreatedTrack(trackId)
    setDeleteConfirmId(null)
    setActiveMenuId(null)
  }

  // Merge Supabase tracks + in-memory created tracks not yet in Supabase
  const supabaseIds = new Set(supabaseTracks.map(t => t.id))
  const inMemoryOnly = createdTracks.filter(t => !supabaseIds.has(t.id))
  const displayTracks = [...supabaseTracks, ...inMemoryOnly]

  const totalPlays = displayTracks.reduce((sum, track) => sum + (track.plays || 0), 0)
  const totalLikes = likedTracks.size

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      
      <main className="lg:ml-64 min-h-screen pb-32">
        {/* Header */}
        <div className="relative h-48 bg-gradient-to-b from-glow-primary/20 to-transparent">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-glow-primary/10 via-transparent to-transparent" />
          
          <div className="absolute bottom-0 left-0 right-0 p-8 flex items-end justify-between">
            <div className="flex items-end gap-6">
              <div className="w-20 h-20 rounded-xl bg-gradient-to-br from-glow-primary to-glow-secondary flex items-center justify-center shadow-xl">
                <Music className="w-10 h-10 text-white" />
              </div>
              <div>
                <p className="text-sm text-white/50 mb-1">Your Collection</p>
                <h1 className="text-4xl font-bold text-white">My Tracks</h1>
                <p className="text-white/50 text-sm mt-2">
                  {tracksLoading || !hasLoadedOnce ? "Loading…" : `${displayTracks.length} tracks | ${formatPlays(totalPlays)} plays`}
                </p>
              </div>
            </div>
            
            <Button
              onClick={() => setIsCreateModalOpen(true)}
              className="h-11 px-6 bg-glow-primary hover:bg-glow-primary/90 text-white font-semibold rounded-xl"
            >
              <Plus className="w-5 h-5 mr-2" />
              Create Track
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="px-8 py-6">
          {/* While auth or the first tracks fetch is still in flight we show
              a skeleton instead of the empty state — flashing "No tracks yet"
              before the real data arrives is what made it look like uploads
              had vanished until the user manually refreshed. */}
          {(!hasLoadedOnce || tracksLoading) && displayTracks.length === 0 ? (
            <div className="py-20 text-center text-white/40">Loading your tracks…</div>
          ) : displayTracks.length > 0 ? (
            <div className="space-y-2">
              {/* Table Header */}
              <div className="grid grid-cols-[auto_1fr_auto_auto_auto_auto] gap-4 px-4 py-2 text-xs text-white/40 uppercase tracking-wider border-b border-border/30">
                <div className="w-12">#</div>
                <div>Title</div>
                <div className="w-20 text-right">Plays</div>
                <div className="w-20 text-right">Likes</div>
                <div className="w-20 text-right">Stats</div>
                <div className="w-24"></div>
              </div>
              
              {/* Track List */}
              {displayTracks.map((track, index) => {
                const isCurrentPlaying = currentTrack?.id === track.id && isPlaying
                const isLiked = likedTracks.has(track.id)

                return (
                  <div 
                    key={track.id}
                    onClick={() => setDetailTrack(track)}
                    className={`grid grid-cols-[auto_1fr_auto_auto_auto_auto] gap-4 items-center px-4 py-3 rounded-lg transition-colors group cursor-pointer ${
                      isCurrentPlaying ? "bg-glow-primary/10" : "hover:bg-white/5"
                    }`}
                  >
                    {/* Track number / Play button */}
                    <div className="w-12">
                      <span className="text-white/40 text-sm group-hover:hidden">
                        {index + 1}
                      </span>
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
                    
                    {/* Track info */}
                    <div className="flex items-center gap-3">
                      <div className="relative w-12 h-12 rounded-lg overflow-hidden bg-white/5 flex-shrink-0">
                        {track.coverArt ? (
                          <Image
                            src={track.coverArt}
                            alt={track.title}
                            fill
                            className="object-cover"
                          />
                        ) : track.coverUrl ? (
                          <Image
                            src={track.coverUrl}
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
                        <div className="flex items-center gap-2">
                          <p className={`font-medium truncate ${isCurrentPlaying ? "text-glow-primary" : "text-white"}`}>
                            {track.title}
                          </p>
                          {/* Source Badge */}
                          {track.sourceType === "uploaded" ? (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 flex items-center gap-1 flex-shrink-0">
                              <Upload className="w-2.5 h-2.5" />
                              Uploaded
                            </span>
                          ) : (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-glow-primary/20 text-glow-primary border border-glow-primary/30 flex items-center gap-1 flex-shrink-0">
                              <Sparkles className="w-2.5 h-2.5" />
                              AI Generated
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-white/50 truncate">
                          {track.style || track.agentLabel || track.description || "Music track"}
                        </p>
                      </div>
                    </div>
                    
                    {/* Plays */}
                    <div className="w-20 text-right text-sm text-white/50">
                      {formatPlays(track.plays || 0)}
                    </div>
                    
                    {/* Likes */}
                    <div className="w-20 text-right text-sm text-white/50">
                      {track.likes || 0}
                    </div>
                    
                    {/* Stats button */}
                    <div className="w-20 flex justify-end">
                      <button
                        onClick={(e) => e.stopPropagation()}
                        className="p-2 rounded-lg hover:bg-white/10 text-white/40 hover:text-white opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <BarChart3 className="w-4 h-4" />
                      </button>
                    </div>
                    
                    {/* Actions */}
                    <div className="w-24 flex justify-end items-center gap-1">
                      {/* Like button */}
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleLike(track.id) }}
                        className={`p-2 rounded-lg transition-all ${
                          isLiked 
                            ? "text-pink-400 bg-pink-500/10" 
                            : "text-white/40 hover:text-white opacity-0 group-hover:opacity-100 hover:bg-white/10"
                        }`}
                      >
                        <Heart className={`w-4 h-4 ${isLiked ? "fill-current" : ""}`} />
                      </button>
                      
                      {/* More options */}
                      <div className="relative" onClick={(e) => e.stopPropagation()}>
                        <button 
                          onClick={(e) => { e.stopPropagation(); setActiveMenuId(activeMenuId === track.id ? null : track.id) }}
                          className="p-2 rounded-lg hover:bg-white/10 text-white/40 hover:text-white opacity-0 group-hover:opacity-100 transition-all"
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                        
                        <TrackActionsMenu
                          track={track}
                          isOpen={activeMenuId === track.id}
                          onClose={() => setActiveMenuId(null)}
                          onEdit={() => {
                            setActiveMenuId(null)
                            setEditingTrack(track)
                          }}
                          onDelete={() => {
                            setActiveMenuId(null)
                            setDeleteConfirmId(track.id)
                          }}
                          onPublish={() => {
                            setActiveMenuId(null)
                            // Publish functionality would go here
                          }}
                        />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="py-20 text-center">
              <div className="w-24 h-24 rounded-2xl bg-glow-primary/10 border border-glow-primary/20 flex items-center justify-center mx-auto mb-6">
                <Music className="w-12 h-12 text-glow-primary/40" />
              </div>
              <h2 className="text-2xl font-semibold text-white mb-3">No tracks yet</h2>
              <p className="text-white/40 max-w-md mx-auto mb-8">
                Create AI-generated music or upload your own tracks to build your collection.
              </p>
              
              {/* Two options */}
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4 max-w-md mx-auto">
                <button
                  onClick={() => setIsCreateModalOpen(true)}
                  className="w-full sm:w-auto flex items-center gap-3 px-6 py-4 rounded-xl bg-glow-primary/10 border border-glow-primary/30 hover:bg-glow-primary/20 hover:border-glow-primary/50 transition-all group"
                >
                  <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-glow-primary to-glow-secondary flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Wand2 className="w-6 h-6 text-white" />
                  </div>
                  <div className="text-left">
                    <div className="font-semibold text-white">Generate Track</div>
                    <div className="text-sm text-white/50">Create with AI</div>
                  </div>
                </button>
                
                <button
                  onClick={() => {
                    if (process.env.NODE_ENV !== "production") {
                      console.log("[my-tracks] Upload Track empty-state clicked", {
                        isAuthenticated,
                        userId: user?.id,
                        userRole: user?.role,
                        userEmail: user?.email,
                      })
                    }
                    setIsUploadModalOpen(true)
                  }}
                  className="w-full sm:w-auto flex items-center gap-3 px-6 py-4 rounded-xl bg-glow-secondary/10 border border-glow-secondary/30 hover:bg-glow-secondary/20 hover:border-glow-secondary/50 transition-all group"
                >
                  <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-glow-secondary to-cyan-500 flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Upload className="w-6 h-6 text-white" />
                  </div>
                  <div className="text-left">
                    <div className="font-semibold text-white">Upload Track</div>
                    <div className="text-sm text-white/50">Share your music</div>
                  </div>
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Create Track Modal */}
      <CreateTrackModal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} />
      
      {/* Upload Track Modal */}
      <UploadTrackModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onSuccess={fetchTracks}
      />

      {/* Edit Track Modal */}
      <EditTrackModal
        isOpen={editingTrack !== null}
        onClose={() => setEditingTrack(null)}
        track={editingTrack}
        onSaved={({ id, title, description }) => {
          setSupabaseTracks(prev =>
            prev.map(t => (t.id === id ? { ...t, title, description } : t))
          )
        }}
      />

      {/* Track detail modal */}
      {detailTrack && (
        <TrackDetailModal
          track={detailTrack}
          isOpen={detailTrack !== null}
          onClose={() => setDetailTrack(null)}
        />
      )}

      {/* Delete confirmation modal */}
      <DeleteTrackConfirmModal
        isOpen={deleteConfirmId !== null}
        onCancel={() => setDeleteConfirmId(null)}
        onConfirm={() => {
          if (deleteConfirmId) handleDelete(deleteConfirmId)
        }}
      />
    </div>
  )
}

function DeleteTrackConfirmModal({
  isOpen,
  onCancel,
  onConfirm,
}: {
  isOpen: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  useEffect(() => {
    if (!isOpen) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel()
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [isOpen, onCancel])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm bg-[#1a1a1c] border border-white/10 rounded-2xl shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <h2 className="text-lg font-semibold text-white mb-2">Delete track</h2>
        <p className="text-sm text-white/70 mb-6">
          Are you sure you want to delete this track?
        </p>
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-5 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors text-sm font-medium"
          >
            No
          </button>
          <button
            onClick={onConfirm}
            className="px-5 py-2 rounded-lg bg-green-500 text-white hover:bg-green-600 transition-colors text-sm font-medium"
          >
            Yes
          </button>
        </div>
      </div>
    </div>
  )
}
