"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import {
  Sparkles, Loader2, AlertCircle, Lock, ArrowLeft, RefreshCcw,
  Download, Copy, Clock, FileText, Check, Flame, Wrench,
  ArrowRight, Sliders, Layers, Activity, Wand2, TrendingUp,
} from "lucide-react"
import { Sidebar } from "@/components/sidebar"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/components/auth-context"
import { supabase } from "@/lib/supabase"

// ─── Types ──────────────────────────────────────────────────────────────
// Stage 14b — FIX-the-track contract (v4) with rich per-task metadata
// and a structured 3-section full analysis. Legacy v2 (object full
// analysis) and v3 (string full analysis, name/steps/result on tasks)
// fields stay optional+nullable so already-stored rows keep rendering.
type FixTaskCategory =
  | "mix"
  | "mastering"
  | "arrangement"
  | "sound_design"
  | "commercial"

type FixTask = {
  number?: number | null
  // v4 fields
  task_title?: string | null
  time_range?: string | null
  category?: FixTaskCategory | string | null
  problem?: string | null
  why_it_matters?: string | null
  daw_steps?: string[] | null
  settings?: string[] | null
  expected_result?: string | null
  // v3 legacy fields kept for already-stored rows
  name?: string | null
  steps?: string[] | null
  result?: string | null
}

type ExpectedResult = {
  before?: string[] | null
  after?: string[] | null
}

// Stage 14b — full_analysis is a structured object; identical shape
// also doubles as the legacy v2 fallback because both versions used
// the same three keys.
type FullAnalysisStructured = {
  executive_summary?: string | null
  detailed_analysis?: string | null
  advanced_improvements?: string | null
}

// Legacy v2 shapes — kept ONLY so already-stored reports still render
// gracefully without crashing. New rendering paths use v4 fields.
type LegacySection = {
  score?: number | null
  notes?: string[] | null
  text?: string | null
}
type LegacyPriorityFix = {
  title?: string | null
  action?: string | null
  impact?: string | null
}

type ReportJson = {
  version?: number
  generated_at?: string
  summary?: string
  overall_score?: number

  // Stage 14b — current shape
  fix_tasks?: FixTask[]
  priority_fix?: string[]
  expected_result?: ExpectedResult
  // v4: structured object | v3: single string | v2: legacy structured
  full_analysis?: FullAnalysisStructured | string

  // Legacy v2 fields (only for reports stored before Stage 14)
  sections?: {
    mix?: LegacySection
    mastering?: LegacySection
    arrangement?: LegacySection
    sound_design?: LegacySection
    commercial_potential?: LegacySection
  }
  priority_fixes?: LegacyPriorityFix[]
  timestamped_recommendations?: unknown[]
  daw_instructions?: string[] | string
  recommendations?: unknown[]
  references?: string[]
}

// Stage 14b — per-category visual metadata for the Fix Tasks render.
// Each entry pins a label, an icon, and a color scheme so the user can
// scan a long list of tasks and tell at a glance which area is being
// addressed.
const CATEGORY_META: Record<FixTaskCategory, {
  label:  string
  Icon:   typeof Sliders
  badge:  string  // tailwind classes for the small uppercase pill
}> = {
  mix: {
    label: "Mix",
    Icon:  Sliders,
    badge: "bg-sky-500/15 border-sky-400/30 text-sky-200",
  },
  mastering: {
    label: "Mastering",
    Icon:  Activity,
    badge: "bg-amber-500/15 border-amber-400/30 text-amber-200",
  },
  arrangement: {
    label: "Arrangement",
    Icon:  Layers,
    badge: "bg-purple-500/15 border-purple-400/30 text-purple-200",
  },
  sound_design: {
    label: "Sound Design",
    Icon:  Wand2,
    badge: "bg-fuchsia-500/15 border-fuchsia-400/30 text-fuchsia-200",
  },
  commercial: {
    label: "Commercial",
    Icon:  TrendingUp,
    badge: "bg-emerald-500/15 border-emerald-400/30 text-emerald-200",
  },
}

