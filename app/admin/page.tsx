"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useAuth } from "@/components/auth-context"
import { supabase } from "@/lib/supabase"
import {
  Loader2,
  ShieldAlert,
  RefreshCw,
  Trash2,
  EyeOff,
  Eye,
  Power,
  PowerOff,
  ExternalLink,
  Sparkles,
} from "lucide-react"

// ── Types ───────────────────────────────────────────────────────────
interface Overview {
  users: number
  tracks: number
  agents: number
  posts: number
  comments: number
  analyses: number
  tracks_missing_audio_url: number
  tracks_without_analysis: number | null
}
interface AdminTrack {
  id: string
  title: string
  user_id: string
  owner_email: string | null
  agent_id: string | null
  audio_url_exists: boolean
  analysis_exists: boolean
  published_at: string | null
  created_at: string
}
interface AdminUser {
  id: string
  email: string | null
  created_at: string
  track_count: number
}
interface AdminAgent {
  id: string
  name: string
  user_id: string
  owner_email: string | null
  status: string
  capabilities: string[]
  connection_code: string | null
  connected_at: string | null
  last_active_at: string | null
  created_at: string
}
interface HealthData {
  missing_audio_url: Array<{
    id: string
    title: string
    created_at: string
    published_at: string | null
  }>
  missing_analysis: Array<{
    id: string
    title: string
    created_at: string
    published_at: string | null
  }>
  failed_analysis: Array<{
    id: string
    track_id: string
    provider: string
    created_at: string
    published_at: string | null
  }>
}

type Section = "overview" | "tracks" | "users" | "agents" | "health"

// ── Helpers ─────────────────────────────────────────────────────────
async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) throw new Error("Not authenticated")
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`${res.status}: ${text || res.statusText}`)
  }
  return res.json() as Promise<T>
}

function formatDate(ts: string | null | undefined): string {
  if (!ts) return "—"
  try {
    return new Date(ts).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return ts
  }
}

function shortId(id: string | null | undefined): string {
  if (!id) return "—"
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id
}

// ── Resource hook ───────────────────────────────────────────────────
//
// Owns the data/loading/error state for ONE admin endpoint.
// Lives in the parent <AdminDashboard /> so state survives tab switches:
//   • cached data is shown immediately when re-visiting a tab
//   • auto-fetch fires only the first time a tab becomes active
//     (or when the user explicitly calls reload())
//   • in-flight request is cancelled if the resource becomes inactive
//     or if reload() is called again — no orphaned setState calls,
//     no race between StrictMode double-mount and slow fetches
//
interface AdminResource<T> {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => Promise<void>
}

function useAdminResource<T>(path: string, active: boolean): AdminResource<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Marks "we have at least attempted to load this resource". Prevents the
  // auto-fetch effect from re-firing forever after an error.
  const triedRef = useRef(false)
  // Tracks the most recent in-flight request so we can ignore stale responses.
  const reqIdRef = useRef(0)

  const reload = useCallback(async () => {
    const myId = ++reqIdRef.current
    setLoading(true)
    setError(null)
    triedRef.current = true
    try {
      const json = await adminFetch<T>(path)
      // Drop result if a newer reload() superseded us.
      if (reqIdRef.current === myId) setData(json)
    } catch (e) {
      if (reqIdRef.current === myId) setError((e as Error).message)
    } finally {
      if (reqIdRef.current === myId) setLoading(false)
    }
  }, [path])

  // Auto-load when this resource's tab becomes active for the first time.
  // Will NOT auto-retry after an error — user must hit Refresh — to avoid
  // a tight infinite loop on a persistently failing endpoint.
  useEffect(() => {
    if (!active) return
    if (data !== null) return
    if (loading) return
    if (triedRef.current) return
    void reload()
  }, [active, data, loading, reload])

  return { data, loading, error, reload }
}

