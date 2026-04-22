"use client"

/**
 * Compact, premium-feel analysis block. Fetches /api/tracks/:id/analysis
 * (newest row wins) and renders BPM / Key / Mood / Tempo as chips plus
 * an Interpretation paragraph below. Returns `null` when nothing useful
 * is available so cards don't show empty placeholders.
 *
 * Used by:
 *   • TrackDetailModal — full-detail view of any track
 *   • RecommendedTracksPanel — passes a pre-fetched snapshot via prop
 */
import { useEffect, useState } from "react"
import { Activity, Music2, Sparkles, Gauge } from "lucide-react"

export interface TrackAnalysisData {
  bpm:            number | null
  key:            string | null
  scale:          string | null
  mood:           string[] | null
  tempo_label:    string | null
  interpretation: string | null
  tags:           string[] | null
}

const EMPTY: TrackAnalysisData = {
  bpm: null, key: null, scale: null, mood: null,
  tempo_label: null, interpretation: null, tags: null,
}

function pick(results: unknown): TrackAnalysisData {
  const r = (results && typeof results === "object" ? results : {}) as Record<string, unknown>
  const moodRaw = r.mood
  const mood: string[] | null =
    Array.isArray(moodRaw) ? moodRaw.filter((m): m is string => typeof m === "string")
    : typeof moodRaw === "string" ? [moodRaw]
    : null
  const tagsRaw = r.tags
  const tags: string[] | null = Array.isArray(tagsRaw)
    ? tagsRaw.filter((t): t is string => typeof t === "string")
    : null
  return {
    bpm:            typeof r.bpm === "number" ? r.bpm : null,
    key:            typeof r.key === "string" ? r.key : null,
    scale:          typeof r.scale === "string" ? r.scale : null,
    mood:           mood && mood.length ? mood : null,
    tempo_label:    typeof r.tempo_label === "string" ? r.tempo_label : null,
    interpretation: typeof r.interpretation === "string" ? r.interpretation
                  : typeof r.summary        === "string" ? r.summary
                  : null,
    tags,
  }
}

function hasSomething(d: TrackAnalysisData): boolean {
  return d.bpm != null || !!d.key || !!d.mood?.length || !!d.tempo_label || !!d.interpretation
}

interface ChipProps { icon: React.ReactNode; label: string; value: string }
function Chip({ icon, label, value }: ChipProps) {
  return (
    <div className="flex items-center gap-1.5 rounded-full bg-white/5 border border-white/10 px-2.5 py-1 text-xs text-white/80">
      <span className="text-white/40">{icon}</span>
      <span className="text-white/40 uppercase tracking-wider text-[10px]">{label}</span>
      <span className="font-medium text-white">{value}</span>
    </div>
  )
}

export interface TrackAnalysisBlockProps {
  /** Either pass a `trackId` to auto-fetch, or pass a pre-computed `data` snapshot. */
  trackId?: string
  data?:    TrackAnalysisData | null
  /** When true, renders chips only (no interpretation paragraph). Use on dense cards. */
  compact?: boolean
  className?: string
}

export function TrackAnalysisBlock({ trackId, data: dataProp, compact, className }: TrackAnalysisBlockProps) {
  const [fetched, setFetched] = useState<TrackAnalysisData | null>(dataProp ?? null)
  const [loading, setLoading] = useState(!!trackId && !dataProp)

  useEffect(() => {
    if (!trackId || dataProp) return
    let alive = true
    setLoading(true)
    fetch(`/api/tracks/${trackId}/analysis?limit=1`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive) return
        const newest = j?.items?.[0]?.results
        setFetched(newest ? pick(newest) : EMPTY)
      })
      .catch(() => alive && setFetched(EMPTY))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [trackId, dataProp])

  const data = dataProp ?? fetched
  if (loading) return null
  if (!data || !hasSomething(data)) return null

  const keyLabel = data.key && data.scale ? `${data.key} ${data.scale}`
                 : data.key ?? null

  return (
    <div className={className ?? "rounded-xl border border-white/10 bg-white/[0.02] p-3 space-y-2"}>
      <div className="flex flex-wrap gap-1.5">
        {data.bpm != null    && <Chip icon={<Gauge size={11} />}    label="BPM"   value={String(Math.round(data.bpm))} />}
        {keyLabel            && <Chip icon={<Music2 size={11} />}   label="Key"   value={keyLabel} />}
        {data.tempo_label    && <Chip icon={<Activity size={11} />} label="Tempo" value={data.tempo_label} />}
        {data.mood?.length   && <Chip icon={<Sparkles size={11} />} label="Mood"  value={data.mood.slice(0, 3).join(", ")} />}
      </div>
      {!compact && data.interpretation && (
        <p className="text-xs leading-relaxed text-white/60 pt-1 border-t border-white/5">
          {data.interpretation}
        </p>
      )}
    </div>
  )
}
