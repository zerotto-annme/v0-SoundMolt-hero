"use client"

import { useState, useEffect, useLayoutEffect, useRef, useMemo } from "react"
import Image from "next/image"
import Link from "next/link"
import { X, Play, Pause, Heart, Share2, Plus, Sparkles, Clock, Zap, MoreHorizontal, ExternalLink, Copy, Music, Mic, Drum, Sliders, Disc, Layers, SkipBack, SkipForward, Volume2, MessageCircle, Download, Loader2, Upload, Lock } from "lucide-react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { usePlayer, usePlayerProgress } from "./player-context"
import { useFavorites } from "./favorites-context"
import { useDiscussions } from "./discussions-context"
import { useAuth } from "./auth-context"
import { TrackComments } from "./track-comments"
import { useTrackComments, type Comment } from "./track-comments-context"
import { TrackAnalysisBlock } from "./track-analysis-block"
import { TrackFeedbackBlock } from "./track-feedback-block"
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock"
import { trackShareUrl } from "@/lib/site"

type AgentType = "composer" | "vocalist" | "beatmaker" | "mixer" | "producer" | "arranger"

interface TrackDetailModalProps {
  track: {
    id: string
    title: string
    agentName: string
    agentType?: AgentType
    agentLabel?: string
    modelType: string
    modelProvider: string
    coverUrl: string
    plays?: number
    duration?: number
    sourceType?: "generated" | "uploaded"
    downloadEnabled?: boolean
  }
  isOpen: boolean
  onClose: () => void
}

// Agent type icons mapping
const AGENT_TYPE_ICONS: Record<AgentType, typeof Music> = {
  composer: Music,
  vocalist: Mic,
  beatmaker: Drum,
  mixer: Sliders,
  producer: Disc,
  arranger: Layers,
}

const AGENT_TYPE_COLORS: Record<AgentType, string> = {
  composer: "from-cyan-500 to-blue-600",
  vocalist: "from-pink-500 to-rose-600",
  beatmaker: "from-orange-500 to-amber-600",
  mixer: "from-violet-500 to-purple-600",
  producer: "from-emerald-500 to-teal-600",
  arranger: "from-indigo-500 to-blue-600",
}

const AGENT_TYPE_BG: Record<AgentType, string> = {
  composer: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  vocalist: "bg-pink-500/20 text-pink-400 border-pink-500/30",
  beatmaker: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  mixer: "bg-violet-500/20 text-violet-400 border-violet-500/30",
  producer: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  arranger: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
}

const MODEL_COLORS: Record<string, string> = {
  suno: "from-purple-500 to-purple-700",
  openai: "from-emerald-500 to-emerald-700",
  anthropic: "from-orange-500 to-orange-700",
  google: "from-blue-500 to-blue-700",
  udio: "from-rose-500 to-rose-700",
  meta: "from-sky-500 to-sky-700",
  stability: "from-violet-500 to-violet-700",
}

const MODEL_BADGES: Record<string, string> = {
  suno: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  openai: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  anthropic: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  google: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  udio: "bg-rose-500/20 text-rose-300 border-rose-500/30",
  meta: "bg-sky-500/20 text-sky-300 border-sky-500/30",
  stability: "bg-violet-500/20 text-violet-300 border-violet-500/30",
}

// Generate consistent waveform data based on track ID
function extFromContentType(mime: string): string {
  const map: Record<string, string> = {
    "audio/wav": "wav", "audio/x-wav": "wav",
    "audio/mpeg": "mp3", "audio/mp3": "mp3",
    "audio/flac": "flac", "audio/x-flac": "flac",
    "audio/aac": "aac",
    "audio/ogg": "ogg",
    "audio/mp4": "m4a",
  }
  const base = mime.split(";")[0].trim()
  return map[base] || "wav"
}

function generateWaveformData(trackId: string, bars: number = 80): number[] {
  const seed = trackId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
  const data: number[] = []
  for (let i = 0; i < bars; i++) {
    const noise = Math.sin(seed * i * 0.1) * 0.3 + Math.sin(seed * i * 0.05) * 0.2
    const envelope = Math.sin((i / bars) * Math.PI) * 0.5 + 0.5
    const value = Math.abs(noise + envelope * 0.7) * 0.8 + 0.2
    data.push(Math.min(1, Math.max(0.1, value)))
  }
  return data
}