const FALLBACK_CATEGORY_META = CATEGORY_META.mix

function categoryMeta(c: unknown) {
  if (typeof c === "string" && (c in CATEGORY_META)) {
    return CATEGORY_META[c as FixTaskCategory]
  }
  return FALLBACK_CATEGORY_META
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
  return GENRE_LABELS[id] ?? id
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

  // Stage 14b — Fix Tasks (6–10 actionable production tasks). Filter on
  // ANY meaningful field across both v3 (name/steps) and v4
  // (task_title/daw_steps) shapes so legacy rows still render.
  const fixTasksList = useMemo<FixTask[]>(() => {
    const v = report?.fix_tasks
    if (!Array.isArray(v)) return []
    return v
      .filter((t): t is FixTask => !!t && typeof t === "object")
      .filter((t) =>
        (t.task_title ?? "") ||
        (t.name ?? "") ||
        (t.problem ?? "") ||
        (Array.isArray(t.daw_steps) && t.daw_steps.length > 0) ||
        (Array.isArray(t.steps) && t.steps.length > 0)
      )
      .slice(0, 10)
  }, [report])

  // Stage 14 — Priority Fix (top-3 short string actions). Fall back to
  // the legacy v2 shape (priority_fixes:object[]) for already-stored
  // reports so they keep rendering something useful.
  const priorityFixList = useMemo<string[]>(() => {
    const v = report?.priority_fix
    if (Array.isArray(v)) {
      const out = v.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        .map((s) => s.trim())
        .slice(0, 3)
      if (out.length > 0) return out
    }
    const legacy = report?.priority_fixes
    if (Array.isArray(legacy)) {
      const out: string[] = []
      for (const item of legacy) {
        if (!item || typeof item !== "object") continue
        const action = (item.action ?? item.title ?? "").toString().trim()
        if (action) out.push(action)
        if (out.length >= 3) break
      }
      return out
    }
    return []
  }, [report])

  // Stage 14 — Expected Result (before / after bullets).
  const expectedBefore = useMemo<string[]>(() => {
    const v = report?.expected_result?.before
    if (!Array.isArray(v)) return []
    return v.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      .map((s) => s.trim())
      .slice(0, 8)
  }, [report])

  const expectedAfter = useMemo<string[]>(() => {
    const v = report?.expected_result?.after
    if (!Array.isArray(v)) return []
    return v.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      .map((s) => s.trim())
      .slice(0, 8)
  }, [report])

  // Stage 14b — Full Analysis is a STRUCTURED OBJECT with three
  // sections. For legacy v3 reports (single string) we fold the string
  // into executive_summary so the section still surfaces something
  // useful; v2 reports already used the same three-key shape.
  const fullAnalysis = useMemo<{
    executive_summary: string
    detailed_analysis: string
    advanced_improvements: string
  }>(() => {
    const v = report?.full_analysis
    if (typeof v === "string") {
      return { executive_summary: v.trim(), detailed_analysis: "", advanced_improvements: "" }
    }
    if (v && typeof v === "object") {
      const o = v as FullAnalysisStructured
      return {
        executive_summary:     (o.executive_summary     ?? "").trim(),
        detailed_analysis:     (o.detailed_analysis     ?? "").trim(),
        advanced_improvements: (o.advanced_improvements ?? "").trim(),
      }
    }
    return { executive_summary: "", detailed_analysis: "", advanced_improvements: "" }
  }, [report])
  const hasFullAnalysis =
    fullAnalysis.executive_summary.length > 0 ||
    fullAnalysis.detailed_analysis.length > 0 ||
    fullAnalysis.advanced_improvements.length > 0

  const handleCopyRecommendations = async () => {
    let text = ""
    if (isFree) {
      text = [
        review?.title ? `Track: ${review.title}` : null,
        report?.summary ? `Summary: ${report.summary}` : null,
        typeof report?.overall_score === "number"
          ? `Overall score: ${report.overall_score}/100`
          : null,
      ].filter(Boolean).join("\n")
    } else {
      const lines: string[] = []
      if (review?.title) lines.push(`Track: ${review.title}`)
      if (priorityFixList.length > 0) {
        lines.push("", "Priority fix (top 3):")
        priorityFixList.forEach((p, i) => lines.push(`${i + 1}. ${p}`))
      }
      if (fixTasksList.length > 0) {
        lines.push("", "Fix tasks:")
        fixTasksList.forEach((t, i) => {
          const num    = typeof t.number === "number" ? t.number : i + 1
          const title  = t.task_title ?? t.name ?? "(untitled)"
          const range  = t.time_range ? ` (${t.time_range})` : ""
          const cat    = categoryMeta(t.category).label
          const steps  = Array.isArray(t.daw_steps) && t.daw_steps.length > 0
                          ? t.daw_steps
                          : (Array.isArray(t.steps) ? t.steps : [])
          const result = t.expected_result ?? t.result ?? ""
          lines.push(`TASK ${num} — ${title}${range}  [${cat}]`)
          if (t.problem)        lines.push(`   Problem: ${t.problem}`)
          if (t.why_it_matters) lines.push(`   Why it matters: ${t.why_it_matters}`)
          if (steps.length > 0) {
            lines.push(`   Do this:`)
            steps.forEach((s) => lines.push(`     - ${s}`))
          }
          if (Array.isArray(t.settings) && t.settings.length > 0) {
            lines.push(`   Settings:`)
            t.settings.forEach((s) => lines.push(`     • ${s}`))
          }
          if (result) lines.push(`   Result: ${result}`)
          lines.push("")
        })
      }
      if (expectedBefore.length > 0 || expectedAfter.length > 0) {
        lines.push("Expected result:")
        if (expectedBefore.length > 0) {
          lines.push("  Before:")
          expectedBefore.forEach((s) => lines.push(`    - ${s}`))
        }
        if (expectedAfter.length > 0) {
          lines.push("  After:")
          expectedAfter.forEach((s) => lines.push(`    - ${s}`))
        }
        lines.push("")
      }
      if (hasFullAnalysis) {
        lines.push("Full analysis:")
        if (fullAnalysis.executive_summary) {
          lines.push("  Executive summary:", `    ${fullAnalysis.executive_summary}`)
        }
        if (fullAnalysis.detailed_analysis) {
          lines.push("  Detailed analysis:", `    ${fullAnalysis.detailed_analysis}`)
        }
        if (fullAnalysis.advanced_improvements) {
          lines.push("  Advanced improvements:", `    ${fullAnalysis.advanced_improvements}`)
        }
      }
      text = lines.join("\n").trimEnd()
    }
    if (!text) text = "(nothing to copy)"
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      alert("Could not copy to clipboard.")
    }
  }

  // ─── Render branches ────────────────────────────────────────────────
  const Layout = ({ children }: { children: React.ReactNode }) => (
    <div className="min-h-screen bg-background text-foreground">
      <Sidebar />
      <main className="lg:ml-64 min-h-screen pb-32">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
          <div>
            <Link
              href="/ai-producer"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-4 h-4" /> Back to AI Producer
            </Link>
          </div>
          {children}
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
            {genreLabel(review.genre) && (
              <span><span className="text-foreground/80 font-medium">Genre:</span> {genreLabel(review.genre)}</span>
            )}
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

  // Action buttons (top right of header)
  const actionsRow = (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => alert("Download PDF will be available soon.")}
      >
        <Download className="w-4 h-4 mr-2" /> Download PDF
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={handleCopyRecommendations}
      >
        {copied ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
        {copied ? "Copied" : "Copy Recommendations"}
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

  // Stage 14 — Locked-zone content (rendered for both free + full; in
  // free we wrap it with a blurred overlay). Order: Priority Fix top-3
  // → Fix Tasks → Expected Result (before/after) → Full Analysis.
  const lockedContent = (
    <div className="space-y-4">
      {priorityFixList.length > 0 && (
        <div className="rounded-2xl border border-amber-400/30 bg-gradient-to-br from-amber-950/30 via-card/40 to-rose-950/20 p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-400/30 flex items-center justify-center">
              <Flame className="w-4 h-4 text-amber-300" />
            </div>
            <h3 className="text-base font-semibold">Priority Fix</h3>
            <span className="text-[11px] uppercase tracking-wider font-mono px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-400/30 text-amber-300">
              Top 3
            </span>
          </div>
          <ol className="space-y-2">
            {priorityFixList.map((p, i) => (
              <li
                key={i}
                className="rounded-xl border border-border/40 bg-background/40 p-3 sm:p-4 flex items-start gap-3"
              >
                <span className="mt-0.5 inline-flex w-6 h-6 shrink-0 items-center justify-center rounded-md bg-amber-500/15 border border-amber-400/30 text-amber-200 text-xs font-mono">
                  {i + 1}
                </span>
                <span className="text-sm text-foreground leading-relaxed">{p}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <SectionCard icon={Wrench} title="Fix Tasks">
        {fixTasksList.length === 0 ? (
          <div className="text-muted-foreground/70 italic">No fix tasks available.</div>
        ) : (
          <ol className="space-y-3">
            {fixTasksList.map((t, i) => {
              const num    = typeof t.number === "number" ? t.number : i + 1
              const title  = t.task_title ?? t.name ?? ""
              const meta   = categoryMeta(t.category)
              const Icon   = meta.Icon
              const steps  = Array.isArray(t.daw_steps) && t.daw_steps.length > 0
                              ? t.daw_steps
                              : (Array.isArray(t.steps) ? t.steps : [])
              const result = t.expected_result ?? t.result ?? ""
              return (
                <li
                  key={i}
                  className="rounded-xl border border-border/40 bg-background/40 p-3 sm:p-4 space-y-2.5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex w-7 h-7 shrink-0 items-center justify-center rounded-md bg-purple-500/15 border border-purple-400/30 text-purple-200 text-xs font-mono">
                      {num}
                    </span>
                    {title && (
                      <span className="font-semibold text-foreground text-sm sm:text-base">
                        {title}
                      </span>
                    )}
                    <span className={`inline-flex items-center gap-1 text-[11px] uppercase tracking-wider font-mono px-2 py-0.5 rounded-full border ${meta.badge}`}>
                      <Icon className="w-3 h-3" /> {meta.label}
                    </span>
                    {t.time_range && (
                      <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wider font-mono px-2 py-0.5 rounded-full bg-purple-500/10 border border-purple-400/30 text-purple-200">
                        <Clock className="w-3 h-3" /> {t.time_range}
                      </span>
                    )}
                  </div>
                  {t.problem && (
                    <div className="text-sm">
                      <span className="text-xs uppercase tracking-wider font-mono text-amber-300/90">Problem: </span>
                      <span className="text-muted-foreground">{t.problem}</span>
                    </div>
                  )}
                  {t.why_it_matters && (
                    <div className="text-sm">
                      <span className="text-xs uppercase tracking-wider font-mono text-rose-300/90">Why it matters: </span>
                      <span className="text-muted-foreground">{t.why_it_matters}</span>
                    </div>
                  )}
                  {steps.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="text-xs uppercase tracking-wider font-mono text-purple-300">Do this in your DAW:</div>
                      <ul className="space-y-1.5 text-sm text-muted-foreground">
                        {steps.map((s, si) => (
                          <li key={si} className="flex gap-2">
                            <span className="text-purple-300 shrink-0">›</span>
                            <span className="whitespace-pre-line">{s}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {Array.isArray(t.settings) && t.settings.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="text-xs uppercase tracking-wider font-mono text-sky-300">Settings:</div>
                      <ul className="space-y-1 rounded-lg border border-sky-400/20 bg-sky-950/15 p-2.5">
                        {t.settings.map((s, si) => (
                          <li key={si} className="font-mono text-[12px] sm:text-[13px] text-sky-100/90 break-words">
                            {s}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {result && (
                    <div className="text-sm">
                      <span className="text-xs uppercase tracking-wider font-mono text-emerald-300/90">Expected result: </span>
                      <span className="text-muted-foreground">{result}</span>
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
        )}
      </SectionCard>

      <SectionCard icon={ArrowRight} title="Expected Result">
        {expectedBefore.length === 0 && expectedAfter.length === 0 ? (
          <div className="text-muted-foreground/70 italic">No before/after comparison available.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-lg border border-rose-400/30 bg-rose-950/15 p-3 sm:p-4 space-y-2">
              <div className="text-xs uppercase tracking-wider font-mono text-rose-300">Before</div>
              {expectedBefore.length === 0 ? (
                <div className="text-muted-foreground/70 italic text-sm">—</div>
              ) : (
                <ul className="space-y-1.5 text-sm text-muted-foreground">
                  {expectedBefore.map((s, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-rose-300 shrink-0">•</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-lg border border-emerald-400/30 bg-emerald-950/15 p-3 sm:p-4 space-y-2">
              <div className="text-xs uppercase tracking-wider font-mono text-emerald-300">After</div>
              {expectedAfter.length === 0 ? (
                <div className="text-muted-foreground/70 italic text-sm">—</div>
              ) : (
                <ul className="space-y-1.5 text-sm text-muted-foreground">
                  {expectedAfter.map((s, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-emerald-300 shrink-0">•</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard icon={FileText} title="Full Analysis">
        {!hasFullAnalysis ? (
          <div className="text-muted-foreground/70 italic">No long-form analysis available.</div>
        ) : (
          <div className="space-y-4">
            {fullAnalysis.executive_summary && (
              <div className="rounded-xl border border-purple-400/25 bg-purple-950/15 p-3 sm:p-4 space-y-2">
                <div className="text-xs uppercase tracking-wider font-mono text-purple-300">
                  Executive Summary
                </div>
                <p className="whitespace-pre-line text-sm leading-relaxed">
                  {fullAnalysis.executive_summary}
                </p>
              </div>
            )}
            {fullAnalysis.detailed_analysis && (
              <div className="rounded-xl border border-sky-400/25 bg-sky-950/10 p-3 sm:p-4 space-y-2">
                <div className="text-xs uppercase tracking-wider font-mono text-sky-300">
                  Detailed Analysis
                </div>
                <p className="whitespace-pre-line text-sm leading-relaxed">
                  {fullAnalysis.detailed_analysis}
                </p>
              </div>
            )}
            {fullAnalysis.advanced_improvements && (
              <div className="rounded-xl border border-emerald-400/25 bg-emerald-950/10 p-3 sm:p-4 space-y-2">
                <div className="text-xs uppercase tracking-wider font-mono text-emerald-300">
                  Advanced Improvements
                </div>
                <p className="whitespace-pre-line text-sm leading-relaxed">
                  {fullAnalysis.advanced_improvements}
                </p>
              </div>
            )}
          </div>
        )}
      </SectionCard>
    </div>
  )

  return (
    <Layout>
      {headerCard}
      <div className="flex flex-wrap justify-end">{actionsRow}</div>
      {summaryAndScore}

      {isFree ? (
        <div className="relative">
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
                  <li>• top-3 priority fixes with exact settings</li>
                  <li>• 6–10 fix tasks across mix, mastering, arrangement, sound design</li>
                  <li>• per-task DAW steps, settings &amp; expected sound</li>
                  <li>• before / after expected result</li>
                  <li>• 3-section in-depth producer analysis</li>
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