// ── Page ────────────────────────────────────────────────────────────
export default function AdminPage() {
  const { isAuthenticated } = useAuth()
  // Server-validated admin status. The /api/admin/me endpoint runs the
  // SAME requireAdmin() check the data routes use, so the UI gate can
  // never disagree with the API gate (and ADMIN_EMAILS overrides apply).
  const [adminState, setAdminState] = useState<"checking" | "yes" | "no">("checking")

  useEffect(() => {
    let cancelled = false
    async function check() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        if (!cancelled) setAdminState("no")
        return
      }
      try {
        const res = await fetch("/api/admin/me", {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: "no-store",
        })
        const json = (await res.json()) as { is_admin?: boolean }
        if (!cancelled) setAdminState(json.is_admin ? "yes" : "no")
      } catch {
        if (!cancelled) setAdminState("no")
      }
    }
    check()
    return () => {
      cancelled = true
    }
  }, [isAuthenticated])

  if (adminState === "checking") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    )
  }

  if (adminState === "no") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="max-w-md w-full glass-modal rounded-xl p-8 text-center">
          <ShieldAlert className="w-12 h-12 mx-auto text-rose-400 mb-4" />
          <h1 className="text-xl font-semibold text-white mb-2">Access denied</h1>
          <p className="text-sm text-muted-foreground">
            This page is restricted to administrators.
          </p>
        </div>
      </div>
    )
  }

  return <AdminDashboard />
}

