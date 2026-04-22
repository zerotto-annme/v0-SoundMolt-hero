"use client"

/**
 * "Recommended for you" panel for the Agent Dashboard.
 *
 * Renders the agent's deep-taste-aware recommendations with:
 *   • track title + cover
 *   • compact analysis snapshot chips (BPM / Key / Mood / Tempo)
 *   • "Why recommended:" bulletised reasons from the live engine
 *
 * Reasons and analysis blocks are hidden cleanly when missing — see the
 * graceful-fallback behaviour in TrackAnalysisBlock.
 *
 * Auth: relies on Supabase session JWT (handled by the Supabase client),
 * calls /api/agents/[id]/recommendations/tracks (owner-session route).
 */
import { useEffect, useState } from "react"
import Image from "next/image"
import { Sparkles, Loader2 } from "lucide-react"
import { TrackAnalysisBlock, type TrackAnalysisData } from "./track-analysis-block"
import { supabase } from "@/lib/supabase"

interface RecItem {
  track_id:  string
  title:     string
  score:     number
  genre:     string | null
  cover_url: string | null
  analysis:  TrackAnalysisData | null
  factors?:  Record<string, number>
  reason?:   string[]
}

interface ApiPayload {
  items?: RecItem[]
  pagination?: { applied_fallback?: boolean; recently_played_excluded?: number }
}

interface RecommendedTracksPanelProps {
  agentId: string
  /** Defaults to 6 — keeps the dashboard panel compact. */
  limit?: number
}

export function RecommendedTracksPanel({ agentId, limit = 6 }: RecommendedTracksPanelProps) {
  const [items, setItems]     = useState<RecItem[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [meta, setMeta]       = useState<ApiPayload["pagination"]>(undefined)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const token = session?.access_token
        if (!token) {
          if (alive) { setError("Sign in to see recommendations"); setLoading(false) }
          return
        }
        const r = await fetch(
          `/api/agents/${agentId}/recommendations/tracks?limit=${limit}&exclude_played=true&recent_window_hours=24`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const j: ApiPayload = await r.json()
        if (!alive) return
        setItems(j.items ?? [])
        setMeta(j.pagination)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Failed to load")
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [agentId, limit])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-white/40 p-4">
        <Loader2 size={14} className="animate-spin" /> Loading recommendations…
      </div>
    )
  }
  if (error) return <p className="text-sm text-white/40 p-4">{error}</p>
  if (!items || items.length === 0) {
    return <p className="text-sm text-white/40 p-4">No recommendations yet — listen to more tracks to build your taste profile.</p>
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles size={14} className="text-purple-400" />
        <h3 className="text-sm font-semibold text-white">Recommended for you</h3>
        {meta?.applied_fallback && (
          <span className="text-[10px] uppercase tracking-wider text-amber-400/70">
            (penalty fallback)
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {items.map((it) => (
          <article
            key={it.track_id}
            className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.04] to-transparent p-3 space-y-3 hover:border-white/20 transition-colors"
          >
            <div className="flex items-start gap-3">
              <div className="relative shrink-0 w-14 h-14 rounded-lg overflow-hidden bg-white/5">
                {it.cover_url ? (
                  <Image src={it.cover_url} alt={it.title} fill sizes="56px" className="object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-white/20 text-xs">♪</div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h4 className="text-sm font-semibold text-white truncate">{it.title}</h4>
                <div className="flex items-center gap-2 text-[11px] text-white/40 mt-0.5">
                  {it.genre && <span>{it.genre}</span>}
                  <span className="text-purple-400 font-mono">score {it.score.toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Analysis chips — hidden when no useful data. */}
            <TrackAnalysisBlock
              data={it.analysis}
              compact
              className="rounded-lg border border-white/5 bg-black/20 p-2"
            />

            {/* Why recommended — hidden when no reasons. */}
            {it.reason && it.reason.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] uppercase tracking-wider text-white/40">Why recommended</p>
                <ul className="space-y-0.5">
                  {it.reason.slice(0, 4).map((r, i) => (
                    <li key={i} className="text-xs text-white/70 flex gap-1.5">
                      <span className="text-purple-400/60 shrink-0">•</span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  )
}
