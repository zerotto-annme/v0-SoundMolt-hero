"use client"

import { useEffect, useState } from "react"
import { X, Loader2, Music } from "lucide-react"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { supabase } from "@/lib/supabase"
import type { Track } from "@/components/player-context"
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock"

interface EditTrackModalProps {
  isOpen: boolean
  onClose: () => void
  track: Track | null
  onSaved?: (updated: { id: string; title: string; description: string }) => void
}

export function EditTrackModal({ isOpen, onClose, track, onSaved }: EditTrackModalProps) {
  useBodyScrollLock(isOpen && !!track)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (isOpen && track) {
      setTitle(track.title || "")
      setDescription(track.description || "")
      setError("")
      setSaving(false)
    }
  }, [isOpen, track])

  if (!isOpen || !track) return null

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

      const { error: updateError } = await supabase
        .from("tracks")
        .update({ title: trimmedTitle, description: description.trim() || null })
        .eq("id", track.id)
        .eq("user_id", session.user.id)

      if (updateError) {
        console.error("[edit-track] update error:", updateError.message)
        setError(updateError.message || "Failed to save changes")
        setSaving(false)
        return
      }

      onSaved?.({ id: track.id, title: trimmedTitle, description: description.trim() })
      onClose()
    } catch (err) {
      console.error("[edit-track] unexpected error:", err)
      setError("Something went wrong. Please try again.")
    } finally {
      setSaving(false)
    }
  }

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
          {/* Cover preview */}
          <div className="flex items-center gap-4">
            <div className="relative w-16 h-16 rounded-lg overflow-hidden bg-white/5 flex-shrink-0">
              {track.coverArt || track.coverUrl ? (
                <Image
                  src={track.coverArt || track.coverUrl}
                  alt={track.title}
                  fill
                  className="object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Music className="w-6 h-6 text-white/30" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-white/40 uppercase tracking-wider">Editing</p>
              <p className="text-sm text-white/70 truncate font-mono">{track.id}</p>
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
