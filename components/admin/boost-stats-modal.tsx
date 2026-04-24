"use client"

import { useEffect, useState } from "react"
import { X, Sparkles, Loader2, TrendingUp, Heart, Download, History } from "lucide-react"

/**
 * Stat layers shown side-by-side in the modal so the admin always knows
 * which numbers are real and which were inflated. Mirrors the shape
 * returned by GET /api/admin/tracks for a single track row.
 */
export interface BoostModalTrack {
  id: string
  title: string
  organic_plays: number
  organic_likes: number
  organic_downloads: number
  boost_plays: number
  boost_likes: number
  boost_downloads: number
  display_plays: number
  display_likes: number
  display_downloads: number
}

export interface BoostHistoryRow {
  id: string
  boost_plays: number
  boost_likes: number
  boost_downloads: number
  reason: string | null
  created_by_admin: string | null
  created_by_admin_email: string | null
  created_at: string
}

interface AdminFetchInit extends RequestInit {
  timeoutMs?: number
}

/**
 * Modal for applying a single Boost Stats entry to a track.
 *
 * Inputs:
 *   - plays / likes / downloads (each ≥ 0; at least one must be > 0)
 *   - reason (free text, audit log)
 *
 * Behaviour:
 *   1. Opens with the current organic / boost / display breakdown
 *      so the admin can see what the change will produce.
 *   2. Optionally fetches the boost history (audit log) so the admin
 *      can see what was previously inflated and why.
 *   3. POSTs to /api/admin/tracks/:id/boost via the supplied
 *      `adminFetch` so that auth / timeout / error handling stay
 *      consistent with the rest of the admin panel.
 *   4. On success, calls `onApplied(updatedTrack)` (parent reloads list).
 */
