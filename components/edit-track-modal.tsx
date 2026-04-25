"use client"

import { useEffect, useRef, useState } from "react"
import { X, Loader2, Music, ImageIcon } from "lucide-react"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { supabase } from "@/lib/supabase"
import { uploadWithRetry } from "@/lib/upload-with-retry"
import type { Track } from "@/components/player-context"
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock"

interface EditTrackModalProps {
  isOpen: boolean
  onClose: () => void
  track: Track | null
  onSaved?: (updated: {
    id: string
    title: string
    description: string
    style?: string
    coverUrl?: string
  }) => void
}

const GENRES = [
  { id: "lofi", name: "Lo-Fi" },
  { id: "techno", name: "Techno" },
  { id: "ambient", name: "Ambient" },
  { id: "synthwave", name: "Synthwave" },
  { id: "trap", name: "Trap" },
  { id: "cinematic", name: "Cinematic" },
  { id: "electronic", name: "Electronic" },
  { id: "house", name: "House" },
  { id: "dnb", name: "Drum & Bass" },
  { id: "experimental", name: "Experimental" },
]

const COVER_MAX_BYTES = 8 * 1024 * 1024 // 8 MB
const COVER_ACCEPT = "image/jpeg,image/jpg,image/png,image/webp"

export function EditTrackModal({ isOpen, onClose, track, onSaved }: EditTrackModalProps) {
  useBodyScrollLock(isOpen && !!track)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [style, setStyle] = useState("")
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [coverPreview, setCoverPreview] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const coverInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen && track) {
      setTitle(track.title || "")
      setDescription(track.description || "")
      setStyle(track.style || "")
      setCoverFile(null)
      setCoverPreview(prev => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
      setError("")
      setSaving(false)
    }
  }, [isOpen, track])

  // Always release the blob URL when the component unmounts so we don't leak.
  useEffect(() => {
    return () => {
      setCoverPreview(prev => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
    }
  }, [])

  if (!isOpen || !track) return null

  const handlePickCover = (file: File | null) => {
    setError("")
    if (!file) return
    if (!COVER_ACCEPT.split(",").includes(file.type)) {
      setError("Cover must be a JPG, PNG, or WebP image.")
      return
    }
    if (file.size > COVER_MAX_BYTES) {
      setError("Cover must be 8 MB or smaller.")
      return
    }
    setCoverFile(file)
    setCoverPreview(prev => {
      if (prev) URL.revokeObjectURL(prev)
      return URL.createObjectURL(file)
    })
  }

  const handleSave = async () => {
    setError("")
    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      setError("Title is required")
      return
    }
    if (trimmedTitle.length > 200) {
      setError("Title must be 200 characters or fewer")
      return
    }
    if (description.length > 2000) {
      setError("Description must be 2000 characters or fewer")
      return
    }

    setSaving(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setError("You must be signed in to edit this track")
        setSaving(false)
        return
      }

      // 1. Upload a new cover image, if the user picked one. We reuse the
      //    same `covers` bucket and per-user path scheme as the upload
      //    flow so storage policies behave identically.
      let nextCoverUrl: string | undefined = undefined
      if (coverFile) {
        const userId = session.user.id
        const ext = (coverFile.name.split(".").pop() || "jpg").toLowerCase()
        const path = `${userId}/${Date.now()}.${ext}`
        const { error: coverError } = await uploadWithRetry(
          () => supabase.storage.from("covers").upload(path, coverFile, {
            upsert: false,
            contentType: coverFile.type,
          }),
          "Cover image upload (edit)",
        )
        if (coverError) {
          console.error("[edit-track] cover upload failed:", coverError)
          setError(`Cover upload failed: ${coverError.message}`)
          setSaving(false)
          return
        }
        const { data: pub } = supabase.storage.from("covers").getPublicUrl(path)
        nextCoverUrl = pub.publicUrl
      }

      // 2. Build the patch — only include cover_url if we actually uploaded
      //    a new image, so we never accidentally null an existing cover.
      const patch: {
        title: string
        description: string | null
        style: string | null
        cover_url?: string
      } = {
        title: trimmedTitle,
        description: description.trim() || null,
        style: style || null,
      }
      if (nextCoverUrl) patch.cover_url = nextCoverUrl

      const { error: updateError } = await supabase
        .from("tracks")
        .update(patch)
        .eq("id", track.id)
        .eq("user_id", session.user.id)

      if (updateError) {
        console.error("[edit-track] update error:", updateError.message)
        setError(updateError.message || "Failed to save changes")
        setSaving(false)
        return
      }

      onSaved?.({
        id: track.id,
        title: trimmedTitle,
        description: description.trim(),
        style: style || undefined,
        coverUrl: nextCoverUrl,
      })
      onClose()
    } catch (err) {
      console.error("[edit-track] unexpected error:", err)
      setError("Something went wrong. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  const displayCover = coverPreview || track.coverArt || track.coverUrl

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div
        className="absolute inset-0"
        onClick={() => !saving && onClose()}
      />
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto overscroll-contain bg-[#111113] border border-white/10 rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h2 className="text-lg font-semibold text-white">Edit Track</h2>
          <button
            onClick={onClose}
            disabled={saving}
            className="p-2 rounded-lg text-white/50 hover:text-white hover:bg-white/5 disabled:opacity-50 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          {/* Cover preview + change button */}
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => !saving && coverInputRef.current?.click()}
              disabled={saving}
              className="group relative w-16 h-16 rounded-lg overflow-hidden bg-white/5 flex-shrink-0 border border-white/10 hover:border-white/30 transition-colors disabled:opacity-50"
              aria-label="Change cover image"
            >
              {displayCover ? (
                <Image
                  src={displayCover}
                  alt={track.title}
                  fill
                  sizes="64px"
                  className="object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Music className="w-6 h-6 text-white/30" />
                </div>
              )}
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity">
                <ImageIcon className="w-5 h-5 text-white" />
              </div>
            </button>
            <input
              ref={coverInputRef}
              type="file"
              accept={COVER_ACCEPT}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null
                handlePickCover(file)
                // allow re-selecting the same file later
                if (e.target) e.target.value = ""
              }}
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-white/40 uppercase tracking-wider">Editing</p>
              <p className="text-sm text-white/70 truncate font-mono">{track.id}</p>
              <button
                type="button"
                onClick={() => !saving && coverInputRef.current?.click()}
                disabled={saving}
                className="mt-1 text-xs text-glow-secondary hover:text-glow-primary disabled:opacity-50 transition-colors"
              >
                {coverFile ? "Replace cover" : "Change cover"}
              </button>
            </div>
          </div>

          {/* Title */}
          <div className="space-y-2">
            <label htmlFor="edit-track-title" className="block text-sm font-medium text-white/80">
              Title
            </label>
            <input
              id="edit-track-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              disabled={saving}
              className="w-full h-10 px-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/30 focus:outline-none focus:border-glow-primary/60 transition-colors disabled:opacity-50"
              placeholder="Track title"
            />
            <p className="text-xs text-white/30 text-right font-mono">{title.length}/200</p>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <label htmlFor="edit-track-description" className="block text-sm font-medium text-white/80">
              Description
            </label>
            <textarea
              id="edit-track-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              rows={4}
              disabled={saving}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/30 focus:outline-none focus:border-glow-primary/60 transition-colors resize-none disabled:opacity-50"
              placeholder="Tell listeners about this track…"
            />
            <p className="text-xs text-white/30 text-right font-mono">{description.length}/2000</p>
          </div>

          {/* Style */}
          <div className="space-y-2">
            <label htmlFor="edit-track-style" className="block text-sm font-medium text-white/80">
              Style <span className="text-white/40 text-xs font-normal">(optional)</span>
            </label>
            <select
              id="edit-track-style"
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              disabled={saving}
              className="w-full h-10 px-3 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-glow-primary/60 transition-colors disabled:opacity-50"
            >
              <option value="">No style</option>
              {GENRES.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>

          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-white/10 bg-white/[0.02]">
          <button
            onClick={onClose}
            disabled={saving}
            className="h-10 px-4 rounded-lg text-sm text-white/70 hover:text-white hover:bg-white/5 disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <Button
            onClick={handleSave}
            disabled={saving || !title.trim()}
            className="h-10 px-5 bg-gradient-to-r from-glow-primary to-glow-secondary hover:opacity-90 text-white font-semibold rounded-lg disabled:opacity-50"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving…
              </>
            ) : (
              "Save changes"
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
