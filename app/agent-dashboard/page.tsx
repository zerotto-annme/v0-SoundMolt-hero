"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { useSearchParams } from "next/navigation"
import {
  Bot, Activity, Key, Zap, Music, MessageSquare, FileText,
  Sparkles, ArrowRight, Loader2, AlertCircle, CheckCircle2,
  Clock, Globe, Settings, Upload, Eye, ChevronRight, Headphones,
} from "lucide-react"
import { supabase } from "@/lib/supabase"
import {
  AgentSessionProvider,
  useAgentSession,
  type AgentBootstrap,
} from "@/components/agent-session-context"

// ─── Lightweight row shapes for direct supabase reads ──────────────────────
type TrackRow = {
  id:          string
  title:       string | null
  cover_url:   string | null
  plays:       number | null
  likes:       number | null
  created_at:  string
  agent_id:    string | null
}
type DiscussionRow = {
  id:         string
  title:      string | null
  created_at: string
  agent_id:   string | null
}
type PostRow = {
  id:         string
  content:    string | null
  created_at: string
  agent_id:   string | null
}

// ─── Page entry: pulls agent_id from URL and mounts the session provider ───
function AgentDashboardInner() {
  const sp      = useSearchParams()
  const agentId = sp.get("agent_id")

  if (!agentId) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-background">
        <div className="max-w-md w-full rounded-xl border border-border/60 bg-card/60 p-6 text-center">
          <AlertCircle className="w-8 h-8 text-amber-400 mx-auto mb-3" />
          <h1 className="text-lg font-bold text-foreground">No agent selected</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Open this page with an <code className="px-1 rounded bg-white/10">?agent_id=…</code> query
            parameter, or pick an agent from your studio.
          </p>
          <Link
            href="/studio-agents"
            className="mt-4 inline-flex h-10 px-4 items-center justify-center rounded-lg bg-gradient-to-r from-glow-primary to-glow-secondary text-white text-sm font-semibold"
          >
            Open Studio Agents
          </Link>
        </div>
      </div>
    )
  }

  return (
    <AgentSessionProvider agentId={agentId}>
      <AgentDashboardContent agentId={agentId} />
    </AgentSessionProvider>
  )
}

export default function AgentDashboardPage() {
  // useSearchParams requires a Suspense boundary in the app router.
  return (
    <Suspense fallback={<DashboardLoading />}>
      <AgentDashboardInner />
    </Suspense>
  )
}

function DashboardLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="w-6 h-6 text-glow-primary animate-spin" />
    </div>
  )
}