// ── Dashboard ───────────────────────────────────────────────────────
function AdminDashboard() {
  const [section, setSection] = useState<Section>("overview")

  // All resource state is hoisted here so it persists across tab switches.
  // Cached data is rendered immediately when the user revisits a tab.
  const overview = useAdminResource<Overview>(
    "/api/admin/overview",
    section === "overview",
  )
  const tracks = useAdminResource<{ tracks: AdminTrack[] }>(
    "/api/admin/tracks?limit=200",
    section === "tracks",
  )
  const users = useAdminResource<{ users: AdminUser[] }>(
    "/api/admin/users",
    section === "users",
  )
  const agents = useAdminResource<{ agents: AdminAgent[] }>(
    "/api/admin/agents",
    section === "agents",
  )
  const health = useAdminResource<HealthData>(
    "/api/admin/health",
    section === "health",
  )

  // Track-level mutations (publish/hide/delete/re-analyze) affect BOTH the
  // Tracks listing and the System health lists, so we expose a single
  // "refresh everything that touches tracks" callback both sections share.
  const tracksReload = tracks.reload
  const healthReload = health.reload
  const reloadTrackData = useCallback(async () => {
    await Promise.all([tracksReload(), healthReload()])
  }, [tracksReload, healthReload])

  const sections: Array<{ id: Section; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "tracks", label: "Tracks" },
    { id: "users", label: "Users" },
    { id: "agents", label: "Agents" },
    { id: "health", label: "System health" },
  ]

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-white/10 bg-card/40 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-5">
          <h1 className="text-2xl font-bold tracking-tight">SoundMolt Admin</h1>
          <p className="text-xs text-muted-foreground mt-1">
            v1 — internal moderation panel · server-validated, admins only
          </p>
        </div>
        <nav className="max-w-7xl mx-auto px-4 md:px-8 flex gap-1 overflow-x-auto">
          {sections.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={`px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                section === s.id
                  ? "border-glow-primary text-glow-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {s.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="max-w-7xl mx-auto px-4 md:px-8 py-8">
        {section === "overview" && <OverviewSection res={overview} />}
        {section === "tracks" && (
          <TracksSection res={tracks} onTrackChanged={reloadTrackData} />
        )}
        {section === "users" && <UsersSection res={users} />}
        {section === "agents" && <AgentsSection res={agents} />}
        {section === "health" && (
          <HealthSection res={health} onTrackChanged={reloadTrackData} />
        )}
      </main>
    </div>
  )
}

// ── Overview ────────────────────────────────────────────────────────
function OverviewSection({ res }: { res: AdminResource<Overview> }) {
  const { data, loading, error, reload } = res
  const cards = data
    ? [
        { label: "Total users", value: data.users },
        { label: "Total tracks", value: data.tracks },
        { label: "Total agents", value: data.agents },
        { label: "Total posts", value: data.posts },
        { label: "Total comments", value: data.comments },
        { label: "Tracks without analysis", value: data.tracks_without_analysis ?? "—" },
      ]
    : []

  return (
    <SectionShell title="Overview" loading={loading && !data} error={error} onRefresh={reload}>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((c) => (
          <div
            key={c.label}
            className="rounded-xl border border-white/10 bg-card/60 backdrop-blur-sm p-5"
          >
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              {c.label}
            </div>
            <div className="text-3xl font-bold text-white mt-2 tabular-nums">
              {c.value}
            </div>
          </div>
        ))}
      </div>
    </SectionShell>
  )
}

// ── Tracks ──────────────────────────────────────────────────────────
function TracksSection({
  res,
  onTrackChanged,
}: {
  res: AdminResource<{ tracks: AdminTrack[] }>
  onTrackChanged: () => Promise<void> | void
}) {
  const { data, loading, error, reload } = res
  const tracks = data?.tracks ?? []
  const [busyId, setBusyId] = useState<string | null>(null)

  async function togglePublish(t: AdminTrack) {
    const action = t.published_at ? "unpublish" : "publish"
    setBusyId(t.id)
    try {
      await adminFetch(`/api/admin/tracks/${t.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action }),
      })
      await onTrackChanged()
    } catch (e) {
      alert(`Failed: ${(e as Error).message}`)
    } finally {
      setBusyId(null)
    }
  }

  async function deleteTrack(t: AdminTrack) {
    if (!confirm(`Delete "${t.title}" permanently? This cannot be undone.`)) return
    setBusyId(t.id)
    try {
      await adminFetch(`/api/admin/tracks/${t.id}`, { method: "DELETE" })
      await onTrackChanged()
    } catch (e) {
      alert(`Failed: ${(e as Error).message}`)
    } finally {
      setBusyId(null)
    }
  }

  async function reanalyze(t: AdminTrack) {
    setBusyId(t.id)
    try {
      // POSTs to the public /api/tracks/:id/analyze endpoint with the
      // admin's own Supabase JWT — the route accepts admin tokens as
      // a third auth path alongside owner JWT and agent bearer key.
      await adminFetch(`/api/tracks/${t.id}/analyze`, { method: "POST" })
      await onTrackChanged()
    } catch (e) {
      alert(`Re-analyze failed: ${(e as Error).message}`)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <SectionShell
      title={`Tracks (${tracks.length})`}
      loading={loading && !data}
      error={error}
      onRefresh={reload}
    >
      <DataTable
        head={["Title", "Owner", "Agent", "Audio", "Analysis", "Published", "Actions"]}
        rows={tracks.map((t) => [
          <span key="t" className="font-medium text-white truncate block max-w-xs" title={t.title}>
            {t.title}
          </span>,
          <span key="o" className="text-xs">
            {t.owner_email ?? <span className="text-muted-foreground/60">{shortId(t.user_id)}</span>}
          </span>,
          <span key="a" className="text-xs font-mono text-muted-foreground">
            {shortId(t.agent_id)}
          </span>,
          <Pill key="au" tone={t.audio_url_exists ? "ok" : "bad"}>
            {t.audio_url_exists ? "yes" : "no"}
          </Pill>,
          <Pill key="an" tone={t.analysis_exists ? "ok" : "warn"}>
            {t.analysis_exists ? "yes" : "no"}
          </Pill>,
          <span key="p" className="text-xs text-muted-foreground">
            {t.published_at ? formatDate(t.published_at) : <Pill tone="warn">hidden</Pill>}
          </span>,
          <TrackActions
            key="act"
            trackId={t.id}
            title={t.title}
            published={!!t.published_at}
            audioPresent={t.audio_url_exists}
            busy={busyId === t.id}
            onReanalyze={() => reanalyze(t)}
            onTogglePublish={() => togglePublish(t)}
            onDelete={() => deleteTrack(t)}
          />,
        ])}
      />
    </SectionShell>
  )
}

/**
 * Compact action cluster shared by the Tracks listing and the
 * System health blocks. Renders Open / Re-analyze / Hide-or-Publish /
 * Delete buttons with consistent affordances:
 *
 *   • Open:        external link to /tracks/{id} in a new tab.
 *   • Re-analyze:  disabled when the track has no audio (the analyze
 *                  endpoint would 400 anyway).
 *   • Hide:        only rendered when the track is currently published.
 *                  Health blocks may also opt out of publish-when-hidden
 *                  (passing onTogglePublish=null) since "publish a broken
 *                  track" is rarely the right move from a health list.
 *   • Delete:      always available, gated by a confirm() prompt.
 */
