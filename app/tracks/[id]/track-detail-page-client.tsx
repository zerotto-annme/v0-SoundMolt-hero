"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { TrackDetailModal } from "@/components/track-detail-modal"

// Shape we build server-side and feed into TrackDetailModal.
// Superset of TrackDetailModalProps['track'] — extra runtime fields
// (audioUrl, originalAudioUrl, …) are carried untyped through the
// modal's playTrack(track) call so the global player can stream the
// real audio for DB-backed tracks. TS structural typing accepts the
// excess properties when assigning to the modal's narrower interface.
export interface ResolvedTrack {
  id: string
  title: string
  agentName: string
  agentType?: "composer" | "vocalist" | "beatmaker" | "mixer" | "producer" | "arranger"
  agentLabel?: string
  modelType: string
  modelProvider: string
  coverUrl: string
  plays?: number
  likes?: number
  duration?: number
  sourceType?: "generated" | "uploaded"
  downloadEnabled?: boolean
  // DB owner (tracks.user_id) for visibility gating of owner-only modal
  // controls (e.g. AI Producer Review). Undefined for seed tracks; the
  // modal hides the control whenever this is undefined or doesn't match
  // the current viewer.
  userId?: string | null
  // Runtime-only (not declared on TrackDetailModalProps, but consumed
  // by usePlayer().playTrack via the same object reference):
  audioUrl?: string
  originalAudioUrl?: string
  description?: string
  style?: string
}

interface Props {
  track: ResolvedTrack
}

export function TrackDetailPageClient({ track }: Props) {
  const router = useRouter()
  // Modal is open by default — this page exists SOLELY to display the
  // track detail experience, so there's no underlying page UI behind it.
  const [isOpen, setIsOpen] = useState(true)

  const handleClose = () => {
    setIsOpen(false)
    // Direct-link entry rarely has navigation history; push '/' is
    // deterministic regardless of whether the user came from the feed
    // or pasted the link into a fresh tab.
    router.push("/")
  }

  return (
    <main className="min-h-screen bg-background">
      {/*
        Subtle dark backdrop visible behind the modal during the open
        animation and right before the post-close redirect. Matches the
        site-wide dark theme so there's no white flash on direct entry.
      */}
      <div className="fixed inset-0 -z-10 bg-gradient-to-b from-background via-background to-black/40" />
      <TrackDetailModal track={track} isOpen={isOpen} onClose={handleClose} />
    </main>
  )
}
