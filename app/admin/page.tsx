"use client"

import { useCallback, useEffect, useState } from "react"
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
  provider: string | null
  model_name: string | null
  status: string
  last_active_at: string | null
  created_at: string
}
interface HealthData {
  missing_audio_url: Array<{ id: string; title: string; created_at: string }>
  missing_analysis: Array<{ id: string; title: string; created_at: string }>
  failed_analysis: Array<{ id: string; track_id: string; provider: string; created_at: string }>
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
      // Wait for auth to settle: if we're definitively unauthenticated
      // there's no token to send and we can short-circuit to "no".
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
        {section === "overview" && <OverviewSection />}
        {section === "tracks" && <TracksSection />}
        {section === "users" && <UsersSection />}
        {section === "agents" && <AgentsSection />}
        {section === "health" && <HealthSection />}
      </main>
    </div>
  )
}

// ── Overview ────────────────────────────────────────────────────────
function OverviewSection() {
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await adminFetch<Overview>("/api/admin/overview"))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

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
    <SectionShell title="Overview" loading={loading} error={error} onRefresh={load}>
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
function TracksSection() {
  const [tracks, setTracks] = useState<AdminTrack[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await adminFetch<{ tracks: AdminTrack[] }>("/api/admin/tracks?limit=200")
      setTracks(data.tracks)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function togglePublish(t: AdminTrack) {
    const action = t.published_at ? "unpublish" : "publish"
    setBusyId(t.id)
    try {
      await adminFetch(`/api/admin/tracks/${t.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action }),
      })
      await load()
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
      await load()
    } catch (e) {
      alert(`Failed: ${(e as Error).message}`)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <SectionShell title={`Tracks (${tracks.length})`} loading={loading} error={error} onRefresh={load}>
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
          <div key="act" className="flex items-center gap-1.5">
            <ActionButton
              title={t.published_at ? "Hide / unpublish" : "Publish"}
              onClick={() => togglePublish(t)}
              disabled={busyId === t.id}
              variant="default"
            >
              {t.published_at ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              <span className="text-xs">{t.published_at ? "Hide" : "Publish"}</span>
            </ActionButton>
            <ActionButton
              title="Delete"
              onClick={() => deleteTrack(t)}
              disabled={busyId === t.id}
              variant="danger"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </ActionButton>
          </div>,
        ])}
      />
    </SectionShell>
  )
}

// ── Users ───────────────────────────────────────────────────────────
function UsersSection() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await adminFetch<{ users: AdminUser[] }>("/api/admin/users")
      setUsers(data.users)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <SectionShell title={`Users (${users.length})`} loading={loading} error={error} onRefresh={load}>
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
function AgentsSection() {
  const [agents, setAgents] = useState<AdminAgent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await adminFetch<{ agents: AdminAgent[] }>("/api/admin/agents")
      setAgents(data.agents)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function toggleStatus(a: AdminAgent) {
    const next = a.status === "active" ? "inactive" : "active"
    setBusyId(a.id)
    try {
      await adminFetch(`/api/admin/agents/${a.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      })
      await load()
    } catch (e) {
      alert(`Failed: ${(e as Error).message}`)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <SectionShell title={`Agents (${agents.length})`} loading={loading} error={error} onRefresh={load}>
      <DataTable
        head={["Name", "Provider / Model", "Status", "Owner", "Last activity", "Actions"]}
        rows={agents.map((a) => [
          <span key="n" className="font-medium text-white">{a.name}</span>,
          <span key="pm" className="text-xs text-muted-foreground">
            {a.provider ?? "—"}{a.model_name ? ` · ${a.model_name}` : ""}
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
function HealthSection() {
  const [data, setData] = useState<HealthData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await adminFetch<HealthData>("/api/admin/health"))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <SectionShell title="System health" loading={loading} error={error} onRefresh={load}>
      {data && (
        <div className="space-y-8">
          <HealthBlock
            title={`Tracks missing audio_url (${data.missing_audio_url.length})`}
            empty="All tracks have an audio URL."
            rows={data.missing_audio_url.map((t) => ({
              id: t.id,
              left: t.title,
              right: formatDate(t.created_at),
            }))}
          />
          <HealthBlock
            title={`Tracks missing analysis (${data.missing_analysis.length})`}
            empty="Every track has at least one analysis row."
            rows={data.missing_analysis.map((t) => ({
              id: t.id,
              left: t.title,
              right: formatDate(t.created_at),
            }))}
          />
          <HealthBlock
            title={`Failed / empty analyses (${data.failed_analysis.length})`}
            empty="No failed or empty analyses detected in the recent batch."
            rows={data.failed_analysis.map((r) => ({
              id: r.id,
              left: `${r.provider} → track ${shortId(r.track_id)}`,
              right: formatDate(r.created_at),
            }))}
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

function HealthBlock({
  title,
  empty,
  rows,
}: {
  title: string
  empty: string
  rows: Array<{ id: string; left: string; right: string }>
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
            <div key={r.id} className="flex items-center justify-between px-4 py-2 text-sm">
              <span className="text-foreground truncate" title={r.left}>{r.left}</span>
              <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap ml-3">
                {r.right}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
