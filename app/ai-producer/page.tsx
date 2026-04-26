"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { useRouter } from "next/navigation"
import {
  Sparkles, FileAudio, Loader2, AlertCircle, Coins, ListMusic,
  Upload as UploadIcon, Music, ArrowRight, Lock, Check, Clock,
} from "lucide-react"
import { Sidebar } from "@/components/sidebar"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/components/auth-context"
import { supabase } from "@/lib/supabase"
import { uploadWithRetry } from "@/lib/upload-with-retry"

// Style/genre list — kept in sync with upload-track-modal GENRES.
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
] as const

const DAWS = [
  { id: "cubase", name: "Cubase" },
  { id: "fl_studio", name: "FL Studio" },
  { id: "ableton", name: "Ableton Live" },
  { id: "logic", name: "Logic Pro" },
  { id: "other", name: "Other" },
] as const

const FOCUS_AREAS = [
  { id: "mixing", name: "Mixing" },
  { id: "mastering", name: "Mastering" },
  { id: "arrangement", name: "Arrangement" },
  { id: "vocals", name: "Vocals" },
  { id: "bass", name: "Bass" },
  { id: "drums", name: "Drums" },
  { id: "melody", name: "Melody" },
  { id: "overall", name: "Overall quality" },
] as const

type Tab = "upload" | "select"

type ReviewListItem = {
  id: string
  title: string | null
  genre: string | null
  daw: string | null
  feedback_focus: string | null
  source_type: "uploaded_file" | "existing_track"
  status: "processing" | "ready" | "failed"
  access_type: "free" | "full"
  credits_used: number
  created_at: string
}

type MyTrack = {
  id: string
  title: string
  cover_url: string | null
  style: string | null
  audio_url: string | null
  original_audio_url: string | null
}