export function BoostStatsModal({
  track,
  isOpen,
  onClose,
  onApplied,
  adminFetch,
}: {
  track: BoostModalTrack | null
  isOpen: boolean
  onClose: () => void
  onApplied: () => Promise<void> | void
  adminFetch: <T>(path: string, init?: AdminFetchInit) => Promise<T>
}) {
  const [plays, setPlays] = useState("")
  const [likes, setLikes] = useState("")
  const [downloads, setDownloads] = useState("")
  const [reason, setReason] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<BoostHistoryRow[] | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  // Reset every time we open against a new track. Without this the
  // previous track's "200 plays" pre-filled value would silently
  // double-apply if you opened a second track.
  useEffect(() => {
    if (isOpen) {
      setPlays("")
      setLikes("")
      setDownloads("")
      setReason("")
      setError(null)
      setHistory(null)
      setHistoryError(null)
      setShowHistory(false)
    }
  }, [isOpen, track?.id])

  if (!isOpen || !track) return null

  const parsedPlays = parseDelta(plays)
  const parsedLikes = parseDelta(likes)
  const parsedDownloads = parseDelta(downloads)
  const anyValid =
    (parsedPlays.value > 0 || parsedLikes.value > 0 || parsedDownloads.value > 0) &&
    !parsedPlays.error &&
    !parsedLikes.error &&
    !parsedDownloads.error
  const previewPlays = track.display_plays + parsedPlays.value
  const previewLikes = track.display_likes + parsedLikes.value
  const previewDownloads = track.display_downloads + parsedDownloads.value

  async function loadHistory() {
    if (!track || historyLoading) return
    setShowHistory(true)
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      const json = await adminFetch<{ boosts: BoostHistoryRow[] }>(
        `/api/admin/tracks/${track.id}/boost`,
      )
      setHistory(json.boosts ?? [])
    } catch (e) {
      setHistoryError((e as Error).message || "Failed to load history")
    } finally {
      setHistoryLoading(false)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!track || !anyValid || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await adminFetch(`/api/admin/tracks/${track.id}/boost`, {
        method: "POST",
        body: JSON.stringify({
          boost_plays: parsedPlays.value,
          boost_likes: parsedLikes.value,
          boost_downloads: parsedDownloads.value,
          reason: reason.trim() || null,
        }),
      })
      await onApplied()
      onClose()
    } catch (err) {
      setError((err as Error).message || "Failed to apply boost")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => !submitting && onClose()} />

      <div className="relative w-full max-w-xl mx-4 bg-card border border-border/50 rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto overscroll-contain">
        <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-br from-amber-500/20 via-transparent to-glow-primary/20 pointer-events-none" />

        <button
          onClick={onClose}
          disabled={submitting}
          className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors z-10 disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="Close"
        >
          <X className="w-4 h-4 text-white" />
        </button>

        <form onSubmit={submit} className="relative p-6 space-y-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-foreground">Boost Stats</h2>
              <p className="text-sm text-muted-foreground truncate" title={track.title}>
                {track.title}
              </p>
            </div>
          </div>

          {/* Stat-layer breakdown */}
          <div className="rounded-xl border border-border/40 bg-black/30 overflow-hidden">
            <div className="grid grid-cols-4 text-[11px] font-mono uppercase text-muted-foreground bg-white/5 px-3 py-2">
              <span></span>
              <span className="text-right">Organic</span>
              <span className="text-right">Boost</span>
              <span className="text-right">Display</span>
            </div>
            <StatRow
              icon={<TrendingUp className="w-3.5 h-3.5 text-glow-primary" />}
              label="Plays"
              organic={track.organic_plays}
              boost={track.boost_plays}
              display={track.display_plays}
            />
            <StatRow
              icon={<Heart className="w-3.5 h-3.5 text-rose-400" />}
              label="Likes"
              organic={track.organic_likes}
              boost={track.boost_likes}
              display={track.display_likes}
            />
            <StatRow
              icon={<Download className="w-3.5 h-3.5 text-emerald-400" />}
              label="Downloads"
              organic={track.organic_downloads}
              boost={track.boost_downloads}
              display={track.display_downloads}
            />
          </div>

          <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
            Organic counts are the real analytics layer — they stay untouched and continue to drive
            the recommendation / taste-profile pipeline. Boosts add on top for the public display
            only.
          </p>

          {/* Inputs */}
          <div className="grid grid-cols-3 gap-3">
            <DeltaInput
              label="Plays boost"
              value={plays}
              onChange={setPlays}
              error={parsedPlays.error}
              disabled={submitting}
            />
            <DeltaInput
              label="Likes boost"
              value={likes}
              onChange={setLikes}
              error={parsedLikes.error}
              disabled={submitting}
            />
            <DeltaInput
              label="Downloads boost"
              value={downloads}
              onChange={setDownloads}
              error={parsedDownloads.error}
              disabled={submitting}
            />
          </div>

          {anyValid && (
            <div className="text-xs text-muted-foreground border border-amber-500/30 bg-amber-500/5 rounded-lg px-3 py-2">
              Display will become{" "}
              <span className="text-amber-300 font-mono tabular-nums">{previewPlays}</span> plays /{" "}
              <span className="text-amber-300 font-mono tabular-nums">{previewLikes}</span> likes /{" "}
              <span className="text-amber-300 font-mono tabular-nums">{previewDownloads}</span> downloads.
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Reason (recorded in audit log)</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={submitting}
              maxLength={500}
              rows={2}
              placeholder="e.g. Editorial pick, launch-week push, community spotlight…"
              className="w-full rounded-lg bg-black/30 border border-border/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-amber-500/50 disabled:opacity-50"
            />
            <div className="text-[10px] text-muted-foreground/60 text-right">{reason.length}/500</div>
          </div>

          {error && (
            <div className="text-sm text-red-400 border border-red-500/30 bg-red-500/5 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={loadHistory}
              disabled={submitting || historyLoading}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              {historyLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <History className="w-3.5 h-3.5" />
              )}
              {showHistory ? "Refresh history" : "View boost history"}
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="px-4 py-2 text-sm rounded-lg border border-border/50 text-foreground hover:bg-white/5 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!anyValid || submitting}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 text-white font-medium shadow-lg shadow-amber-500/20 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                Apply boost
              </button>
            </div>
          </div>

          {showHistory && (
            <div className="rounded-xl border border-border/40 bg-black/30 max-h-60 overflow-y-auto">
              {historyError ? (
                <div className="p-3 text-xs text-red-400">{historyError}</div>
              ) : !history ? (
                <div className="p-3 text-xs text-muted-foreground inline-flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Loading history…
                </div>
              ) : history.length === 0 ? (
                <div className="p-3 text-xs text-muted-foreground">No previous boosts on this track.</div>
              ) : (
                <ul className="divide-y divide-border/30">
                  {history.map((h) => (
                    <li key={h.id} className="p-3 text-xs space-y-1">
                      <div className="flex justify-between gap-2 text-muted-foreground">
                        <span className="font-mono">{formatTimestamp(h.created_at)}</span>
                        <span className="truncate">{h.created_by_admin_email ?? "—"}</span>
                      </div>
                      <div className="text-foreground tabular-nums font-mono">
                        +{h.boost_plays} plays · +{h.boost_likes} likes · +{h.boost_downloads} downloads
                      </div>
                      {h.reason && (
                        <div className="text-muted-foreground italic break-words">“{h.reason}”</div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </form>
      </div>
    </div>
  )
}

function StatRow({
  icon,
  label,
  organic,
  boost,
  display,
}: {
  icon: React.ReactNode
  label: string
  organic: number
  boost: number
  display: number
}) {
  return (
    <div className="grid grid-cols-4 items-center px-3 py-2 text-sm font-mono tabular-nums">
      <span className="inline-flex items-center gap-1.5 text-muted-foreground text-xs">
        {icon}
        <span className="font-sans">{label}</span>
      </span>
      <span className="text-right text-foreground">{organic.toLocaleString()}</span>
      <span className={`text-right ${boost > 0 ? "text-amber-300" : "text-muted-foreground/50"}`}>
        {boost > 0 ? `+${boost.toLocaleString()}` : "0"}
      </span>
      <span className="text-right text-foreground font-medium">{display.toLocaleString()}</span>
    </div>
  )
}

function DeltaInput({
  label,
  value,
  onChange,
  error,
  disabled,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  error: string | null
  disabled: boolean
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder="0"
        className={`w-full rounded-lg bg-black/30 border px-3 py-2 text-sm text-foreground tabular-nums placeholder:text-muted-foreground/40 focus:outline-none disabled:opacity-50 ${
          error ? "border-red-500/50 focus:border-red-500" : "border-border/40 focus:border-amber-500/50"
        }`}
      />
      {error && <span className="block text-[10px] text-red-400">{error}</span>}
    </label>
  )
}

function parseDelta(raw: string): { value: number; error: string | null } {
  const trimmed = raw.trim()
  if (trimmed === "") return { value: 0, error: null }
  const n = Number(trimmed)
  if (!Number.isFinite(n)) return { value: 0, error: "Must be a number" }
  if (!Number.isInteger(n)) return { value: 0, error: "No decimals" }
  if (n < 0) return { value: 0, error: "No negatives" }
  if (n > 1_000_000_000) return { value: 0, error: "Too large" }
  return { value: n, error: null }
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return iso
  }
}
