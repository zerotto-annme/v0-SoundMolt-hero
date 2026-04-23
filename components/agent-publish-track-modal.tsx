"use client"

import { useEffect, useState } from "react"
import { Loader2, Music, X, AlertCircle } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock"

interface Props {
  /** Agent UUID the new track will be attributed to. */
  agentId: string
  /** Modal open/close. */
  open:    boolean
  /** Called when the user dismisses (Cancel / X / backdrop). */
  onClose: () => void
  /**
   * Called once a track has been published successfully. Parent should use
   * this hook to refetch My Tracks / Recent Activity so the new row appears
   * without a full page reload.
   */
  onPublished: (track: { id: string; title: string }) => void
}

/**
 * AgentPublishTrackModal
 *
 * Minimal "first real action" form for the Agent Dashboard. Submits to
 * POST /api/agents/:id/tracks with the dashboard owner's Supabase JWT —
 * the server validates ownership and reuses the same insert helper as the
 * external Bearer path (POST /api/tracks). No file upload here yet — the
 * agent supplies a hosted audio URL (Supabase Storage, S3, etc.).
 */
export function AgentPublishTrackModal({ agentId, open, onClose, onPublished }: Props) {
  useBodyScrollLock(open)
  const [title,       setTitle]       = useState("")
  const [description, setDescription] = useState("")
  const [genre,       setGenre]       = useState("")
  const [audioUrl,    setAudioUrl]    = useState("")
  const [coverUrl,    setCoverUrl]    = useState("")
  const [submitting,  setSubmitting]  = useState(false)
  const [error,       setError]       = useState<string | null>(null)

  // Reset transient state every time the modal is reopened so a previous
  // attempt's values / errors don't leak into the next session.
  useEffect(() => {
    if (open) {
      setTitle(""); setDescription(""); setGenre("")
      setAudioUrl(""); setCoverUrl("")
      setError(null); setSubmitting(false)
    }
  }, [open])

  // Esc closes the modal (unless mid-submit, to avoid abandoning a request).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, submitting, onClose])

  if (!open) return null

  const canSubmit = title.trim().length > 0 && audioUrl.trim().length > 0 && !submitting

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true); setError(null)

    try {
      const { data: sessionRes } = await supabase.auth.getSession()
      const token = sessionRes.session?.access_token
      if (!token) {
        setError("You are not signed in. Please refresh and try again.")
        setSubmitting(false)
        return
      }

      const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/tracks`, {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          Authorization:   `Bearer ${token}`,
        },
        body: JSON.stringify({
          title:       title.trim(),
          description: description.trim() || undefined,
          // The API accepts both `genre` and `style` and stores it on the
          // `style` column. We send `genre` to match the spec wording.
          genre:       genre.trim()    || undefined,
          audio_url:   audioUrl.trim(),
          cover_url:   coverUrl.trim() || undefined,
          // Per the spec contract. Today the `tracks` table has no
          // `is_public` column so the server ignores this key, but we
          // send it so callers don't break if the column is added later.
          is_public:   true,
        }),
      })

      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof json?.error === "string" ? json.error : `Publish failed (${res.status})`)
        setSubmitting(false)
        return
      }

      const track = (json as { track?: { id: string; title: string } }).track
      onPublished({ id: track?.id ?? "", title: track?.title ?? title.trim() })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Publish failed")
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="publish-track-title"
    >
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={() => { if (!submitting) onClose() }}
      />
      <div className="relative w-full max-w-md max-h-[90vh] overflow-y-auto overscroll-contain rounded-xl border border-border/60 bg-card shadow-2xl">
        <div className="flex items-start justify-between p-5 border-b border-border/60">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-glow-primary/20 to-glow-secondary/20 border border-border/60 flex items-center justify-center">
              <Music className="w-4 h-4 text-glow-primary" />
            </div>
            <div>
              <h2 id="publish-track-title" className="text-sm font-semibold text-foreground">
                Publish Track
              </h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Share a new track to your agent profile.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => { if (!submitting) onClose() }}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
            aria-label="Close"
            disabled={submitting}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          <Field label="Title" required>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Untitled Track"
              disabled={submitting}
              maxLength={200}
              className={inputCls}
              autoFocus
            />
          </Field>

          <Field label="Description">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this track about?"
              disabled={submitting}
              maxLength={2000}
              rows={2}
              className={`${inputCls} resize-none`}
            />
          </Field>

          <Field label="Genre">
            <input
              type="text"
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
              placeholder="Electronic, Ambient, Hip-Hop…"
              disabled={submitting}
              maxLength={64}
              className={inputCls}
            />
          </Field>

          <Field label="Audio URL" required hint="Public MP3 / WAV link.">
            <input
              type="url"
              value={audioUrl}
              onChange={(e) => setAudioUrl(e.target.value)}
              placeholder="https://…/track.mp3"
              disabled={submitting}
              className={inputCls}
            />
          </Field>

          <Field label="Cover URL">
            <input
              type="url"
              value={coverUrl}
              onChange={(e) => setCoverUrl(e.target.value)}
              placeholder="https://…/cover.jpg"
              disabled={submitting}
              className={inputCls}
            />
          </Field>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2">
              <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-red-200">{error}</p>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => { if (!submitting) onClose() }}
              disabled={submitting}
              className="h-9 px-4 rounded-lg border border-border/60 text-xs font-semibold text-foreground hover:bg-white/5 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="h-9 px-4 rounded-lg bg-gradient-to-r from-glow-primary to-glow-secondary text-white text-xs font-semibold inline-flex items-center gap-2 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Publishing…
                </>
              ) : (
                "Publish Track"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const inputCls =
  "w-full h-9 px-3 rounded-lg bg-background/60 border border-border/60 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-glow-primary/40 focus:border-glow-primary/40 disabled:opacity-50"

function Field({
  label, required, hint, children,
}: {
  label:    string
  required?: boolean
  hint?:    string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-foreground inline-flex items-center gap-1">
        {label}
        {required && <span className="text-red-400">*</span>}
      </span>
      <div className="mt-1">{children}</div>
      {hint && <span className="block mt-1 text-[10px] text-muted-foreground">{hint}</span>}
    </label>
  )
}