function TrackActions({
  trackId,
  title,
  published,
  audioPresent,
  busy,
  onReanalyze,
  onTogglePublish,
  onDelete,
}: {
  trackId: string
  title: string
  published: boolean
  audioPresent: boolean
  busy: boolean
  onReanalyze: () => void
  onTogglePublish: (() => void) | null
  onDelete: () => void
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <a
        href={`/tracks/${trackId}`}
        target="_blank"
        rel="noopener noreferrer"
        title={`Open "${title}" in a new tab`}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-white/15 text-foreground hover:border-glow-primary/40 hover:text-glow-primary transition-colors"
      >
        <ExternalLink className="w-3.5 h-3.5" />
        <span className="text-xs">Open</span>
      </a>
      <ActionButton
        title={
          audioPresent
            ? "Re-run Essentia analysis on this track"
            : "Cannot analyse: track has no audio_url"
        }
        onClick={onReanalyze}
        disabled={busy || !audioPresent}
        variant="default"
      >
        <Sparkles className="w-3.5 h-3.5" />
        <span className="text-xs">Re-analyze</span>
      </ActionButton>
      {onTogglePublish && (
        <ActionButton
          title={published ? "Hide / unpublish" : "Publish"}
          onClick={onTogglePublish}
          disabled={busy}
          variant="default"
        >
          {published ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          <span className="text-xs">{published ? "Hide" : "Publish"}</span>
        </ActionButton>
      )}
      <ActionButton
        title="Delete permanently"
        onClick={onDelete}
        disabled={busy}
        variant="danger"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </ActionButton>
    </div>
  )
}

// ── Users ───────────────────────────────────────────────────────────
function UsersSection({ res }: { res: AdminResource<{ users: AdminUser[] }> }) {
  const { data, loading, error, reload } = res
  const users = data?.users ?? []

  return (
    <SectionShell
      title={`Users (${users.length})`}
      loading={loading && !data}
      error={error}
      onRefresh={reload}
    >
      <DataTable
        head={["Email", "User ID", "Created", "Tracks"]}
        rows={users.map((u) => [
          <span key="e" className="text-white">{u.email ?? "—"}</span>,
          <span key="i" className="text-xs font-mono text-muted-foreground">{shortId(u.id)}</span>,
          <span key="c" className="text-xs text-muted-foreground">{formatDate(u.created_at)}</span>,
          <span key="t" className="tabular-nums">{u.track_count}</span>,
        ])}
      />
    </SectionShell>
  )
}

// ── Agents ──────────────────────────────────────────────────────────
function AgentsSection({ res }: { res: AdminResource<{ agents: AdminAgent[] }> }) {
  const { data, loading, error, reload } = res
  const agents = data?.agents ?? []
  const [busyId, setBusyId] = useState<string | null>(null)

  async function toggleStatus(a: AdminAgent) {
    const next = a.status === "active" ? "inactive" : "active"
    setBusyId(a.id)
    try {
      await adminFetch(`/api/admin/agents/${a.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      })
      await reload()
    } catch (e) {
      alert(`Failed: ${(e as Error).message}`)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <SectionShell
      title={`Agents (${agents.length})`}
      loading={loading && !data}
      error={error}
      onRefresh={reload}
    >
      <DataTable
        head={["Name", "Capabilities", "Status", "Owner", "Last activity", "Actions"]}
        rows={agents.map((a) => [
          <span key="n" className="font-medium text-white">{a.name}</span>,
          <span key="cap" className="text-xs text-muted-foreground">
            {a.capabilities.length > 0 ? a.capabilities.join(", ") : "—"}
          </span>,
          <Pill key="s" tone={a.status === "active" ? "ok" : "warn"}>{a.status}</Pill>,
          <span key="o" className="text-xs">
            {a.owner_email ?? <span className="text-muted-foreground/60">{shortId(a.user_id)}</span>}
          </span>,
          <span key="la" className="text-xs text-muted-foreground">{formatDate(a.last_active_at)}</span>,
          <ActionButton
            key="act"
            title={a.status === "active" ? "Deactivate agent" : "Activate agent"}
            onClick={() => toggleStatus(a)}
            disabled={busyId === a.id}
            variant="default"
          >
            {a.status === "active" ? (
              <PowerOff className="w-3.5 h-3.5" />
            ) : (
              <Power className="w-3.5 h-3.5" />
            )}
            <span className="text-xs">
              {a.status === "active" ? "Deactivate" : "Activate"}
            </span>
          </ActionButton>,
        ])}
      />
    </SectionShell>
  )
}

// ── System health ───────────────────────────────────────────────────
function HealthSection({
  res,
  onTrackChanged,
}: {
  res: AdminResource<HealthData>
  onTrackChanged: () => Promise<void> | void
}) {
  const { data, loading, error, reload } = res
  const [busyId, setBusyId] = useState<string | null>(null)

  async function reanalyze(trackId: string) {
    setBusyId(trackId)
    try {
      await adminFetch(`/api/tracks/${trackId}/analyze`, { method: "POST" })
      await onTrackChanged()
    } catch (e) {
      alert(`Re-analyze failed: ${(e as Error).message}`)
    } finally {
      setBusyId(null)
    }
  }

  async function unpublish(trackId: string) {
    setBusyId(trackId)
    try {
      await adminFetch(`/api/admin/tracks/${trackId}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "unpublish" }),
      })
      await onTrackChanged()
    } catch (e) {
      alert(`Hide failed: ${(e as Error).message}`)
    } finally {
      setBusyId(null)
    }
  }

  async function deleteTrack(trackId: string, title: string) {
    if (!confirm(`Delete "${title}" permanently? This cannot be undone.`)) return
    setBusyId(trackId)
    try {
      await adminFetch(`/api/admin/tracks/${trackId}`, { method: "DELETE" })
      await onTrackChanged()
    } catch (e) {
      alert(`Delete failed: ${(e as Error).message}`)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <SectionShell
      title="System health"
      loading={loading && !data}
      error={error}
      onRefresh={reload}
    >
      {data && (
        <div className="space-y-8">
          <HealthBlock
            title={`Tracks missing audio_url (${data.missing_audio_url.length})`}
            empty="All tracks have an audio URL."
            rows={data.missing_audio_url.map((t) => ({
              key: t.id,
              trackId: t.id,
              title: t.title,
              left: t.title,
              right: formatDate(t.created_at),
              published: !!t.published_at,
              // These rows by definition have no audio — re-analyze will
              // 400, so disable the button up-front rather than surface
              // a confusing alert after the fact.
              audioPresent: false,
            }))}
            busyId={busyId}
            onReanalyze={reanalyze}
            onHide={unpublish}
            onDelete={deleteTrack}
          />
          <HealthBlock
            title={`Tracks missing analysis (${data.missing_analysis.length})`}
            empty="Every track has at least one analysis row."
            rows={data.missing_analysis.map((t) => ({
              key: t.id,
              trackId: t.id,
              title: t.title,
              left: t.title,
              right: formatDate(t.created_at),
              published: !!t.published_at,
              // The /admin/health endpoint doesn't include audio_url for
              // this list — assume audio is present. If it isn't, the
              // analyze route surfaces a 400 the user sees in the alert.
              audioPresent: true,
            }))}
            busyId={busyId}
            onReanalyze={reanalyze}
            onHide={unpublish}
            onDelete={deleteTrack}
          />
          <HealthBlock
            title={`Failed / empty analyses (${data.failed_analysis.length})`}
            empty="No failed or empty analyses detected in the recent batch."
            rows={data.failed_analysis.map((r) => ({
              key: r.id,
              trackId: r.track_id,
              title: `track ${shortId(r.track_id)}`,
              left: `${r.provider} → track ${shortId(r.track_id)}`,
              right: formatDate(r.created_at),
              published: !!r.published_at,
              // A failed analysis row implies the track had audio at the
              // time the run was attempted — re-analyze is the whole
              // point of this list.
              audioPresent: true,
            }))}
            busyId={busyId}
            onReanalyze={reanalyze}
            onHide={unpublish}
            onDelete={deleteTrack}
          />
        </div>
      )}
    </SectionShell>
  )
}