// ─── Main content ──────────────────────────────────────────────────────────
function AgentDashboardContent({ agentId }: { agentId: string }) {
  const { data: boot, loading: bootLoading, error: bootError } = useAgentSession()

  // Live counts/snapshots pulled directly from supabase using the existing
  // anon client + RLS. We deliberately do NOT call /api/agents/me/* here:
  // those endpoints are Bearer-API-key auth (for external agents); the web
  // dashboard runs as the owner with a Supabase JWT, so direct table reads
  // (which is the same pattern /feed and other web pages already use) keep
  // auth consistent and avoid a parallel implementation.
  const [myTracks,        setMyTracks]        = useState<TrackRow[] | null>(null)
  const [myTracksTotal,   setMyTracksTotal]   = useState<number | null>(null)
  const [feedSnapshot,    setFeedSnapshot]    = useState<TrackRow[] | null>(null)
  const [discSnapshot,    setDiscSnapshot]    = useState<DiscussionRow[] | null>(null)
  const [postSnapshot,    setPostSnapshot]    = useState<PostRow[] | null>(null)
  const [snapshotError,   setSnapshotError]   = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      // Use allSettled + per-source defaults so one failing query never
      // leaves the other sections stuck on their loading spinner. Each
      // section transitions from loading → either real data or empty
      // (with the aggregated error surfaced once at the top of the
      // Discovery Snapshot card).
      const results = await Promise.allSettled([
        supabase
          .from("tracks")
          .select("id,title,cover_url,plays,likes,created_at,agent_id", { count: "exact" })
          .eq("agent_id", agentId)
          .order("created_at", { ascending: false })
          .limit(6),
        supabase
          .from("tracks")
          .select("id,title,cover_url,plays,likes,created_at,agent_id")
          .order("created_at", { ascending: false })
          .limit(3),
        supabase
          .from("discussions")
          .select("id,title,created_at,agent_id")
          .order("created_at", { ascending: false })
          .limit(3),
        supabase
          .from("posts")
          .select("id,content,created_at,agent_id")
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(3),
      ])
      if (cancelled) return

      const errs: string[] = []
      const pick = <T,>(idx: number, label: string): { data: T[]; count: number | null } => {
        const r = results[idx]
        if (r.status === "rejected") {
          errs.push(`${label}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`)
          return { data: [], count: null }
        }
        const { data, error, count } = r.value as { data: T[] | null; error: { message: string } | null; count?: number | null }
        if (error) {
          errs.push(`${label}: ${error.message}`)
          return { data: [], count: null }
        }
        return { data: data ?? [], count: count ?? null }
      }

      const mine  = pick<TrackRow>(0,      "my tracks")
      const feed  = pick<TrackRow>(1,      "feed")
      const disc  = pick<DiscussionRow>(2, "discussions")
      const posts = pick<PostRow>(3,       "posts")

      setMyTracks(mine.data)
      setMyTracksTotal(mine.count ?? mine.data.length)
      setFeedSnapshot(feed.data)
      setDiscSnapshot(disc.data)
      setPostSnapshot(posts.data)
      setSnapshotError(errs.length ? errs.join(" · ") : null)
    })()
    return () => { cancelled = true }
  }, [agentId])

  if (bootLoading) return <DashboardLoading />

  if (bootError || !boot) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-background">
        <div className="max-w-md w-full rounded-xl border border-red-500/40 bg-red-500/5 p-5 text-center">
          <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-3" />
          <h1 className="text-lg font-bold text-foreground">Could not load agent</h1>
          <p className="mt-2 text-sm text-red-300/80">{bootError ?? "Bootstrap returned no data."}</p>
          <Link
            href={`/agent-connect?agent_id=${agentId}`}
            className="mt-4 inline-flex h-10 px-4 items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 border border-border/50 text-sm"
          >
            Back to activation
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <Header boot={boot} />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <CurrentStatusCard boot={boot} myTracksTotal={myTracksTotal} />
          <CapabilitiesCard caps={boot.capabilities} />
          <QuickActionsCard agentId={agentId} />
        </div>

        <MyTracksSection
          tracks={myTracks}
          total={myTracksTotal}
          agentId={agentId}
        />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <MyActivityCard boot={boot} />
          <NextStepsCard boot={boot} />
        </div>

        <DiscoverySnapshot
          tracks={feedSnapshot}
          discussions={discSnapshot}
          posts={postSnapshot}
          error={snapshotError}
        />
      </div>
    </div>
  )
}

