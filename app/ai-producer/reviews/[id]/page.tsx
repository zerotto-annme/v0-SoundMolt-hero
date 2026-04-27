"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import {
  Sparkles, Loader2, AlertCircle, Lock, ArrowLeft, RefreshCcw,
  Download, Copy, Sliders, Disc3, Layers, Wand2, TrendingUp,
  Clock, ListChecks, FileText, Check, Music,
} from "lucide-react"
import { Sidebar } from "@/components/sidebar"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/components/auth-context"
import { supabase } from "@/lib/supabase"

// ─── Types ──────────────────────────────────────────────────────────────
type ReportSection = {
  score?: number | null
  notes?: string[] | null
  text?: string | null
}

type Recommendation =
  | string
  | {
      timestamp?: string | null
      text?: string | null
      target?: string | null
    }

type ReportJson = {
  version?: number
  generated_at?: string
  summary?: string
  overall_score?: number
  sections?: {
    mix?: ReportSection
    mastering?: ReportSection
    arrangement?: ReportSection
    sound_design?: ReportSection
    commercial_potential?: ReportSection
  }
  recommendations?: Recommendation[]
  daw_instructions?: string[] | string
  full_analysis?: unknown
  references?: string[]
}

type Review = {
  id: string
  user_id: string
  track_id: string | null
  original_track_id: string | null
  source_type: "uploaded_file" | "existing_track"
  audio_url: string
  title: string | null
  genre: string | null
  daw: string | null
  feedback_focus: string | null
  comment: string | null
  status: "processing" | "ready" | "failed"
  report_json: ReportJson | null
  access_type: "free" | "full"
  credits_used: number
  created_at: string
  updated_at: string
}

// ─── Display helpers ────────────────────────────────────────────────────
const DAW_LABELS: Record<string, string> = {
  cubase: "Cubase",
  fl_studio: "FL Studio",
  ableton: "Ableton Live",
  logic: "Logic Pro",
  other: "Other",
}

const GENRE_LABELS: Record<string, string> = {
  auto: "Auto",
  lofi: "Lo-Fi",
  techno: "Techno",
  ambient: "Ambient",
  synthwave: "Synthwave",
  trap: "Trap",
  cinematic: "Cinematic",
  electronic: "Electronic",
  house: "House",
  dnb: "Drum & Bass",
  experimental: "Experimental",
}

function dawLabel(id: string | null): string | null {
  if (!id) return null
  return DAW_LABELS[id] ?? id
}

function genreLabel(id: string | null): string | null {
  if (!id) return null
  return GENRE_LABELS[id.toLowerCase()] ?? id
}

/**
 * Build the "Genre: …" display string. When the user picked Auto in the
 * form (review.genre === "auto") we prefix the auto-detected label with
 * "Auto-detected"; manual selections render plainly. Falls back to the
 * raw stored value when the report does not carry the new fields (older
 * rows generated before genre auto-detection landed).
 */
function buildGenreDisplay(
  reviewGenre: string | null,
  reportGenreSource: unknown,
  reportFinalGenre: unknown,
  reportDetectedGenre: unknown,
): string | null {
  const source =
    reportGenreSource === "auto" || reportGenreSource === "manual"
      ? (reportGenreSource as "auto" | "manual")
      : (reviewGenre && reviewGenre.toLowerCase() === "auto" ? "auto" : "manual")
  const finalGenre =
    typeof reportFinalGenre === "string" && reportFinalGenre.trim()
      ? reportFinalGenre.trim()
      : typeof reportDetectedGenre === "string" && reportDetectedGenre.trim()
        ? reportDetectedGenre.trim()
        : null
  if (source === "auto") {
    const label = genreLabel(finalGenre)
    return label ? `Auto-detected ${label}` : "Auto"
  }
  return genreLabel(reviewGenre)
}

function formatRecommendation(rec: Recommendation): string {
  if (typeof rec === "string") return rec
  const parts: string[] = []
  if (rec.timestamp) parts.push(`[${rec.timestamp}]`)
  if (rec.target) parts.push(`${rec.target}:`)
  if (rec.text) parts.push(rec.text)
  return parts.join(" ").trim() || "—"
}