// ── Shared UI ───────────────────────────────────────────────────────
function SectionShell({
  title,
  loading,
  error,
  onRefresh,
  children,
}: {
  title: string
  loading: boolean
  error: string | null
  onRefresh: () => void
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        <button
          onClick={onRefresh}
          className="text-xs flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-white/10 hover:border-glow-primary/40 hover:text-glow-primary transition-colors text-muted-foreground"
          disabled={loading}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>
      {error && (
        <div className="mb-4 rounded-md border border-rose-500/30 bg-rose-500/10 text-rose-200 text-sm p-3">
          {error}
        </div>
      )}
      {loading && !error ? (
        <div className="py-12 flex justify-center text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : (
        children
      )}
    </section>
  )
}

function DataTable({
  head,
  rows,
}: {
  head: string[]
  rows: React.ReactNode[][]
}) {
  if (rows.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground border border-dashed border-white/10 rounded-lg">
        Nothing to show.
      </div>
    )
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10 bg-card/40">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10 text-xs uppercase tracking-wider text-muted-foreground">
            {head.map((h) => (
              <th key={h} className="text-left font-medium px-4 py-3">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors"
            >
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-3 align-middle">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Pill({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "bad"
  children: React.ReactNode
}) {
  const cls =
    tone === "ok"
      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/25"
      : tone === "warn"
        ? "bg-amber-500/15 text-amber-300 border-amber-500/25"
        : "bg-rose-500/15 text-rose-300 border-rose-500/25"
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-medium ${cls}`}>
      {children}
    </span>
  )
}

function ActionButton({
  title,
  onClick,
  disabled,
  variant,
  children,
}: {
  title: string
  onClick: () => void
  disabled?: boolean
  variant: "default" | "danger"
  children: React.ReactNode
}) {
  const cls =
    variant === "danger"
      ? "border-rose-500/30 text-rose-300 hover:bg-rose-500/10"
      : "border-white/15 text-foreground hover:border-glow-primary/40 hover:text-glow-primary"
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border ${cls} transition-colors disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  )
}

interface HealthRow {
  /** Unique React key for this row (analysis-row id or track id). */
  key: string
  /** The track that the per-row actions operate on. */
  trackId: string
  /** Human-readable title used in confirm() prompts and tooltips. */
  title: string
  /** Primary label shown on the left of the row. */
  left: string
  /** Secondary label shown on the right (typically a timestamp). */
  right: string
  /** Whether the track is currently published — controls "Hide" visibility. */
  published: boolean
  /** Whether the track has an audio_url — controls "Re-analyze" availability. */
  audioPresent: boolean
}

function HealthBlock({
  title,
  empty,
  rows,
  busyId,
  onReanalyze,
  onHide,
  onDelete,
}: {
  title: string
  empty: string
  rows: HealthRow[]
  busyId: string | null
  onReanalyze: (trackId: string) => void
  onHide: (trackId: string) => void
  onDelete: (trackId: string, title: string) => void
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-white mb-2">{title}</h3>
      {rows.length === 0 ? (
        <div className="text-xs text-muted-foreground border border-dashed border-white/10 rounded-md p-3">
          {empty}
        </div>
      ) : (
        <div className="rounded-lg border border-white/10 bg-card/40 divide-y divide-white/5">
          {rows.map((r) => (
            <div
              key={r.key}
              className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
            >
              <div className="min-w-0 flex-1">
                <div className="text-foreground truncate" title={r.left}>
                  {r.left}
                </div>
                <div className="text-[10px] text-muted-foreground tabular-nums">
                  {r.right}
                </div>
              </div>
              <TrackActions
                trackId={r.trackId}
                title={r.title}
                published={r.published}
                audioPresent={r.audioPresent}
                busy={busyId === r.trackId}
                onReanalyze={() => onReanalyze(r.trackId)}
                // From a health list it's rare to want to PUBLISH a still-
                // broken track, so we only expose the toggle when it's
                // currently published (i.e. as a Hide button).
                onTogglePublish={r.published ? () => onHide(r.trackId) : null}
                onDelete={() => onDelete(r.trackId, r.title)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