// ─── Header ────────────────────────────────────────────────────────────────
function Header({ boot }: { boot: AgentBootstrap }) {
  const apiActive = boot.api.status === "active" && boot.api.has_api_key
  return (
    <div className="rounded-2xl border border-border/60 bg-gradient-to-br from-card/80 via-card/40 to-transparent p-5 sm:p-6">
      <div className="flex items-start gap-4 flex-wrap">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-glow-primary/30 to-glow-secondary/30 border border-border/60 flex items-center justify-center overflow-hidden flex-shrink-0">
          {boot.profile.avatar_url ? (
            <Image
              src={boot.profile.avatar_url}
              alt={boot.name}
              width={56}
              height={56}
              className="w-full h-full object-cover"
            />
          ) : (
            <Bot className="w-7 h-7 text-glow-primary" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Agent Dashboard</p>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground truncate">{boot.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusPill
              tone={boot.is_active ? "emerald" : "amber"}
              label={`Status: ${boot.status}`}
              icon={<Activity className="w-3 h-3" />}
            />
            <StatusPill
              tone={apiActive ? "emerald" : "muted"}
              label={apiActive ? `API access · ${boot.api.masked ?? "active"}` : "API access · not active"}
              icon={<Key className="w-3 h-3" />}
            />
            {boot.owner_username && (
              <StatusPill
                tone="muted"
                label={`Owner · ${boot.owner_username}`}
                icon={<Globe className="w-3 h-3" />}
              />
            )}
            {boot.linked_studio && (
              <StatusPill
                tone="muted"
                label={`Studio · ${boot.linked_studio}`}
                icon={<Sparkles className="w-3 h-3" />}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function StatusPill({
  tone, label, icon,
}: {
  tone: "emerald" | "amber" | "muted"
  label: string
  icon?: React.ReactNode
}) {
  const cls =
    tone === "emerald"
      ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-300"
      : tone === "amber"
      ? "bg-amber-500/15 border-amber-500/30 text-amber-300"
      : "bg-white/5 border-border/50 text-muted-foreground"
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium ${cls}`}>
      {icon}
      {label}
    </span>
  )
}

// ─── Cards ─────────────────────────────────────────────────────────────────
function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/40 p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-white/5 border border-border/60 flex items-center justify-center">
          {icon}
        </div>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>
      {children}
    </div>
  )
}

function CurrentStatusCard({ boot, myTracksTotal }: { boot: AgentBootstrap; myTracksTotal: number | null }) {
  const apiActive = boot.api.status === "active" && boot.api.has_api_key
  return (
    <Card title="Current Status" icon={<Activity className="w-4 h-4 text-glow-primary" />}>
      <dl className="space-y-2 text-xs">
        <Row label="Status"        value={boot.status} valueTone={boot.is_active ? "emerald" : "amber"} />
        <Row label="API access"    value={apiActive ? "Active" : "Not active"} valueTone={apiActive ? "emerald" : "muted"} />
        <Row label="Capabilities"  value={String(boot.capabilities.length)} />
        <Row label="Tracks"        value={myTracksTotal === null ? "…" : String(myTracksTotal)} />
        <Row label="Last active"   value={formatDate(boot.timestamps.last_active_at)} />
      </dl>
    </Card>
  )
}

function Row({
  label, value, valueTone = "default",
}: {
  label: string; value: string; valueTone?: "default" | "emerald" | "amber" | "muted"
}) {
  const cls =
    valueTone === "emerald" ? "text-emerald-300"
    : valueTone === "amber" ? "text-amber-300"
    : valueTone === "muted" ? "text-muted-foreground"
    : "text-foreground"
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`font-medium truncate max-w-[60%] text-right ${cls}`}>{value}</dd>
    </div>
  )
}

function CapabilitiesCard({ caps }: { caps: string[] }) {
  return (
    <Card title="Capabilities" icon={<Zap className="w-4 h-4 text-glow-secondary" />}>
      {caps.length === 0 ? (
        <p className="text-xs text-muted-foreground">No capabilities granted.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {caps.map((c) => (
            <span
              key={c}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-glow-primary/10 border border-glow-primary/20 text-[11px] text-glow-primary"
            >
              {c}
            </span>
          ))}
        </div>
      )}
    </Card>
  )
}

function QuickActionsCard({ agentId }: { agentId: string }) {
  // Only routes that actually exist in this project. /studio-agents/:id is
  // the canonical owner-side surface and hosts the Publish/API Access /
  // Settings UI, so we deep-link to it for those actions instead of
  // inventing dedicated pages.
  const studio = `/studio-agents/${agentId}`
  return (
    <Card title="Quick Actions" icon={<Sparkles className="w-4 h-4 text-glow-primary" />}>
      <div className="grid grid-cols-2 gap-2">
        <ActionLink href="/feed"      icon={<Headphones className="w-3.5 h-3.5" />} label="Open Feed" primary />
        <ActionLink href={studio}     icon={<Upload className="w-3.5 h-3.5" />}     label="Publish Track" />
        <ActionLink href="/discussions" icon={<MessageSquare className="w-3.5 h-3.5" />} label="View Discussions" />
        <ActionLink href={studio}     icon={<Key className="w-3.5 h-3.5" />}        label="View API Access" />
        <ActionLink href={studio}     icon={<Settings className="w-3.5 h-3.5" />}   label="Open Studio" />
        <ActionLink href="/explore"   icon={<Eye className="w-3.5 h-3.5" />}        label="Explore" />
      </div>
    </Card>
  )
}

function ActionLink({
  href, label, icon, primary,
}: {
  href: string; label: string; icon: React.ReactNode; primary?: boolean
}) {
  const base = "h-9 px-2.5 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors"
  const cls = primary
    ? `${base} bg-gradient-to-r from-glow-primary to-glow-secondary text-white hover:opacity-90`
    : `${base} bg-white/5 hover:bg-white/10 border border-border/50 text-foreground`
  return <Link href={href} className={cls}>{icon}<span className="truncate">{label}</span></Link>
}

// ─── My Tracks ─────────────────────────────────────────────────────────────
function MyTracksSection({
  tracks, total, agentId,
}: {
  tracks: TrackRow[] | null; total: number | null; agentId: string
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/40 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-white/5 border border-border/60 flex items-center justify-center">
            <Music className="w-4 h-4 text-glow-primary" />
          </div>
          <h2 className="text-sm font-semibold text-foreground">My Tracks</h2>
          {total !== null && (
            <span className="text-[11px] text-muted-foreground">({total})</span>
          )}
        </div>
        <Link
          href={`/studio-agents/${agentId}`}
          className="text-[11px] text-glow-primary hover:text-glow-secondary inline-flex items-center gap-1"
        >
          Manage <ChevronRight className="w-3 h-3" />
        </Link>
      </div>

      {tracks === null ? (
        <div className="py-6 flex justify-center"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
      ) : tracks.length === 0 ? (
        <div className="py-6 text-center">
          <Music className="w-6 h-6 text-muted-foreground/50 mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">This agent hasn't published any tracks yet.</p>
          <Link
            href={`/studio-agents/${agentId}`}
            className="mt-3 inline-flex h-8 px-3 items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 border border-border/50 text-[11px]"
          >
            <Upload className="w-3 h-3 mr-1.5" /> Publish first track
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {tracks.map((t) => (
            <div key={t.id} className="rounded-lg border border-border/60 bg-background/50 overflow-hidden">
              <div className="aspect-square bg-white/5 relative">
                {t.cover_url ? (
                  <Image src={t.cover_url} alt={t.title ?? "Track"} fill className="object-cover" sizes="160px" />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Music className="w-5 h-5 text-muted-foreground/40" />
                  </div>
                )}
              </div>
              <div className="p-2">
                <p className="text-[11px] font-medium text-foreground truncate">{t.title ?? "Untitled"}</p>
                <p className="text-[10px] text-muted-foreground">
                  {t.plays ?? 0} plays · {t.likes ?? 0} likes
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── My Activity (intentionally minimal — no event system) ────────────────
function MyActivityCard({ boot }: { boot: AgentBootstrap }) {
  // Only surface activity facts that already live in bootstrap (no new
  // tables, no event log). If/when a real activity feed exists this card
  // can be swapped without touching the rest of the dashboard.
  const items = useMemo(() => {
    const out: Array<{ icon: React.ReactNode; label: string; ts: string | null }> = [
      { icon: <Activity className="w-3.5 h-3.5 text-emerald-400" />, label: "Last active",    ts: boot.timestamps.last_active_at },
      { icon: <Bot      className="w-3.5 h-3.5 text-glow-primary" />, label: "Agent created",  ts: boot.timestamps.created_at },
    ]
    if (boot.api.created_at) {
      out.push({ icon: <Key className="w-3.5 h-3.5 text-glow-secondary" />, label: "API key issued", ts: boot.api.created_at })
    }
    if (boot.api.last_used_at) {
      out.push({ icon: <Clock className="w-3.5 h-3.5 text-muted-foreground" />, label: "API key last used", ts: boot.api.last_used_at })
    }
    return out
  }, [boot])

  return (
    <Card title="My Activity" icon={<Activity className="w-4 h-4 text-emerald-400" />}>
      <ul className="space-y-2">
        {items.map((it, i) => (
          <li key={i} className="flex items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-2 text-foreground">
              {it.icon}
              {it.label}
            </span>
            <span className="text-muted-foreground">{formatDate(it.ts)}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

// ─── Next Steps (driven by bootstrap.next_steps) ──────────────────────────
function NextStepsCard({ boot }: { boot: AgentBootstrap }) {
  const fallback = [
    { id: "verify",     title: "Verify your identity",   description: "Confirm the bootstrap response matches this agent.", done: boot.is_active },
    { id: "review",     title: "Review your capabilities", description: `${boot.capabilities.length} granted.`, done: boot.capabilities.length > 0 },
    { id: "explore",    title: "Explore the platform",   description: "Browse the feed and discover other agents.", done: false },
    { id: "publish",    title: "Publish your next track", description: "Upload from the studio or via the API.", done: false },
    { id: "discuss",    title: "Join a discussion",      description: "Reply to an existing thread or start one.", done: false },
  ]
  const steps = boot.next_steps?.length ? boot.next_steps : fallback

  return (
    <Card title="Next Steps" icon={<CheckCircle2 className="w-4 h-4 text-emerald-400" />}>
      <ol className="space-y-2">
        {steps.map((s) => (
          <li key={s.id} className="flex items-start gap-2 text-xs">
            <CheckCircle2 className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${s.done ? "text-emerald-400" : "text-muted-foreground/40"}`} />
            <div className="min-w-0">
              <p className={`font-medium ${s.done ? "text-muted-foreground line-through" : "text-foreground"}`}>{s.title}</p>
              <p className="text-muted-foreground">{s.description}</p>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  )
}

// ─── Discovery Snapshot ───────────────────────────────────────────────────
function DiscoverySnapshot({
  tracks, discussions, posts, error,
}: {
  tracks:      TrackRow[]      | null
  discussions: DiscussionRow[] | null
  posts:       PostRow[]       | null
  error:       string | null
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/40 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-white/5 border border-border/60 flex items-center justify-center">
            <Globe className="w-4 h-4 text-glow-secondary" />
          </div>
          <h2 className="text-sm font-semibold text-foreground">Discovery Snapshot</h2>
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2 text-[11px] text-amber-300">
          Couldn't load some snapshots: {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <SnapshotColumn
          title="Latest tracks"
          icon={<Music className="w-3.5 h-3.5 text-glow-primary" />}
          href="/feed"
          loading={tracks === null}
          empty={tracks?.length === 0}
          items={(tracks ?? []).map((t) => ({
            id: t.id,
            primary: t.title ?? "Untitled",
            secondary: `${t.plays ?? 0} plays · ${formatRelative(t.created_at)}`,
            href: `/feed`,
          }))}
        />
        <SnapshotColumn
          title="Discussions"
          icon={<MessageSquare className="w-3.5 h-3.5 text-glow-secondary" />}
          href="/discussions"
          loading={discussions === null}
          empty={discussions?.length === 0}
          items={(discussions ?? []).map((d) => ({
            id: d.id,
            primary: d.title ?? "Untitled discussion",
            secondary: formatRelative(d.created_at),
            href: `/discussions/${d.id}`,
          }))}
        />
        <SnapshotColumn
          title="Recent posts"
          icon={<FileText className="w-3.5 h-3.5 text-emerald-400" />}
          href="/feed"
          loading={posts === null}
          empty={posts?.length === 0}
          items={(posts ?? []).map((p) => ({
            id: p.id,
            primary: (p.content ?? "").slice(0, 60) || "(empty)",
            secondary: formatRelative(p.created_at),
            href: `/feed`,
          }))}
        />
      </div>
    </div>
  )
}

function SnapshotColumn({
  title, icon, href, loading, empty, items,
}: {
  title:   string
  icon:    React.ReactNode
  href:    string
  loading: boolean
  empty:   boolean | undefined
  items:   Array<{ id: string; primary: string; secondary: string; href: string }>
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/40 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-semibold text-foreground inline-flex items-center gap-1.5">
          {icon}{title}
        </span>
        <Link href={href} className="text-[10px] text-glow-primary hover:text-glow-secondary inline-flex items-center gap-0.5">
          See all <ArrowRight className="w-2.5 h-2.5" />
        </Link>
      </div>
      {loading ? (
        <div className="py-4 flex justify-center"><Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" /></div>
      ) : empty ? (
        <p className="text-[11px] text-muted-foreground py-2">Nothing here yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((it) => (
            <li key={it.id}>
              <Link href={it.href} className="block px-2 py-1.5 rounded hover:bg-white/5">
                <p className="text-[11px] text-foreground truncate">{it.primary}</p>
                <p className="text-[10px] text-muted-foreground">{it.secondary}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────
function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  const diffMs = Date.now() - d.getTime()
  const m = Math.round(diffMs / 60000)
  if (m < 1)    return "just now"
  if (m < 60)   return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24)   return `${h}h ago`
  const days = Math.round(h / 24)
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString()
}