// ─── Tiny shared bits ───────────────────────────────────────────────────
function StatusBadge({ status }: { status: Review["status"] }) {
  if (status === "ready") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wider font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-400/30 text-emerald-300">
        <Check className="w-3 h-3" /> Ready
      </span>
    )
  }
  if (status === "processing") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wider font-mono px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-400/30 text-amber-300">
        <Clock className="w-3 h-3 animate-pulse" /> Processing
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wider font-mono px-2 py-0.5 rounded-full bg-red-500/10 border border-red-400/30 text-red-300">
      <AlertCircle className="w-3 h-3" /> Failed
    </span>
  )
}

function AccessBadge({ access }: { access: Review["access_type"] }) {
  if (access === "full") {
    return (
      <span className="text-[11px] uppercase tracking-wider font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-400/30 text-emerald-300">
        Full
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wider font-mono px-2 py-0.5 rounded-full bg-purple-500/10 border border-purple-400/30 text-purple-300">
      <Lock className="w-3 h-3" /> Free Preview
    </span>
  )
}

function ScoreRing({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, score))
  const radius = 42
  const circ = 2 * Math.PI * radius
  const dash = (clamped / 100) * circ
  const color =
    clamped >= 80 ? "stroke-emerald-400"
    : clamped >= 60 ? "stroke-purple-400"
    : "stroke-amber-400"
  return (
    <div className="relative w-28 h-28 shrink-0">
      <svg viewBox="0 0 100 100" className="w-28 h-28 -rotate-90">
        <circle cx="50" cy="50" r={radius} className="stroke-border/40 fill-none" strokeWidth="8" />
        <circle
          cx="50" cy="50" r={radius}
          className={`${color} fill-none transition-[stroke-dashoffset] duration-500`}
          strokeWidth="8" strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ - dash}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-2xl font-bold">{clamped}</div>
        <div className="text-[10px] text-muted-foreground uppercase tracking-wider">/ 100</div>
      </div>
    </div>
  )
}

function SectionCard({
  icon: Icon,
  title,
  score,
  children,
}: {
  icon: any
  title: string
  score?: number | null
  children: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-border/50 bg-card/40 p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-purple-500/15 border border-purple-400/20 flex items-center justify-center">
            <Icon className="w-4 h-4 text-purple-300" />
          </div>
          <h3 className="text-base font-semibold">{title}</h3>
        </div>
        {typeof score === "number" && (
          <span className="text-xs font-mono text-muted-foreground">
            <span className="text-foreground font-semibold">{score}</span> / 100
          </span>
        )}
      </div>
      <div className="text-sm text-muted-foreground space-y-1.5">
        {children}
      </div>
    </div>
  )
}

function NotesList({ notes }: { notes: string[] | null | undefined }) {
  if (!notes || notes.length === 0) {
    return <div className="text-muted-foreground/70 italic">No notes available.</div>
  }
  return (
    <ul className="list-disc list-inside space-y-1">
      {notes.map((n, i) => (
        <li key={i}>{n}</li>
      ))}
    </ul>
  )
}

