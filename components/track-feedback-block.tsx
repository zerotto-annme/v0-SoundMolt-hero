"use client"

/**
 * Creator Feedback block — premium, compact rendering of the
 * /api/tracks/:id/feedback payload.
 *
 * Layout:
 *   • One short summary sentence (with optional fit % chip).
 *   • Three small sections: Strengths / Considerations / Suggestions.
 *
 * Hides cleanly:
 *   • If the endpoint returns analysis_pending, 4xx/5xx, or empty.
 *   • If individual sections are empty, that section is omitted.
 *
 * Used by:
 *   • TrackDetailModal — full-detail view of any track.
 */
import { useEffect, useState } from "react"
import { Sparkles, Lightbulb, AlertCircle, Loader2 } from "lucide-react"

interface FeedbackPayload {
  summary?: { fit_score: number | null; overall: string }
  strengths?:    string[]
  weaknesses?:   string[]
  improvements?: string[]
  status?:       string  // "analysis_pending" when no analysis yet
}

interface TrackFeedbackBlockProps {
  trackId: string
  className?: string
}

export function TrackFeedbackBlock({ trackId, className }: TrackFeedbackBlockProps) {
  const [data, setData]       = useState<FeedbackPayload | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetch(`/api/tracks/${trackId}/feedback`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => alive && setData(j ?? null))
      .catch(() => alive && setData(null))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [trackId])

  if (loading) return null
  if (!data || data.status === "analysis_pending") return null

  const summary      = data.summary?.overall?.trim()
  const fit          = data.summary?.fit_score
  const strengths    = (data.strengths    ?? []).filter(Boolean)
  const weaknesses   = (data.weaknesses   ?? []).filter(Boolean)
  const improvements = (data.improvements ?? []).filter(Boolean)

  // Hide entirely if there's literally nothing useful to show.
  if (!summary && !strengths.length && !weaknesses.length && !improvements.length) return null

  return (
    <section
      className={
        className ??
        "rounded-xl border border-white/10 bg-white/[0.02] p-3 space-y-3"
      }
    >
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Sparkles size={13} className="text-purple-400" />
          <h3 className="text-xs uppercase tracking-wider text-white/60 font-medium">
            Creator Feedback
          </h3>
        </div>
        {fit != null && (
          <span className="rounded-full border border-purple-400/30 bg-purple-400/10 px-2 py-0.5 text-[10px] font-medium text-purple-300">
            {Math.max(0, Math.min(100, Math.round(fit * 100)))}% match
          </span>
        )}
      </header>

      {summary && (
        <p className="text-xs leading-relaxed text-white/70">{summary}</p>
      )}

      {(strengths.length > 0 || weaknesses.length > 0 || improvements.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
          <Section
            title="Strengths"
            items={strengths}
            icon={<Sparkles size={11} className="text-emerald-400/80" />}
            tone="emerald"
          />
          <Section
            title="Considerations"
            items={weaknesses}
            icon={<AlertCircle size={11} className="text-amber-400/80" />}
            tone="amber"
          />
          <Section
            title="Suggestions"
            items={improvements}
            icon={<Lightbulb size={11} className="text-sky-400/80" />}
            tone="sky"
          />
        </div>
      )}
    </section>
  )
}

interface SectionProps {
  title: string
  items: string[]
  icon:  React.ReactNode
  tone:  "emerald" | "amber" | "sky"
}
const TONE_BULLET: Record<SectionProps["tone"], string> = {
  emerald: "text-emerald-400/60",
  amber:   "text-amber-400/60",
  sky:     "text-sky-400/60",
}

function Section({ title, items, icon, tone }: SectionProps) {
  if (items.length === 0) return null
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1">
        {icon}
        <span className="text-[10px] uppercase tracking-wider text-white/50 font-medium">
          {title}
        </span>
      </div>
      <ul className="space-y-1">
        {items.slice(0, 3).map((line, i) => (
          <li key={i} className="text-[11px] leading-relaxed text-white/70 flex gap-1.5">
            <span className={`${TONE_BULLET[tone]} shrink-0`}>•</span>
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

void Loader2