export function TrackDetailModal({ track, isOpen, onClose }: TrackDetailModalProps) {
  useBodyScrollLock(isOpen)
  const [isLiked, setIsLiked] = useState(false)
  const [showCopied, setShowCopied] = useState(false)
  const [hoveredMarker, setHoveredMarker] = useState<Comment | null>(null)
  const [isDownloading, setIsDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState(false)
  const [showDownloadDisabled, setShowDownloadDisabled] = useState(false)
  const waveformRef = useRef<HTMLDivElement>(null)
  // === SCROLL BODY REF + RESET ===
  // Held so we can deterministically force scrollTop = 0 every time the modal
  // becomes visible OR the track changes. Without this, "sometimes the modal
  // opens at analysis/feedback/comments" — when React reconciles a same-instance
  // modal across consecutive opens (or across track changes via parents that
  // keep the modal mounted), the scroll body's DOM node can survive with its
  // previous scrollTop intact. The useLayoutEffect below runs synchronously
  // before paint so the user never visually sees the wrong scroll position.
  const scrollBodyRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const { currentTrack, isPlaying, playTrack, togglePlay, prevTrack, nextTrack, preloadTrack } = usePlayer()
  const { progress, currentTime, duration, seekTo } = usePlayerProgress()
  const { getTopicByTrackId, createTrackTopic } = useDiscussions()
  const { requireAuth, isAuthenticated, openSignInModal } = useAuth()
  const { getComments } = useTrackComments()
  const { isFavorite, toggleFavorite } = useFavorites()

  // Get comments for this track
  const trackComments = getComments(track.id)
  const isTrackFavorite = isFavorite(track.id)

  // Preload track audio when modal opens
  useEffect(() => {
    if (isOpen) {
      preloadTrack(track)
    }
  }, [isOpen, track, preloadTrack])

  // Force scroll body to top on every open + every track change. Runs before
  // paint so the user always sees the Player section at the top — never lands
  // mid-scroll on Analysis / Feedback / Comments. The key={track.id} on the
  // scroll body container (below) is the second line of defence: it forces a
  // fresh DOM node per track so even React reconciliation can't carry over a
  // stale scrollTop.
  useLayoutEffect(() => {
    if (isOpen && scrollBodyRef.current) {
      scrollBodyRef.current.scrollTop = 0
    }
  }, [isOpen, track.id])

  const handleDiscussTrack = () => {
    requireAuth(() => {
      // Check if a topic already exists for this track
      let topic = getTopicByTrackId(track.id)
      
      // If no existing topic, create one
      if (!topic) {
        topic = createTrackTopic(track.id, track.title, track.agentName)
      }
      
      onClose()
      router.push(`/discussions/${topic.slug}`)
    })
  }

  const handleDownload = async () => {
    // Check authentication first
    if (!isAuthenticated) {
      openSignInModal()
      return
    }

    // Check if downloads are enabled for this track
    if (track.downloadEnabled === false) {
      setShowDownloadDisabled(true)
      setTimeout(() => setShowDownloadDisabled(false), 3000)
      return
    }

    setIsDownloading(true)
    setDownloadError(false)

    try {
      console.log(`[download] Starting download for track: ${track.id} "${track.title}"`)

      const response = await fetch(`/api/download/${track.id}`)

      console.log(`[download] API response status: ${response.status}`)
      console.log(`[download] Content-Type: ${response.headers.get("Content-Type")}`)
      console.log(`[download] Content-Length: ${response.headers.get("Content-Length")}`)
      console.log(`[download] Content-Disposition: ${response.headers.get("Content-Disposition")}`)

      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: "Download failed" }))
        console.error(`[download] API error ${response.status}:`, errData)
        throw new Error(errData.error || `Server error ${response.status}`)
      }

      // Validate content-type is audio before saving
      const contentType = response.headers.get("Content-Type") || ""
      if (contentType && !contentType.startsWith("audio/") && !contentType.startsWith("application/octet")) {
        console.error(`[download] Unexpected content-type: ${contentType} — aborting to prevent saving HTML/error as audio`)
        throw new Error(`Unexpected content type: ${contentType}`)
      }

      const blob = await response.blob()
      console.log(`[download] Blob size: ${blob.size} bytes, type: ${blob.type}`)

      // Reject suspiciously small blobs — real audio files are at minimum a few KB
      if (blob.size < 512) {
        console.error(`[download] Blob too small (${blob.size} bytes) — file is corrupt or empty`)
        throw new Error("Downloaded file is empty or corrupt")
      }

      // Prefer server-supplied filename from Content-Disposition header
      let filename: string | null = null
      const disposition = response.headers.get("Content-Disposition")
      if (disposition) {
        const match = disposition.match(/filename="?([^";\n]+)"?/)
        if (match) filename = decodeURIComponent(match[1])
      }
      // Fall back: build filename from track metadata + inferred extension
      if (!filename) {
        const safeName = track.title.replace(/[^a-zA-Z0-9]/g, "_")
        const safeAgent = track.agentName.replace(/[^a-zA-Z0-9]/g, "_")
        const ext = extFromContentType(contentType || blob.type || "audio/wav")
        filename = `${safeName}_${safeAgent}_SoundMolt.${ext}`
      }

      console.log(`[download] Saving as: ${filename}`)

      // Trigger browser download
      const objectUrl = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = objectUrl
      a.download = filename
      a.style.display = "none"
      document.body.appendChild(a)
      a.click()
      // Small delay before revoking so browser has time to start the download
      setTimeout(() => {
        window.URL.revokeObjectURL(objectUrl)
        document.body.removeChild(a)
      }, 1000)

      console.log(`[download] Download triggered successfully`)
    } catch (error) {
      console.error("[download] Failed:", error)
      setDownloadError(true)
      setTimeout(() => setDownloadError(false), 4000)
    } finally {
      setIsDownloading(false)
    }
  }

  const isCurrentTrack = currentTrack?.id === track.id
  const isTrackPlaying = isCurrentTrack && isPlaying

  // Generate waveform data once based on track ID
  const waveformData = useMemo(() => generateWaveformData(track.id, 80), [track.id])

  const handlePlay = () => {
    if (isCurrentTrack) {
      togglePlay()
    } else {
      playTrack(track)
    }
  }

  const handleLike = () => {
    requireAuth(() => setIsLiked(!isLiked))
  }

  const handleToggleFavorite = () => {
    requireAuth(() => toggleFavorite(track))
  }

  const handleCopyLink = () => {
    // Use the canonical public base URL (lib/site.ts) — NEVER
    // window.location.origin, which in Replit preview is an ephemeral,
    // mTLS-proxied internal URL that recipients can't open.
    navigator.clipboard.writeText(trackShareUrl(track.id))
    setShowCopied(true)
    setTimeout(() => setShowCopied(false), 2000)
  }

  const handleWaveformClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isCurrentTrack || !waveformRef.current) return
    
    const rect = waveformRef.current.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const percent = (clickX / rect.width) * 100
    seekTo(Math.max(0, Math.min(100, percent)))
  }

  // Seek to a specific time in seconds (for comments)
  const handleSeekToTime = (seconds: number) => {
    if (!isCurrentTrack) {
      playTrack(track)
      // Small delay to allow track to start then seek
      setTimeout(() => {
        if (displayDuration > 0) {
          const percent = (seconds / displayDuration) * 100
          seekTo(Math.max(0, Math.min(100, percent)))
        }
      }, 100)
    } else if (displayDuration > 0) {
      const percent = (seconds / displayDuration) * 100
      seekTo(Math.max(0, Math.min(100, percent)))
    }
  }

  const formatTime = (seconds: number) => {
    if (isNaN(seconds) || seconds === Infinity) return "0:00"
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, "0")}`
  }

  const formatPlays = (num?: number) => {
    if (!num) return "0"
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
    if (num >= 1000) return `${(num / 1000).toFixed(0)}K`
    return num.toString()
  }

  const displayDuration = isCurrentTrack && duration > 0 ? duration : (track.duration || 204)
  const displayCurrentTime = isCurrentTrack ? currentTime : 0
  const displayProgress = isCurrentTrack ? progress : 0

  if (!isOpen) return null

  // === GLOBAL BOTTOM PLAYER COMPENSATION ===
  // The MusicPlayer (components/music-player.tsx) is rendered AFTER children
  // in app/layout.tsx, so at equal z-50 it paints on top of any overlay. We
  // shrink the modal panel so it never extends into the player band and bump
  // the panel above z-50 as a safety belt.
  // Player band heights — keep these in sync with music-player.tsx:
  //   • mobile: h-16 (64) + 4-px progress bar above + 1-px border-t ≈ 69 → 72
  //   • desktop: h-20 (80) + 1-px border-t ≈ 81 → 88 (also used /2 = 44 for re-centering)
  // NOTE: the magic-number classes below MUST be written as literal strings
  // (not template-interpolated) — Tailwind JIT scans source for full literal
  // class names; interpolated arbitrary values would never be emitted.
  const hasBottomPlayer = !!currentTrack

  return (
    <>
      {/* Backdrop — clicks do NOT close the modal. Stays at z-50 inset-0 so the
          dim covers everything; the bottom player paints over it (later in DOM
          at equal z) so it remains visible/usable while the modal is open. */}
      <div 
        className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 animate-in fade-in duration-200"
      />

      {/* Modal panel — flex column. Lifted to z-[60] so it always paints above
          the global bottom player (which is z-50, rendered after children in
          app/layout.tsx). Bottom inset and max-height shrink to leave the
          player band uncovered when a track is loaded — Comments/Footer stay
          fully reachable, internal Player stays visible. Centering on desktop
          shifts up by half the player band so the modal stays optically
          centered in the *available* (above-player) viewport. */}
      <div className={`fixed left-4 right-4 top-4 z-[60] md:inset-auto md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-full md:max-w-2xl bg-card border border-border/50 rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 fade-in duration-300 ${
        hasBottomPlayer
          ? "bottom-[calc(1rem+72px)] md:max-h-[calc(90vh-88px)] md:top-[calc(50%-44px)]"
          : "bottom-4 md:max-h-[90vh] md:top-1/2"
      }`}>
        {/* === CLOSE BUTTON: lifted to PANEL level (sibling of header / cover
              row, not nested inside the header strip) with explicit z-30 so
              it always paints — and hit-tests — above every other element in
              the modal panel.

              ROOT CAUSE OF PRIOR "needs 3–4 clicks" BUG:
              The cover-row container below uses negative top-margin
              (-mt-14 md:-mt-16) and is a block-level div that spans the full
              panel width. Even though visually empty above its inner cover
              image, its transparent bounding box extended UP into the bottom
              half of the close button's hit area (y≈32-48 px on desktop) and,
              with default pointer-events:auto + later DOM order, captured ~50%
              of clicks targeting the X icon. Lifting the button to panel-level
              with z-30 + the cover row's pointer-events-none (below) makes
              hit-test deterministic.

              Hit area: w-10 h-10 = 40×40 px (was 32×32). type=button prevents
              accidental form-submit semantics; aria-label provides screen
              reader text. === */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 z-30 w-10 h-10 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center text-white/80 hover:text-white hover:bg-black/70 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* === SOURCE BADGE: also lifted to panel level with z-30 so the cover
              image (which extends UP into the header via negative margin) can
              never visually cover it. pointer-events-none — purely decorative,
              never blocks anything underneath. === */}
        <div className="absolute top-3 left-3 z-30 pointer-events-none flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/50 backdrop-blur-sm border border-white/10">
          {track.sourceType === "uploaded" ? (
            <>
              <Upload className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-xs font-mono text-white/90">UPLOADED</span>
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5 text-glow-secondary" />
              <span className="text-xs font-mono text-white/90">AI GENERATED</span>
            </>
          )}
        </div>

        {/* === HEADER STRIP: purely decorative gradient + dark overlay.
              pointer-events-none on the wrapper so neither the gradient nor
              the dark overlay can ever intercept clicks meant for the close
              button or badge that now sit above it at panel level. === */}
        <div className={`flex-shrink-0 h-20 md:h-24 bg-gradient-to-br ${MODEL_COLORS[track.modelProvider] || "from-gray-600 to-gray-800"} relative pointer-events-none`}>
          <div className="absolute inset-0 bg-black/30" />
        </div>

        {/* === COVER + TITLE ROW: overlaps the gradient strip via negative
              margin (cover sits ~half on the gradient, half on the card body).

              pointer-events-none on the OUTER container neutralises the
              transparent extra rectangle created by the negative margin —
              that rectangle is what captured close-button clicks before this
              fix. The INNER flex re-enables pointer events for the cover,
              title, agent link (which navigates AND closes modal). === */}
        <div className="flex-shrink-0 relative px-6 -mt-14 md:-mt-16 pb-3 pointer-events-none">
          <div className="flex gap-4 items-end pointer-events-auto">
            {/* Cover */}
            <div className="relative w-28 h-28 md:w-32 md:h-32 rounded-xl overflow-hidden shadow-2xl ring-4 ring-card flex-shrink-0">
              <Image
                src={track.coverUrl}
                alt={track.title}
                fill
                className="object-cover"
              />
              {/* Playing indicator */}
              {isTrackPlaying && (
                <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                  <div className="flex items-end gap-0.5 h-6">
                    {[0.6, 1, 0.7, 0.9, 0.5].map((h, i) => (
                      <div
                        key={i}
                        className="w-1 bg-glow-primary rounded-full animate-pulse"
                        style={{ 
                          height: `${h * 100}%`,
                          animationDelay: `${i * 0.1}s`,
                          animationDuration: "0.5s"
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Track info */}
            <div className="flex-1 min-w-0 pb-2">
              <h2 className="text-2xl md:text-3xl font-bold text-foreground truncate mb-2">
                {track.title}
              </h2>
              <div className="flex items-center gap-3 flex-wrap">
                {/* Agent avatar with type icon */}
                {track.agentType ? (
                  <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${AGENT_TYPE_COLORS[track.agentType]} flex items-center justify-center ring-2 ring-white/10 shadow-lg`}>
                    {(() => {
                      const IconComponent = AGENT_TYPE_ICONS[track.agentType]
                      return <IconComponent className="w-4 h-4 text-white" />
                    })()}
                  </div>
                ) : (
                  <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${MODEL_COLORS[track.modelProvider] || "from-gray-500 to-gray-700"} flex items-center justify-center ring-2 ring-white/10`}>
                    <Music className="w-4 h-4 text-white" />
                  </div>
                )}
                <div className="flex flex-col">
                  <Link 
                      href={`/agent/${encodeURIComponent(track.agentName)}`}
                      onClick={onClose}
                      className="text-foreground font-medium hover:text-glow-primary hover:underline transition-colors"
                    >
                      {track.agentName}
                    </Link>
                  {track.agentLabel && (
                    <span className={`text-xs px-2 py-0.5 rounded border w-fit ${track.agentType ? AGENT_TYPE_BG[track.agentType] : "bg-glow-secondary/10 text-glow-secondary border-glow-secondary/20"}`}>
                      {track.agentLabel}
                    </span>
                  )}
                </div>
                <span className={`text-xs font-mono px-2 py-0.5 rounded border ${MODEL_BADGES[track.modelProvider] || "bg-gray-500/20 text-gray-300 border-gray-500/30"}`}>
                  {track.modelType}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* === SCROLL BODY: only this container scrolls. flex-1 min-h-0 makes it
              fill the remaining space after header + cover row, regardless of
              their actual heights. overscroll-contain prevents wheel chaining
              into the (already body-scroll-locked) page behind the modal. ===

              FIXED SECTION ORDER (the modal NEVER skips, reorders, or
              conditionally hides a whole section — that responsibility lives
              INSIDE each block, never here):

                  player → actions → analysis → feedback → comments → footer

              Each section is wrapped in a stable <div data-section="…"> so the
              DOM node always exists at the correct index, even when the inner
              component returns null. `empty:hidden` collapses an empty wrapper
              so we don't get a phantom 24-px space-y-6 gap between visible
              siblings (CSS :empty matches when the wrapper has zero children;
              React null returns produce zero children).

              `space-y-6` is the single source of truth for vertical rhythm —
              no per-section mt-* overrides allowed (they previously broke it). */}
        <div
          ref={scrollBodyRef}
          key={`scroll-${track.id}`}
          data-modal-scroll-body="true"
          className="flex-1 min-w-0 min-h-0 p-5 space-y-5 overflow-y-auto overflow-x-hidden overscroll-contain"
        >

          {/* === PLAYER AREA: waveform + transport.
                ALWAYS RENDERED — confirmed by audit: there is no `if (!track)`,
                `isMounted`, hydration, async-data, or analysis/feedback gate
                anywhere around this section. The only top-level early return
                in this component is `if (!isOpen) return null` at the modal
                level (mount lifecycle). On first render after isOpen=true the
                Player JSX is in DOM at the first paint frame; waveformData
                comes from a synchronous useMemo, getComments() is a synchronous
                context selector, and `preloadTrack` runs in a fire-and-forget
                useEffect that does not gate render.
                Visual: waveform/markers/transport are always at full presence;
                we no longer dim the waveform to 60% when the track isn't the
                current global track — that previously caused a 60→100 opacity
                "pop" at first play that read as "player appearing late". The
                playing-vs-idle distinction is still clearly conveyed by the
                Play/Pause icon, the progress bar fill, and the past-bars
                colouring (which only activates while currentTrack === this). */}
          <div
            key={`player-${track.id}`}
            data-section="player"
            data-player-rendered="true"
            className="bg-secondary/30 rounded-xl p-4 space-y-4"
          >
            {/* Waveform visualization */}
            <div
              ref={waveformRef}
              className="relative h-20 w-full flex items-end gap-[2px] cursor-pointer overflow-hidden"
              onClick={handleWaveformClick}
            >
              {waveformData.map((height, i) => {
                const barProgress = (i / waveformData.length) * 100
                const isPast = barProgress <= displayProgress
                // RENDER DETERMINISM (3 defensive guards against intermittent
                // "waveform disappeared" symptom):
                //
                // 1) `transition-colors` instead of `transition-all` — the prior
                //    `transition-all duration-100` animated height/width/opacity
                //    too. Under heavy HMR Fast Refresh churn (700+ rebuilds per
                //    session observed in logs) bars could mid-animate height and
                //    visually flicker / appear collapsed. Restricting transition
                //    to color only eliminates this class of glitch entirely.
                //
                // 2) `min-h-[2px]` — guarantees each bar paints at least 2 px
                //    tall regardless of percentage-height edge cases (flex-item
                //    `height: X%` can compute to 0 in some browser/Turbopack
                //    HMR states if the parent height context is briefly lost).
                //
                // 3) `min-w-[1px]` — guarantees at least 1 px width so bars are
                //    visible even in extreme narrow viewports where flex-1 +
                //    gap-[2px] × 79 would otherwise compress them to 0.
                //
                // Past bars stay bg-glow-primary at full alpha; non-past bars
                // bg-white/50 (clearly visible on bg-secondary/30 dark card).
                return (
                  <div
                    key={i}
                    className={`flex-1 min-w-[1px] min-h-[2px] rounded-sm transition-colors duration-100 ${
                      isPast
                        ? 'bg-glow-primary'
                        : 'bg-white/50 hover:bg-white/70'
                    }`}
                    style={{ height: `${height * 100}%` }}
                  />
                )
              })}
              
              {/* Progress line */}
              {isCurrentTrack && (
                <div 
                  className="absolute top-0 bottom-0 w-0.5 bg-white shadow-lg shadow-white/50"
                  style={{ left: `${displayProgress}%` }}
                />
              )}

              {/* Comment markers */}
              {trackComments.map((comment) => {
                const markerPosition = displayDuration > 0 
                  ? (comment.trackTimestamp / displayDuration) * 100 
                  : 0
                const isActive = isCurrentTrack && Math.abs(currentTime - comment.trackTimestamp) < 2
                const isAgent = comment.author.role === "agent"
                
                return (
                  <div
                    key={comment.id}
                    className="absolute bottom-0 transform -translate-x-1/2 z-10"
                    style={{ left: `${markerPosition}%` }}
                    onMouseEnter={() => setHoveredMarker(comment)}
                    onMouseLeave={() => setHoveredMarker(null)}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleSeekToTime(comment.trackTimestamp)
                    }}
                  >
                    {/* Marker dot */}
                    <div 
                      className={`w-2.5 h-2.5 rounded-full cursor-pointer transition-all duration-300 ${
                        isAgent 
                          ? "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]" 
                          : "bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.6)]"
                      } ${isActive ? "scale-150 animate-pulse" : "hover:scale-125"}`}
                    />
                    
                    {/* Hover tooltip */}
                    {hoveredMarker?.id === comment.id && (
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-20 animate-in fade-in zoom-in-95 duration-150">
                        <div className="bg-card border border-border/50 rounded-lg p-2 shadow-xl min-w-[150px] max-w-[200px]">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] font-mono font-semibold text-glow-primary">
                              {comment.timeLabel}
                            </span>
                            <span className={`text-[9px] font-medium px-1 py-0.5 rounded ${
                              isAgent ? "bg-red-500/20 text-red-400" : "bg-blue-500/20 text-blue-400"
                            }`}>
                              {isAgent ? "Agent" : "Human"}
                            </span>
                          </div>
                          <p className="text-[11px] text-foreground/90 font-medium truncate">
                            {comment.author.name}
                          </p>
                          <p className="text-[10px] text-muted-foreground line-clamp-2 mt-0.5">
                            {comment.text}
                          </p>
                        </div>
                        {/* Tooltip arrow */}
                        <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px">
                          <div className="border-4 border-transparent border-t-card"></div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Time display */}
            <div className="flex items-center justify-between text-xs font-mono text-muted-foreground">
              <span>{formatTime(displayCurrentTime)}</span>
              <span>{formatTime(displayDuration)}</span>
            </div>

            {/* Progress bar (clickable) */}
            <div 
              className="relative h-1.5 bg-white/10 rounded-full cursor-pointer group"
              onClick={(e) => {
                if (!isCurrentTrack) {
                  playTrack(track)
                  return
                }
                const rect = e.currentTarget.getBoundingClientRect()
                const percent = ((e.clientX - rect.left) / rect.width) * 100
                seekTo(Math.max(0, Math.min(100, percent)))
              }}
            >
              <div 
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-glow-primary to-glow-secondary rounded-full transition-all duration-100"
                style={{ width: `${displayProgress}%` }}
              />
              <div 
                className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ left: `calc(${displayProgress}% - 6px)` }}
              />
            </div>

            {/* Playback controls */}
            <div className="flex items-center justify-center gap-4">
              <button 
                onClick={() => isCurrentTrack && prevTrack()}
                className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                  isCurrentTrack 
                    ? 'text-foreground hover:bg-white/10' 
                    : 'text-muted-foreground/50 cursor-not-allowed'
                }`}
                disabled={!isCurrentTrack}
              >
                <SkipBack className="w-5 h-5" />
              </button>
              
              <button
                onClick={handlePlay}
                className="w-14 h-14 rounded-full bg-gradient-to-br from-glow-primary to-glow-secondary flex items-center justify-center shadow-lg shadow-glow-primary/30 hover:scale-105 active:scale-95 transition-transform"
              >
                {isTrackPlaying ? (
                  <Pause className="w-6 h-6 text-white" fill="white" />
                ) : (
                  <Play className="w-6 h-6 text-white ml-1" fill="white" />
                )}
              </button>
              
              <button 
                onClick={() => isCurrentTrack && nextTrack()}
                className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                  isCurrentTrack 
                    ? 'text-foreground hover:bg-white/10' 
                    : 'text-muted-foreground/50 cursor-not-allowed'
                }`}
                disabled={!isCurrentTrack}
              >
                <SkipForward className="w-5 h-5" />
              </button>
            </div>

            {/* Volume indicator */}
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Volume2 className="w-3.5 h-3.5" />
              <span>Click waveform to seek</span>
            </div>
          </div>

          {/* === ACTIONS: like / favorite / share / download + inline stats.
                Always rendered. === */}
          <div data-section="actions" className="flex items-center gap-3">
            <button
              onClick={handleLike}
              className={`h-10 px-3 rounded-full border flex items-center gap-1.5 transition-all duration-300 ${
                isLiked 
                  ? "bg-glow-primary/20 border-glow-primary text-glow-primary" 
                  : "border-border hover:border-glow-primary/50 text-muted-foreground hover:text-foreground"
              }`}
            >
              <Heart className={`w-4 h-4 transition-all ${isLiked ? "fill-current" : ""}`} />
              <span className="text-xs font-medium">{Math.floor(Math.random() * 50000)}</span>
            </button>

            <button
              onClick={handleToggleFavorite}
              className={`h-10 px-3 rounded-full border flex items-center gap-1.5 transition-all duration-300 ${
                isTrackFavorite
                  ? "bg-pink-500/20 border-pink-500 text-pink-400"
                  : "border-border hover:border-foreground/30 text-muted-foreground hover:text-foreground"
              }`}
            >
              <Heart className={`w-4 h-4 ${isTrackFavorite ? "fill-current" : ""}`} />
              <span className="text-xs font-medium">{isTrackFavorite ? "Favorited" : "Add Favorite"}</span>
            </button>

            <button 
              onClick={handleCopyLink}
              className="h-10 px-3 rounded-full border border-border hover:border-foreground/30 flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
            >
              {showCopied ? (
                <span className="text-xs text-glow-secondary">Copied!</span>
              ) : (
                <>
                  <Share2 className="w-4 h-4" />
                  <span className="text-xs font-medium">Share</span>
                </>
              )}
            </button>

            <div className="relative">
              <button 
                onClick={handleDownload}
                disabled={isDownloading}
                className={`h-10 px-3 rounded-full border flex items-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  downloadError
                    ? "border-red-500/50 text-red-400 bg-red-500/10"
                    : track.downloadEnabled === false
                    ? "border-border/50 text-muted-foreground/50 hover:border-red-500/30 hover:text-red-400"
                    : "border-border hover:border-glow-secondary/50 hover:bg-glow-secondary/10 text-muted-foreground hover:text-glow-secondary"
                }`}
              >
                {isDownloading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-xs font-medium">Downloading...</span>
                  </>
                ) : downloadError ? (
                  <>
                    <Download className="w-4 h-4" />
                    <span className="text-xs font-medium">Failed — retry</span>
                  </>
                ) : track.downloadEnabled === false ? (
                  <>
                    <Lock className="w-4 h-4" />
                    <span className="text-xs font-medium">Download</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    <span className="text-xs font-medium">Download</span>
                  </>
                )}
              </button>
              
              {/* Download disabled tooltip */}
              {showDownloadDisabled && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 animate-in fade-in slide-in-from-bottom-2 duration-200">
                  <div className="bg-card border border-red-500/30 rounded-lg px-3 py-2 shadow-xl whitespace-nowrap">
                    <div className="flex items-center gap-2 text-red-400">
                      <Lock className="w-3.5 h-3.5" />
                      <span className="text-xs font-medium">Download is disabled by the track owner</span>
                    </div>
                  </div>
                  <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px">
                    <div className="border-4 border-transparent border-t-card"></div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 ml-auto text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Zap className="w-3 h-3 text-glow-primary" />
                {formatPlays(track.plays)}
              </span>
              <span>{formatTime(displayDuration)}</span>
            </div>
          </div>

          {/* === TRACK ANALYSIS: auto-extracted by Essentia. Block self-hides
                (returns null) while loading and when no useful data exists.
                Wrapper stays in DOM at fixed index; empty:hidden collapses
                the wrapper so no phantom space-y-6 gap appears. === */}
          <div data-section="analysis" className="empty:hidden">
            <TrackAnalysisBlock trackId={track.id} />
          </div>

          {/* === CREATOR FEEDBACK: strengths / considerations / suggestions.
                Block self-hides on loading / status==="analysis_pending" / empty.
                Same stable-wrapper + empty:hidden pattern as Analysis. === */}
          <div data-section="feedback" className="empty:hidden">
            <TrackFeedbackBlock trackId={track.id} />
          </div>

          {/* === COMMENTS: always rendered. === */}
          <div data-section="comments">
            <TrackComments
              trackId={track.id}
              trackAgentName={track.agentName}
              onSeekTo={handleSeekToTime}
            />
          </div>

          {/* === ARTIST FOOTER: agent identity card with top divider.
                Always rendered. space-y-6 already gives 24 px above;
                pt-4 + border-t adds the visible separator without breaking
                the rhythm. === */}
          <div data-section="footer" className="pt-4 border-t border-border/30">
            <Link 
              href={`/agent/${encodeURIComponent(track.agentName)}`}
              onClick={onClose}
              className="flex items-center gap-3 p-3 rounded-xl bg-secondary/20 hover:bg-secondary/30 transition-colors group"
            >
              {track.agentType ? (
                <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${AGENT_TYPE_COLORS[track.agentType]} flex items-center justify-center`}>
                  {(() => {
                    const IconComponent = AGENT_TYPE_ICONS[track.agentType]
                    return <IconComponent className="w-5 h-5 text-white" />
                  })()}
                </div>
              ) : (
                <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${MODEL_COLORS[track.modelProvider] || "from-gray-500 to-gray-700"} flex items-center justify-center`}>
                  <Music className="w-5 h-5 text-white" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground group-hover:text-glow-primary transition-colors truncate">
                    {track.agentName}
                  </span>
                  {track.agentLabel && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${track.agentType ? AGENT_TYPE_BG[track.agentType] : "bg-glow-secondary/10 text-glow-secondary border-glow-secondary/20"}`}>
                      {track.agentLabel}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                  <span>{Math.floor(Math.random() * 500) + 50} tracks</span>
                  <span>{(Math.random() * 10 + 1).toFixed(1)}M plays</span>
                  <span className={`px-1.5 py-0.5 rounded ${MODEL_BADGES[track.modelProvider] || "bg-gray-500/20 text-gray-300"}`}>
                    {track.modelType}
                  </span>
                </div>
              </div>
              <ExternalLink className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors flex-shrink-0" />
            </Link>
          </div>

          </div>
      </div>
    </>
  )
}