// ─── Page ───────────────────────────────────────────────────────────────
export default function ReviewReportPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const { authReady, isAuthenticated, requireAuth } = useAuth()

  const reviewId = typeof params?.id === "string" ? params.id : ""

  const [review, setReview] = useState<Review | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const fetchReview = useCallback(async () => {
    if (!reviewId) return
    setError(null)
    setLoading(true)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess?.session?.access_token
      if (!token) {
        setError("auth_required")
        setLoading(false)
        return
      }
      const res = await fetch(`/api/ai-producer/reviews/${reviewId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.status === 404) {
        setError("not_found")
      } else if (res.status === 401) {
        setError("auth_required")
      } else if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j?.message || "Could not load review.")
      } else {
        const j = await res.json()
        setReview(j.review as Review)
      }
    } catch (err: any) {
      setError(err?.message || "Could not load review.")
    } finally {
      setLoading(false)
    }
  }, [reviewId])

  useEffect(() => {
    if (!authReady) return
    fetchReview()
  }, [authReady, fetchReview])

  // Light polling while a review is still processing.
  useEffect(() => {
    if (!review || review.status !== "processing") return
    const t = setInterval(fetchReview, 3000)
    return () => clearInterval(t)
  }, [review, fetchReview])

  // ── Derived data ────────────────────────────────────────────────────
  const report = review?.report_json ?? null
  const isFree = review?.access_type === "free"

  const recommendationsList = useMemo<string[]>(() => {
    if (!report?.recommendations || !Array.isArray(report.recommendations)) return []
    return report.recommendations.map(formatRecommendation)
  }, [report])

  const dawInstructionsList = useMemo<string[]>(() => {
    const v = report?.daw_instructions
    if (!v) return []
    if (Array.isArray(v)) return v
    return v.split("\n").map((s) => s.trim()).filter(Boolean)
  }, [report])

  // Build the COMPLETE report text for the Copy button. Supports both the
  // current report_json shape and any older variant by reading defensively
  // (typeof checks, optional chaining, array fallbacks).
  const buildFullReportText = useCallback((): string => {
    const lines: string[] = []
    const r = report as Record<string, unknown> | null

    // ── Header ─────────────────────────────────────────────────────────
    if (review?.title) lines.push(`Track: ${review.title}`)
    if (review?.daw) {
      const lbl = dawLabel(review.daw)
      if (lbl) lines.push(`DAW: ${lbl}`)
    }
    const genreDisplay = buildGenreDisplay(
      review?.genre ?? null,
      r?.genre_source,
      r?.final_genre_used,
      r?.detected_genre,
    )
    if (genreDisplay) lines.push(`Genre: ${genreDisplay}`)
    if (review?.feedback_focus) lines.push(`Focus: ${review.feedback_focus}`)
    if (typeof review?.credits_used === "number") {
      lines.push(`Credits used: ${review.credits_used}`)
    }
    if (lines.length) lines.push("")

    // For free-tier reviews only the unlocked sections (Summary, Overall
    // Score, Mix Balance) are shown on screen. Don't leak locked content
    // through Copy.
    const includeLocked = !isFree

    // ── Summary ────────────────────────────────────────────────────────
    if (typeof report?.summary === "string" && report.summary.trim()) {
      lines.push("=== SUMMARY ===")
      lines.push(report.summary.trim())
      lines.push("")
    }

    // ── Overall Score ──────────────────────────────────────────────────
    if (typeof report?.overall_score === "number") {
      lines.push("=== OVERALL SCORE ===")
      lines.push(`${report.overall_score} / 100`)
      lines.push("")
    }

    const renderSection = (title: string, sec: ReportSection | undefined | null) => {
      if (!sec) return
      const hasScore = typeof sec.score === "number"
      const hasText = typeof sec.text === "string" && sec.text.trim().length > 0
      const hasNotes = Array.isArray(sec.notes) && sec.notes.length > 0
      if (!hasScore && !hasText && !hasNotes) return
      lines.push(`=== ${title.toUpperCase()} ===`)
      if (hasScore) lines.push(`Score: ${sec.score} / 100`)
      if (hasText) lines.push((sec.text as string).trim())
      if (hasNotes) {
        for (const n of sec.notes as string[]) {
          if (typeof n === "string" && n.trim()) lines.push(`- ${n.trim()}`)
        }
      }
      lines.push("")
    }

    renderSection("Mix Balance", report?.sections?.mix)

    if (includeLocked) {
      renderSection("Mastering", report?.sections?.mastering)
      renderSection("Arrangement", report?.sections?.arrangement)
      renderSection("Sound Design", report?.sections?.sound_design)
      renderSection("Commercial Potential", report?.sections?.commercial_potential)

      // ── Timestamped Recommendations ──────────────────────────────────
      if (recommendationsList.length > 0) {
        lines.push("=== TIMESTAMPED RECOMMENDATIONS ===")
        recommendationsList.forEach((rec) => lines.push(`- ${rec}`))
        lines.push("")
      }

      // ── DAW Instructions ─────────────────────────────────────────────
      if (dawInstructionsList.length > 0) {
        lines.push("=== DAW INSTRUCTIONS ===")
        dawInstructionsList.forEach((d, i) => {
          lines.push(`[${i + 1}]`)
          lines.push(d)
          lines.push("")
        })
      }

      // ── Full Analysis (supports old string + current object shape) ───
      const fa = report?.full_analysis
      let faText = ""
      if (typeof fa === "string") {
        faText = fa.trim()
      } else if (fa && typeof fa === "object") {
        const o = fa as Record<string, unknown>
        const exec = typeof o.executive_summary === "string" ? o.executive_summary.trim() : ""
        const det = typeof o.detailed_analysis === "string" ? o.detailed_analysis.trim() : ""
        const adv = Array.isArray(o.advanced_improvements)
          ? (o.advanced_improvements as unknown[])
              .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
              .map((x) => `- ${x.trim()}`)
              .join("\n")
          : typeof o.advanced_improvements === "string"
            ? o.advanced_improvements.trim()
            : ""
        const parts: string[] = []
        if (exec) parts.push(exec)
        if (det) parts.push(det)
        if (adv) parts.push("--- ADVANCED IMPROVEMENTS ---\n" + adv)
        faText = parts.join("\n\n")
      }
      if (faText) {
        lines.push("=== FULL ANALYSIS ===")
        lines.push(faText)
        lines.push("")
      }
    }

    return lines.join("\n").trim()
  }, [review, report, recommendationsList, dawInstructionsList, isFree])

  // Robust clipboard copy with textarea fallback for browsers / contexts
  // where navigator.clipboard is unavailable (insecure context, older
  // browsers, etc.).
  const copyTextToClipboard = async (text: string): Promise<boolean> => {
    if (
      typeof navigator !== "undefined" &&
      navigator.clipboard &&
      typeof window !== "undefined" &&
      window.isSecureContext
    ) {
      try {
        await navigator.clipboard.writeText(text)
        return true
      } catch {
        /* fall through to textarea fallback */
      }
    }
    try {
      const ta = document.createElement("textarea")
      ta.value = text
      ta.setAttribute("readonly", "")
      ta.style.position = "fixed"
      ta.style.left = "-9999px"
      ta.style.top = "0"
      ta.style.opacity = "0"
      document.body.appendChild(ta)
      ta.focus()
      ta.select()
      ta.setSelectionRange(0, text.length)
      const ok = document.execCommand("copy")
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }

  const handleCopyRecommendations = async () => {
    const text = buildFullReportText() || "(nothing to copy)"
    const ok = await copyTextToClipboard(text)
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } else {
      alert("Could not copy to clipboard.")
    }
  }

  const handleDownloadPdf = () => {
    if (typeof window === "undefined") return
    // Browser print-to-PDF. Print styles in app/globals.css hide the
    // sidebar / action buttons / back link / free-tier upsell overlay so
    // only the AI Producer report content is printed.
    window.print()
  }

  // ─── Render branches ────────────────────────────────────────────────
  const Layout = ({ children }: { children: React.ReactNode }) => (
    <div className="min-h-screen bg-background text-foreground">
      <div className="no-print">
        <Sidebar />
      </div>
      <main className="lg:ml-64 min-h-screen pb-32">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
          <div className="no-print">
            <Link
              href="/ai-producer"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-4 h-4" /> Back to AI Producer
            </Link>
          </div>
          <div className="printable-report space-y-6">{children}</div>
        </div>
      </main>
    </div>
  )

  if (!authReady || loading) {
    return (
      <Layout>
        <div className="rounded-2xl border border-border/50 bg-card/40 p-10 flex items-center justify-center text-muted-foreground">
          <Loader2 className="w-5 h-5 mr-2 animate-spin" />
          Loading review…
        </div>
      </Layout>
    )
  }

  if (error === "auth_required" || (authReady && !isAuthenticated)) {
    return (
      <Layout>
        <div className="rounded-2xl border border-border/50 bg-card/40 p-8 text-center space-y-3">
          <div className="text-lg font-semibold">Sign in to view this review</div>
          <p className="text-sm text-muted-foreground">
            AI Producer reviews are private to the account that created them.
          </p>
          <Button onClick={() => requireAuth(() => fetchReview())}>Log in</Button>
        </div>
      </Layout>
    )
  }

  if (error === "not_found") {
    return (
      <Layout>
        <div className="rounded-2xl border border-border/50 bg-card/40 p-8 text-center space-y-3">
          <div className="text-lg font-semibold">Review not found</div>
          <p className="text-sm text-muted-foreground">
            This review doesn't exist or belongs to another account.
          </p>
          <Link href="/ai-producer">
            <Button variant="outline">Back to AI Producer</Button>
          </Link>
        </div>
      </Layout>
    )
  }

  if (error) {
    return (
      <Layout>
        <div className="rounded-2xl border border-red-400/30 bg-red-500/10 p-6 text-sm text-red-200 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="font-semibold mb-1">Could not load review</div>
            <div>{error}</div>
            <Button
              size="sm"
              variant="outline"
              className="mt-3 border-red-400/40 text-red-200 hover:bg-red-500/10"
              onClick={fetchReview}
            >
              <RefreshCcw className="w-4 h-4 mr-2" /> Try again
            </Button>
          </div>
        </div>
      </Layout>
    )
  }

  if (!review) return null

  // ── Header card (shown for every status) ───────────────────────────
  const headerCard = (
    <header className="rounded-2xl border border-purple-500/20 bg-gradient-to-br from-purple-950/30 via-card/40 to-fuchsia-950/20 p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-600 to-fuchsia-600 flex items-center justify-center shadow-lg shadow-purple-900/30 shrink-0">
          <Sparkles className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold truncate">
              {review.title || "Untitled review"}
            </h1>
            <StatusBadge status={review.status} />
            <AccessBadge access={review.access_type} />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {dawLabel(review.daw) && (
              <span><span className="text-foreground/80 font-medium">DAW:</span> {dawLabel(review.daw)}</span>
            )}
            {(() => {
              const r = report as Record<string, unknown> | null
              const display = buildGenreDisplay(
                review.genre,
                r?.genre_source,
                r?.final_genre_used,
                r?.detected_genre,
              )
              return display ? (
                <span><span className="text-foreground/80 font-medium">Genre:</span> {display}</span>
              ) : null
            })()}
            <span><span className="text-foreground/80 font-medium">Credits used:</span> {review.credits_used}</span>
            {review.feedback_focus && (
              <span><span className="text-foreground/80 font-medium">Focus:</span> {review.feedback_focus}</span>
            )}
          </div>
        </div>
      </div>
    </header>
  )

  // ── Processing ─────────────────────────────────────────────────────
  if (review.status === "processing") {
    return (
      <Layout>
        {headerCard}
        <div className="rounded-2xl border border-border/50 bg-card/40 p-10 text-center space-y-4">
          <div className="w-12 h-12 mx-auto rounded-xl bg-purple-500/15 border border-purple-400/30 flex items-center justify-center">
            <Loader2 className="w-6 h-6 text-purple-300 animate-spin" />
          </div>
          <div>
            <div className="text-lg font-semibold">Your AI Producer Review is being generated.</div>
            <p className="text-sm text-muted-foreground mt-1">
              This usually takes less than a minute. We'll refresh automatically.
            </p>
          </div>
        </div>
      </Layout>
    )
  }

  // ── Failed ─────────────────────────────────────────────────────────
  if (review.status === "failed") {
    return (
      <Layout>
        {headerCard}
        <div className="rounded-2xl border border-red-400/30 bg-red-500/10 p-8 text-center space-y-4">
          <div className="w-12 h-12 mx-auto rounded-xl bg-red-500/15 border border-red-400/30 flex items-center justify-center">
            <AlertCircle className="w-6 h-6 text-red-300" />
          </div>
          <div>
            <div className="text-lg font-semibold text-red-100">Review failed.</div>
            <p className="text-sm text-red-200/80 mt-1">Please run a new review.</p>
          </div>
          <Link href="/ai-producer">
            <Button className="bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:opacity-90">
              <Sparkles className="w-4 h-4 mr-2" /> Run New Review
            </Button>
          </Link>
        </div>
      </Layout>
    )
  }

  // ── Ready: full report ─────────────────────────────────────────────
  const overallScore = typeof report?.overall_score === "number" ? report.overall_score : null
  const summary = report?.summary || null
  const mix = report?.sections?.mix
  const mastering = report?.sections?.mastering
  const arrangement = report?.sections?.arrangement
  const soundDesign = report?.sections?.sound_design
  const commercial = report?.sections?.commercial_potential

  // Action buttons (top right of header). Hidden in print output.
  const actionsRow = (
    <div className="flex flex-wrap items-center gap-2 no-print">
      <Button
        variant="outline"
        size="sm"
        onClick={handleDownloadPdf}
        title="Download / print this review as PDF"
      >
        <Download className="w-4 h-4 mr-2" /> Download PDF
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={handleCopyRecommendations}
        title="Copy the full report text to clipboard"
      >
        {copied ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
        {copied ? "Copied!" : "Copy Recommendations"}
      </Button>
      <Link href="/ai-producer">
        <Button size="sm" className="bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:opacity-90">
          <Sparkles className="w-4 h-4 mr-2" /> Run New Review
        </Button>
      </Link>
    </div>
  )

  // Always-visible blocks (Track info already in headerCard, then Summary,
  // Overall Score, Mix Balance).
  const summaryAndScore = (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="md:col-span-2 rounded-2xl border border-border/50 bg-card/40 p-5">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-8 h-8 rounded-lg bg-purple-500/15 border border-purple-400/20 flex items-center justify-center">
            <FileText className="w-4 h-4 text-purple-300" />
          </div>
          <h3 className="text-base font-semibold">Summary</h3>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {summary || "No summary available."}
        </p>
      </div>
      <div className="rounded-2xl border border-border/50 bg-card/40 p-5 flex items-center gap-4">
        <ScoreRing score={overallScore ?? 0} />
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-mono">
            Overall Score
          </div>
          <div className="text-sm text-muted-foreground mt-1">
            {overallScore === null ? "Not scored yet." : "Your track's overall rating."}
          </div>
        </div>
      </div>
    </div>
  )

  const mixBlock = (
    <SectionCard icon={Sliders} title="Mix Balance" score={mix?.score}>
      {mix?.text && <p className="whitespace-pre-line">{mix.text}</p>}
      <NotesList notes={mix?.notes ?? null} />
    </SectionCard>
  )

  // Locked-zone content (rendered for both free + full; in free we wrap
  // it with a blurred overlay).
  const lockedContent = (
    <div className="space-y-4">
      <SectionCard icon={Disc3} title="Mastering" score={mastering?.score}>
        {mastering?.text && <p className="whitespace-pre-line">{mastering.text}</p>}
        <NotesList notes={mastering?.notes ?? null} />
      </SectionCard>

      <SectionCard icon={Layers} title="Arrangement" score={arrangement?.score}>
        {arrangement?.text && <p className="whitespace-pre-line">{arrangement.text}</p>}
        <NotesList notes={arrangement?.notes ?? null} />
      </SectionCard>

      <SectionCard icon={Wand2} title="Sound Design" score={soundDesign?.score}>
        {soundDesign?.text && <p className="whitespace-pre-line">{soundDesign.text}</p>}
        <NotesList notes={soundDesign?.notes ?? null} />
      </SectionCard>

      <SectionCard icon={TrendingUp} title="Commercial Potential" score={commercial?.score}>
        {commercial?.text && <p className="whitespace-pre-line">{commercial.text}</p>}
        <NotesList notes={commercial?.notes ?? null} />
      </SectionCard>

      <SectionCard icon={Clock} title="Timestamped Recommendations">
        {recommendationsList.length === 0 ? (
          <div className="text-muted-foreground/70 italic">No recommendations available.</div>
        ) : (
          <ul className="space-y-2">
            {recommendationsList.map((r, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-purple-300 shrink-0">›</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard icon={ListChecks} title="DAW Instructions">
        {dawInstructionsList.length === 0 ? (
          <div className="text-muted-foreground/70 italic">No DAW instructions available.</div>
        ) : (
          <ul className="space-y-3">
            {dawInstructionsList.map((d, i) => (
              <li
                key={i}
                className="whitespace-pre-line rounded-lg border border-border/40 bg-background/40 p-3 font-mono text-xs leading-relaxed"
              >
                {d}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard icon={FileText} title="Full Analysis">
        {(() => {
          const fa = report?.full_analysis
          let text = ""
          if (typeof fa === "string") {
            text = fa
          } else if (fa && typeof fa === "object") {
            const o = fa as Record<string, unknown>
            const exec = typeof o.executive_summary === "string" ? o.executive_summary.trim() : ""
            const det  = typeof o.detailed_analysis  === "string" ? o.detailed_analysis.trim()  : ""
            const adv  = Array.isArray(o.advanced_improvements)
              ? (o.advanced_improvements as unknown[])
                  .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
                  .map((x) => `- ${x.trim()}`)
                  .join("\n")
              : typeof o.advanced_improvements === "string" ? o.advanced_improvements.trim() : ""
            const parts: string[] = []
            if (exec) parts.push(exec)
            if (det)  parts.push(det)
            if (adv)  parts.push("=== ADVANCED IMPROVEMENTS ===\n" + adv)
            text = parts.join("\n\n")
          }
          return text ? (
            <p className="whitespace-pre-line">{text}</p>
          ) : (
            <div className="text-muted-foreground/70 italic">No long-form analysis available.</div>
          )
        })()}
      </SectionCard>
    </div>
  )

  return (
    <Layout>
      {headerCard}
      <div className="flex flex-wrap justify-end">{actionsRow}</div>
      {summaryAndScore}
      {mixBlock}

      {isFree ? (
        <div className="relative no-print">
          {/* Blurred preview of locked sections */}
          <div className="pointer-events-none select-none filter blur-md opacity-60">
            {lockedContent}
          </div>
          {/* Dark overlay with unlock CTA */}
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-b from-background/70 via-background/85 to-background/95 flex items-start justify-center pt-16 sm:pt-24 px-4">
            <div className="max-w-md w-full rounded-2xl border border-purple-400/30 bg-gradient-to-br from-purple-950/70 to-fuchsia-950/60 backdrop-blur-md p-6 text-center space-y-4 shadow-2xl shadow-purple-900/40">
              <div className="w-12 h-12 mx-auto rounded-xl bg-purple-500/20 border border-purple-400/40 flex items-center justify-center">
                <Lock className="w-6 h-6 text-purple-200" />
              </div>
              <div>
                <div className="text-lg font-semibold text-white">
                  Unlock full AI Producer Review to see:
                </div>
                <ul className="text-sm text-purple-100/90 mt-3 space-y-1 text-left mx-auto inline-block">
                  <li>• detailed mix corrections</li>
                  <li>• DAW instructions</li>
                  <li>• full timestamp breakdown</li>
                </ul>
              </div>
              <Button
                className="w-full bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:opacity-90 text-white font-semibold"
                onClick={() => alert("Unlocking full access will be available soon.")}
              >
                <Sparkles className="w-4 h-4 mr-2" /> Unlock Full Access
              </Button>
            </div>
          </div>
        </div>
      ) : (
        lockedContent
      )}
    </Layout>
  )
}