function guessAudioMime(name: string, fallback: string): string {
  const ext = name.split(".").pop()?.toLowerCase() || ""
  const map: Record<string, string> = {
    wav: "audio/wav",
    mp3: "audio/mpeg",
    flac: "audio/flac",
    aac: "audio/aac",
    ogg: "audio/ogg",
    m4a: "audio/mp4",
  }
  return fallback || map[ext] || "audio/mpeg"
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export default function AiProducerPage() {
  const router = useRouter()
  const { user, isAuthenticated, authReady, requireAuth } = useAuth()

  const [tab, setTab] = useState<Tab>("upload")

  // Top-block state
  const [credits, setCredits] = useState<number | null>(null)
  const [creditsLoading, setCreditsLoading] = useState(false)

  // Upload form state
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [title, setTitle] = useState("")
  const [genre, setGenre] = useState("")
  const [daw, setDaw] = useState("")
  const [focus, setFocus] = useState("")
  const [comment, setComment] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [submitStatus, setSubmitStatus] = useState("")
  const [submitError, setSubmitError] = useState<string | null>(null)
  const audioInputRef = useRef<HTMLInputElement>(null)

  // Select-from-my-tracks state
  const [myTracks, setMyTracks] = useState<MyTrack[]>([])
  const [myTracksLoading, setMyTracksLoading] = useState(false)
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null)

  // My Reviews
  const [reviews, setReviews] = useState<ReviewListItem[]>([])
  const [reviewsLoading, setReviewsLoading] = useState(false)
  const [reviewsError, setReviewsError] = useState<string | null>(null)

  const showAuthGate = authReady && !isAuthenticated

  // ── Initial loads ─────────────────────────────────────────────────────
  const fetchAuthHeaders = useCallback(async (): Promise<Record<string, string> | null> => {
    const { data } = await supabase.auth.getSession()
    const token = data?.session?.access_token
    if (!token) return null
    return { Authorization: `Bearer ${token}` }
  }, [])

  const refreshCredits = useCallback(async () => {
    if (!isAuthenticated) {
      setCredits(0)
      return
    }
    const headers = await fetchAuthHeaders()
    if (!headers) {
      setCredits(0)
      return
    }
    setCreditsLoading(true)
    try {
      const res = await fetch("/api/ai-producer/credits", { headers })
      if (res.ok) {
        const json = await res.json()
        setCredits(typeof json.credits_balance === "number" ? json.credits_balance : 0)
      } else {
        setCredits(0)
      }
    } catch {
      setCredits(0)
    } finally {
      setCreditsLoading(false)
    }
  }, [isAuthenticated, fetchAuthHeaders])

  const refreshReviews = useCallback(async () => {
    if (!isAuthenticated) {
      setReviews([])
      return
    }
    const headers = await fetchAuthHeaders()
    if (!headers) return
    setReviewsLoading(true)
    setReviewsError(null)
    try {
      const res = await fetch("/api/ai-producer/reviews", { headers })
      if (res.ok) {
        const json = await res.json()
        setReviews(Array.isArray(json.reviews) ? json.reviews : [])
      } else if (res.status === 404) {
        // List endpoint not deployed yet — keep empty state.
        setReviews([])
      } else {
        setReviewsError("Could not load your reviews.")
      }
    } catch {
      setReviewsError("Could not load your reviews.")
    } finally {
      setReviewsLoading(false)
    }
  }, [isAuthenticated, fetchAuthHeaders])

  const refreshMyTracks = useCallback(async () => {
    if (!user?.id) {
      setMyTracks([])
      return
    }
    setMyTracksLoading(true)
    try {
      const { data, error } = await supabase
        .from("tracks")
        .select("id, title, cover_url, style, audio_url, original_audio_url")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(100)
      if (error) {
        console.error("[ai-producer] my tracks load failed", error)
        setMyTracks([])
      } else {
        setMyTracks((data ?? []) as MyTrack[])
      }
    } catch (err) {
      console.error("[ai-producer] my tracks threw", err)
      setMyTracks([])
    } finally {
      setMyTracksLoading(false)
    }
  }, [user?.id])

  useEffect(() => {
    if (!authReady) return
    refreshCredits()
    refreshReviews()
    if (isAuthenticated) {
      refreshMyTracks()
    }
  }, [authReady, isAuthenticated, refreshCredits, refreshReviews, refreshMyTracks])

  // ── Upload + submit ───────────────────────────────────────────────────
  const handlePickFile = (file: File | null) => {
    setSubmitError(null)
    if (!file) {
      setAudioFile(null)
      return
    }
    const lower = file.name.toLowerCase()
    if (!lower.endsWith(".wav") && !lower.endsWith(".mp3")) {
      setSubmitError("Please pick a .wav or .mp3 file.")
      setAudioFile(null)
      return
    }
    setAudioFile(file)
    if (!title.trim()) {
      // Use filename (without extension) as a sensible default title.
      const stem = file.name.replace(/\.(wav|mp3)$/i, "")
      setTitle(stem.slice(0, 200))
    }
  }

  const submitUploadReview = async () => {
    setSubmitError(null)

    if (!audioFile) {
      setSubmitError("Please pick an audio file (.wav or .mp3).")
      return
    }
    if (!title.trim()) {
      setSubmitError("Please give your track a title.")
      return
    }

    const headers = await fetchAuthHeaders()
    if (!headers) {
      requireAuth(() => {})
      return
    }
    const userId = user?.id
    if (!userId) {
      requireAuth(() => {})
      return
    }

    setSubmitting(true)
    setSubmitStatus("Uploading audio…")
    try {
      // Upload private to a dedicated subfolder so AI Producer files
      // never get confused with regular Upload Track originals.
      const ts = Date.now()
      const ext = audioFile.name.split(".").pop()?.toLowerCase() || "mp3"
      const path = `ai-producer/${userId}/${ts}.${ext}`
      const mime = guessAudioMime(audioFile.name, audioFile.type)
      const { error: upErr } = await uploadWithRetry(
        () => supabase.storage.from("audio").upload(path, audioFile, {
          upsert: false,
          contentType: mime,
        }),
        "AI Producer audio upload",
      )
      if (upErr) {
        throw new Error(upErr.message || "Audio upload failed.")
      }
      const { data: pub } = supabase.storage.from("audio").getPublicUrl(path)
      const audioUrl = pub.publicUrl

      setSubmitStatus("Submitting for review…")
      const res = await fetch("/api/ai-producer/review", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          source_type: "uploaded_file",
          audio_url: audioUrl,
          title: title.trim() || null,
          genre: genre || null,
          daw: daw || null,
          feedback_focus: focus || null,
          comment: comment.trim() || null,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.review?.id) {
        throw new Error(json?.message || json?.error || "Could not create review.")
      }
      router.push(`/ai-producer/reviews/${json.review.id}`)
    } catch (err: any) {
      console.error("[ai-producer] submit failed", err)
      setSubmitError(err?.message || "Something went wrong. Please try again.")
      setSubmitting(false)
      setSubmitStatus("")
    }
  }

  const submitExistingTrackReview = async () => {
    setSubmitError(null)
    if (!selectedTrackId) {
      setSubmitError("Pick a track from the list first.")
      return
    }
    const picked = myTracks.find((t) => t.id === selectedTrackId)
    if (!picked) {
      setSubmitError("Selected track is no longer available.")
      return
    }
    const audioUrl = picked.audio_url || picked.original_audio_url
    if (!audioUrl) {
      setSubmitError("This track has no playable audio file.")
      return
    }

    const headers = await fetchAuthHeaders()
    if (!headers) {
      requireAuth(() => {})
      return
    }

    setSubmitting(true)
    setSubmitStatus("Submitting for review…")
    try {
      const res = await fetch("/api/ai-producer/review", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          source_type: "existing_track",
          audio_url: audioUrl,
          original_track_id: picked.id,
          title: (title.trim() || picked.title || "Untitled").slice(0, 200),
          genre: genre || picked.style || null,
          daw: daw || null,
          feedback_focus: focus || null,
          comment: comment.trim() || null,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.review?.id) {
        throw new Error(json?.message || json?.error || "Could not create review.")
      }
      router.push(`/ai-producer/reviews/${json.review.id}`)
    } catch (err: any) {
      console.error("[ai-producer] existing-track submit failed", err)
      setSubmitError(err?.message || "Something went wrong. Please try again.")
      setSubmitting(false)
      setSubmitStatus("")
    }
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return
    if (tab === "upload") {
      submitUploadReview()
    } else {
      submitExistingTrackReview()
    }
  }

  // ── Derived UI bits ───────────────────────────────────────────────────
  const creditsLabel = useMemo(() => {
    if (creditsLoading && credits === null) return "…"
    if (credits === null) return "0"
    return String(credits)
  }, [credits, creditsLoading])

  const willBeFreePreview = (credits ?? 0) < 1

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Sidebar />
      <main className="lg:ml-64 min-h-screen pb-32">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
          {/* ── Page header ─────────────────────────────────────────── */}
          <header className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-purple-600 to-fuchsia-600 flex items-center justify-center shadow-lg shadow-purple-900/30">
                <Sparkles className="w-6 h-6 text-white" />
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold">AI Producer Review</h1>
            </div>
            <p className="text-muted-foreground max-w-2xl">
              Upload a track or select one of your existing tracks to get
              professional AI feedback with timestamps and production notes.
            </p>
          </header>

          {/* ── Top block: credits + buy + cost ─────────────────────── */}
          <section className="rounded-2xl border border-purple-500/20 bg-gradient-to-br from-purple-950/30 via-card/40 to-fuchsia-950/20 p-5 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-purple-500/20 border border-purple-400/30 flex items-center justify-center">
                  <Coins className="w-6 h-6 text-purple-300" />
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wider text-purple-300/80 font-mono">
                    Credits balance
                  </div>
                  <div className="text-2xl font-bold">
                    {creditsLabel} <span className="text-sm font-normal text-muted-foreground">credits</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Review cost: <span className="text-foreground font-medium">1 credit</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="border-purple-400/40 text-purple-200 hover:bg-purple-500/10 hover:text-white"
                  onClick={() => {
                    // Placeholder — payment flow lands in a later stage.
                    alert("Buying credits will be available soon.")
                  }}
                >
                  Buy Credits
                </Button>
              </div>
            </div>
            {willBeFreePreview && (
              <div className="mt-4 flex items-start gap-2 text-xs text-purple-200/90 bg-purple-500/10 border border-purple-400/20 rounded-lg px-3 py-2">
                <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>
                  You can run a free preview now. Full report unlocks with credits.
                </span>
              </div>
            )}
          </section>

          {/* ── Auth gate ───────────────────────────────────────────── */}
          {showAuthGate && (
            <section className="rounded-2xl border border-border/50 bg-card/40 p-6 text-center space-y-3">
              <div className="text-lg font-semibold">Sign in to start a review</div>
              <p className="text-sm text-muted-foreground">
                Create an account or log in to upload a track and run an AI Producer Review.
              </p>
              <Button onClick={() => requireAuth(() => {})}>Log in</Button>
            </section>
          )}

          {/* ── Main form block ─────────────────────────────────────── */}
          {!showAuthGate && (
            <section className="rounded-2xl border border-border/50 bg-card/40">
              <div className="p-5 sm:p-6 border-b border-border/50">
                <h2 className="text-xl font-bold">Start New Review</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Get detailed feedback on your track before publishing or improving it in your DAW.
                </p>
              </div>

              {/* Tabs */}
              <div className="px-5 sm:px-6 pt-4">
                <div className="inline-flex rounded-xl bg-background/40 border border-border/50 p-1">
                  <button
                    type="button"
                    onClick={() => setTab("upload")}
                    className={`px-4 py-2 text-sm font-medium rounded-lg flex items-center gap-2 transition-colors ${
                      tab === "upload"
                        ? "bg-purple-600 text-white"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <UploadIcon className="w-4 h-4" />
                    Upload Track for Review
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab("select")}
                    className={`px-4 py-2 text-sm font-medium rounded-lg flex items-center gap-2 transition-colors ${
                      tab === "select"
                        ? "bg-purple-600 text-white"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <ListMusic className="w-4 h-4" />
                    Select from My Tracks
                  </button>
                </div>
              </div>

              <form onSubmit={onSubmit} className="p-5 sm:p-6 space-y-5">
                {tab === "upload" ? (
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Audio file
                    </label>
                    <div
                      className={`mt-2 border border-dashed rounded-xl px-4 py-6 flex items-center gap-4 cursor-pointer transition-colors ${
                        audioFile
                          ? "border-purple-400/50 bg-purple-500/5"
                          : "border-border/60 hover:border-purple-400/40 hover:bg-purple-500/5"
                      }`}
                      onClick={() => audioInputRef.current?.click()}
                    >
                      <div className="w-10 h-10 rounded-lg bg-purple-500/20 border border-purple-400/30 flex items-center justify-center">
                        <FileAudio className="w-5 h-5 text-purple-200" />
                      </div>
                      <div className="flex-1 min-w-0">
                        {audioFile ? (
                          <>
                            <div className="text-sm font-medium truncate">{audioFile.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {(audioFile.size / 1024 / 1024).toFixed(2)} MB
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="text-sm font-medium">Click to choose a .wav or .mp3 file</div>
                            <div className="text-xs text-muted-foreground">
                              Files are uploaded privately and never published.
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                    <input
                      ref={audioInputRef}
                      type="file"
                      accept=".wav,.mp3,audio/wav,audio/mpeg"
                      className="hidden"
                      onChange={(e) => handlePickFile(e.target.files?.[0] ?? null)}
                    />
                  </div>
                ) : (
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Pick a track
                    </label>
                    <div className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-border/50 bg-background/40 divide-y divide-border/40">
                      {myTracksLoading ? (
                        <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Loading your tracks…
                        </div>
                      ) : myTracks.length === 0 ? (
                        <div className="px-4 py-8 text-center space-y-2">
                          <Music className="w-8 h-8 mx-auto text-muted-foreground/60" />
                          <div className="text-sm text-muted-foreground">
                            You don't have any tracks yet.
                          </div>
                          <Link
                            href="/my-tracks"
                            className="text-sm text-purple-300 hover:text-purple-200 inline-flex items-center gap-1"
                          >
                            Go to My Tracks <ArrowRight className="w-3.5 h-3.5" />
                          </Link>
                        </div>
                      ) : (
                        myTracks.map((t) => {
                          const active = selectedTrackId === t.id
                          return (
                            <button
                              type="button"
                              key={t.id}
                              onClick={() => setSelectedTrackId(t.id)}
                              className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                                active
                                  ? "bg-purple-500/15"
                                  : "hover:bg-white/5"
                              }`}
                            >
                              <div className="w-10 h-10 rounded-lg overflow-hidden bg-muted/40 flex items-center justify-center shrink-0">
                                {t.cover_url ? (
                                  <Image
                                    src={t.cover_url}
                                    alt={t.title}
                                    width={40}
                                    height={40}
                                    className="object-cover w-10 h-10"
                                  />
                                ) : (
                                  <Music className="w-4 h-4 text-muted-foreground" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium truncate">{t.title}</div>
                                <div className="text-xs text-muted-foreground truncate">
                                  {t.style || "—"}
                                </div>
                              </div>
                              {active && <Check className="w-4 h-4 text-purple-300" />}
                            </button>
                          )
                        })
                      )}
                    </div>
                  </div>
                )}

                {/* Title */}
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Track title
                  </label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={200}
                    placeholder="e.g. Midnight Drive"
                    className="mt-2 w-full px-3 py-2 rounded-lg bg-background/40 border border-border/50 focus:border-purple-400/60 focus:outline-none text-sm"
                  />
                </div>

                {/* Genre + DAW row */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Genre / style
                    </label>
                    <select
                      value={genre}
                      onChange={(e) => setGenre(e.target.value)}
                      className="mt-2 w-full px-3 py-2 rounded-lg bg-background/40 border border-border/50 focus:border-purple-400/60 focus:outline-none text-sm"
                    >
                      <option value="">Select a style…</option>
                      {GENRES.map((g) => (
                        <option key={g.id} value={g.id}>{g.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      DAW used
                    </label>
                    <select
                      value={daw}
                      onChange={(e) => setDaw(e.target.value)}
                      className="mt-2 w-full px-3 py-2 rounded-lg bg-background/40 border border-border/50 focus:border-purple-400/60 focus:outline-none text-sm"
                    >
                      <option value="">Select your DAW…</option>
                      {DAWS.map((d) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Focus area */}
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    What do you want feedback on?
                  </label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {FOCUS_AREAS.map((f) => {
                      const active = focus === f.id
                      return (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => setFocus(active ? "" : f.id)}
                          className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                            active
                              ? "bg-purple-600 border-purple-400 text-white"
                              : "border-border/60 text-muted-foreground hover:text-foreground hover:border-purple-400/40"
                          }`}
                        >
                          {f.name}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Comment */}
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Comment <span className="font-normal text-muted-foreground/70 normal-case">(optional)</span>
                  </label>
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    rows={3}
                    maxLength={4000}
                    placeholder="Anything specific you want the AI to listen for?"
                    className="mt-2 w-full px-3 py-2 rounded-lg bg-background/40 border border-border/50 focus:border-purple-400/60 focus:outline-none text-sm resize-none"
                  />
                </div>

                {submitError && (
                  <div className="flex items-start gap-2 text-sm text-red-300 bg-red-500/10 border border-red-400/30 rounded-lg px-3 py-2">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>{submitError}</span>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
                  <div className="text-xs text-muted-foreground">
                    {willBeFreePreview
                      ? "This will run as a free preview (locked sections)."
                      : "1 credit will be used for this review."}
                  </div>
                  <Button
                    type="submit"
                    disabled={submitting}
                    className="bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:opacity-90 text-white font-semibold"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        {submitStatus || "Working…"}
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4 mr-2" />
                        Run AI Producer Review
                      </>
                    )}
                  </Button>
                </div>
              </form>
            </section>
          )}

          {/* ── My Reviews ──────────────────────────────────────────── */}
          {!showAuthGate && (
            <section className="rounded-2xl border border-border/50 bg-card/40">
              <div className="p-5 sm:p-6 border-b border-border/50 flex items-center justify-between">
                <h2 className="text-xl font-bold">My Reviews</h2>
                {reviewsLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
              </div>
              <div className="p-5 sm:p-6">
                {reviews.length === 0 ? (
                  <div className="text-center py-8 space-y-2">
                    <div className="w-12 h-12 mx-auto rounded-xl bg-purple-500/10 border border-purple-400/20 flex items-center justify-center">
                      <Sparkles className="w-5 h-5 text-purple-300/70" />
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {reviewsError
                        ? reviewsError
                        : "Your reviews will appear here after you run your first AI Producer Review."}
                    </div>
                  </div>
                ) : (
                  <ul className="divide-y divide-border/40">
                    {reviews.map((r) => (
                      <li key={r.id}>
                        <Link
                          href={`/ai-producer/reviews/${r.id}`}
                          className="flex items-center gap-3 py-3 px-1 hover:bg-white/5 rounded-lg transition-colors"
                        >
                          <div className="w-9 h-9 rounded-lg bg-purple-500/15 border border-purple-400/20 flex items-center justify-center shrink-0">
                            {r.status === "processing" ? (
                              <Clock className="w-4 h-4 text-purple-300 animate-pulse" />
                            ) : r.status === "failed" ? (
                              <AlertCircle className="w-4 h-4 text-red-300" />
                            ) : (
                              <Sparkles className="w-4 h-4 text-purple-300" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">
                              {r.title || "Untitled review"}
                            </div>
                            <div className="text-xs text-muted-foreground truncate">
                              {[
                                r.genre,
                                r.daw,
                                r.feedback_focus,
                                formatDate(r.created_at),
                              ].filter(Boolean).join(" · ")}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span
                              className={`text-[10px] uppercase tracking-wider font-mono px-2 py-0.5 rounded-full border ${
                                r.access_type === "full"
                                  ? "bg-emerald-500/10 border-emerald-400/30 text-emerald-300"
                                  : "bg-purple-500/10 border-purple-400/30 text-purple-300"
                              }`}
                            >
                              {r.access_type === "full" ? "Full" : "Preview"}
                            </span>
                            <ArrowRight className="w-4 h-4 text-muted-foreground" />
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  )
}
