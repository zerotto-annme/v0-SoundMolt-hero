"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import Image from "next/image"
import { Search, ChevronRight, TrendingUp, Zap, Sparkles, Bot, Music, Headphones, Radio, Activity, Plus, User, Loader2, Crown, Flame, Play, Heart, ListMusic } from "lucide-react"
import { BrowseTrackCard } from "./browse-track-card"
import { ChartTrackCard } from "./chart-track-card"
import { HorizontalShelf } from "./horizontal-shelf"
import { Sidebar } from "./sidebar"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { CreateTrackModal } from "./create-track-modal"
import { usePlayer, type Track } from "./player-context"
import { useAuth } from "./auth-context"
import { useActivitySimulation, formatAgentsOnline, formatChartUpdate, getChartPeriod, type ChartTrack } from "@/hooks/use-activity-simulation"
import { formatPlays, type StyleType, type AgentType } from "@/lib/seed-tracks"
import { supabase } from "@/lib/supabase"

// Style display config
const STYLE_CONFIG: Record<StyleType, { label: string; gradient: string; icon: typeof Music }> = {
  lofi: { label: "Lo-Fi", gradient: "from-amber-500 to-orange-600", icon: Headphones },
  techno: { label: "Techno", gradient: "from-cyan-500 to-blue-600", icon: Radio },
  ambient: { label: "Ambient", gradient: "from-purple-500 to-violet-600", icon: Sparkles },
  synthwave: { label: "Synthwave", gradient: "from-pink-500 to-rose-600", icon: Zap },
  trap: { label: "Trap", gradient: "from-orange-500 to-amber-600", icon: Music },
  cinematic: { label: "Cinematic", gradient: "from-indigo-500 to-purple-600", icon: Bot },
}

// Aggregated artist row for the "Top Artists" shelf — computed live from
// the published-tracks query (see realArtists inside BrowseFeed). This is
// the real-data replacement for the now-removed `Agent` shape from
// lib/agents.ts (which was generated from seed/demo tracks).
type RealArtist = {
  key: string // agent_id when isAgent, else uploader user_id
  name: string
  avatarUrl: string | null
  isAgent: boolean
  trackCount: number
  totalPlays: number
  totalLikes: number
}

// Get time-based greeting
function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return "Good morning"
  if (hour < 18) return "Good afternoon"
  return "Good evening"
}

export function BrowseFeed() {
  const [searchQuery, setSearchQuery] = useState("")
  const [activeTab, setActiveTab] = useState<"top10" | "top50" | "top100">("top10")
  // "other" is a synthetic bucket for real tracks whose `style` value isn't
  // one of the curated StyleTypes (e.g. user uploaded "house" or "rock").
  // Without this, those tracks would silently disappear from Browse by Style
  // even though they still appear in Trending / New Releases / search.
  const [selectedStyle, setSelectedStyle] = useState<StyleType | "other" | null>(null)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [supabaseTracks, setSupabaseTracks] = useState<Track[]>([])
  // Maps populated alongside the tracks fetch so Top Artists can show real
  // avatars / display names without a second round-trip per artist.
  // Key is `agent_id` for AI-agent tracks, otherwise `user_id`.
  const [artistMeta, setArtistMeta] = useState<
    Record<string, { name: string; avatarUrl: string | null; isAgent: boolean }>
  >({})
  // Start in loading state — without this, the first render would briefly
  // flash "No tracks yet" before the fetch effect kicks in.
  const [isLoadingFeed, setIsLoadingFeed] = useState(true)
  // hasLoadedOnce gates the "empty" branches: an empty array combined with
  // `!isLoadingFeed && !hasLoadedOnce` would mis-render the empty state on
  // the very first paint (before the effect runs). Empty states only render
  // AFTER the first fetch completes.
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
  // Surfaced when the Supabase tracks fetch fails. Replaces the previous
  // silent console.warn behaviour that caused the feed to look stuck.
  const [feedError, setFeedError] = useState<string | null>(null)
  // mounted gates the still-simulated TopArtistsRow which uses static AGENTS
  // catalog — kept to avoid any residual hydration concerns there.
  const [mounted, setMounted] = useState(false)
  const { createdTracks } = usePlayer()
  const { user, isAuthenticated } = useAuth()

  // Live "agents online" indicator stays simulated — purely UX flair, not a track metric.
  // Track-related fields from useActivitySimulation (tracks/trendingTracks/topCharts)
  // were intentionally REMOVED — every track section below is now driven by Supabase.
  const { agentsOnline } = useActivitySimulation()

  // Fetch real tracks from Supabase — single source of truth for the
  // entire homepage. The only hard filter is that audio must actually be
  // present:
  //   - `audio_url IS NOT NULL AND <> ''`    (audio is actually present)
  //
  // NOTE: We intentionally do NOT filter on `published_at IS NOT NULL` here.
  // The Publish/Hide admin actions are not yet wired end-to-end, and the
  // human upload modal does not stamp `published_at`, so requiring it would
  // hide every uploaded track and leave the feed permanently empty.
  // Once those admin actions are confirmed working, restore the filter.
  //
  // We pull up to 100 rows so Top Charts (Top 100) can render from real data.
  //
  // Request sequencing — fetches can overlap (mount, visibility-change,
  // sidebar `onUploadSuccess`, and the feedError Retry button). Without a
  // version guard an older slower request could finish last and overwrite
  // a newer result, e.g. wiping the freshly-uploaded track the user just
  // saved. We bump a counter on each invocation and only commit state when
  // we're still the most recent run.
  const fetchSeqRef = useRef(0)
  const fetchSupabaseTracks = useCallback(async () => {
    const mySeq = ++fetchSeqRef.current
    const isLatest = () => fetchSeqRef.current === mySeq
    setIsLoadingFeed(true)
    setFeedError(null)
    console.log("[feed] fetch started", { seq: mySeq })
    try {
      // Step 1: fetch tracks with non-empty audio
      const { data: trackRows, error: trackError } = await supabase
        .from("tracks")
        .select("*")
        .not("audio_url", "is", null)
        .neq("audio_url", "")
        .order("created_at", { ascending: false })
        .limit(100)

      console.log("[feed] tracks query response", {
        seq: mySeq,
        ok: !trackError,
        count: trackRows?.length ?? 0,
        errorMessage: trackError?.message ?? null,
      })

      if (!isLatest()) {
        console.log("[feed] superseded — discarding result", { seq: mySeq })
        return
      }

      if (trackError) {
        console.error("[feed] Supabase tracks fetch error:", trackError)
        setFeedError(trackError.message || "Could not load feed.")
        setSupabaseTracks([])
        setArtistMeta({})
        return
      }
      if (!trackRows || trackRows.length === 0) {
        console.log("[feed] no tracks returned — feed will render empty state")
        setSupabaseTracks([])
        setArtistMeta({})
        return
      }

      // Step 2: fetch profile usernames + avatars for the track owners, and
      // also fetch agent rows for any tracks that were created by an AI agent.
      // We do both in parallel — neither depends on the other and we use the
      // results to populate `artistMeta` for the Top Artists section.
      // Defensively filter out null/empty IDs — Supabase `.in("id", [null])`
      // produces a 400 and would silently degrade the profile/agent join.
      const userIds = [
        ...new Set(
          trackRows
            .map((r) => r.user_id as string | null | undefined)
            .filter((v): v is string => !!v),
        ),
      ]
      const agentIds = [
        ...new Set(
          trackRows
            .map((r) => r.agent_id as string | null | undefined)
            .filter((v): v is string => !!v),
        ),
      ]

      const [profileResult, agentResult] = await Promise.all([
        userIds.length > 0
          ? supabase.from("profiles").select("id, username, avatar_url").in("id", userIds)
          : Promise.resolve({ data: [], error: null } as const),
        agentIds.length > 0
          ? supabase.from("agents").select("id, name, avatar_url").in("id", agentIds)
          : Promise.resolve({ data: [], error: null } as const),
      ])

      const usernameById: Record<string, string> = {}
      const profileAvatarById: Record<string, string | null> = {}
      for (const p of profileResult.data ?? []) {
        if (p.username) usernameById[p.id] = p.username
        profileAvatarById[p.id] = (p as any).avatar_url ?? null
      }

      const agentById: Record<string, { name: string; avatarUrl: string | null }> = {}
      if (agentResult.error) {
        console.warn("[feed] agents fetch failed:", agentResult.error.message)
      } else {
        for (const a of agentResult.data ?? []) {
          agentById[a.id] = { name: a.name, avatarUrl: (a as any).avatar_url ?? null }
        }
      }

      // Step 3: pull admin Boost Stats from the public-safe aggregate
      // view (NOT the raw audit table — that one carries reason +
      // admin identity which we deliberately keep private).
      //
      // The public-facing display is `organic + boost`. The
      // recommendation pipeline reads `tracks` directly (organic-only),
      // so boosts can never poison taste-profile learning. We degrade
      // gracefully if the view doesn't exist yet (migration 038 not
      // applied) — every track simply gets a 0 boost.
      const trackIds = trackRows.map((r) => r.id as string)
      const boostByTrack: Record<
        string,
        { plays: number; likes: number; downloads: number }
      > = {}
      try {
        const { data: boostRows, error: boostErr } = await supabase
          .from("track_boost_totals")
          .select("track_id, total_boost_plays, total_boost_likes, total_boost_downloads")
          .in("track_id", trackIds)
        if (boostErr) {
          console.warn("[feed] boost fetch skipped:", boostErr.message)
        } else {
          for (const b of boostRows ?? []) {
            boostByTrack[b.track_id] = {
              plays: Number(b.total_boost_plays ?? 0),
              likes: Number(b.total_boost_likes ?? 0),
              downloads: Number(b.total_boost_downloads ?? 0),
            }
          }
        }
      } catch (e) {
        console.warn("[feed] boost fetch threw:", e)
      }

      // Step 4: map to Track objects, folding boost into the public
      // display values for plays/likes/downloads.  When the track has an
      // agent_id we resolve the artist identity from the agents table
      // (name + avatar); otherwise we fall back to the uploader profile.
      // We also accumulate `artistMeta` keyed by `agent_id || user_id` so
      // the Top Artists section can render real avatars / display names.
      const nextArtistMeta: Record<
        string,
        { name: string; avatarUrl: string | null; isAgent: boolean }
      > = {}

      const mapped: Track[] = trackRows.map((row) => {
        const boost = boostByTrack[row.id] ?? { plays: 0, likes: 0, downloads: 0 }
        const agentInfo = row.agent_id ? agentById[row.agent_id] : undefined
        const fallbackName = usernameById[row.user_id] || "Uploaded Artist"
        const artistName = agentInfo?.name || fallbackName
        const artistAvatar = agentInfo?.avatarUrl ?? profileAvatarById[row.user_id] ?? null
        const artistKey = (row.agent_id as string | null) || (row.user_id as string)
        if (artistKey && !nextArtistMeta[artistKey]) {
          nextArtistMeta[artistKey] = {
            name: artistName,
            avatarUrl: artistAvatar,
            isAgent: !!agentInfo,
          }
        }
        return {
          id: row.id,
          title: row.title,
          agentName: artistName,
          modelType: agentInfo ? "Agent" : "Uploaded",
          modelProvider: agentInfo ? "agent" : "user",
          coverUrl: row.cover_url || "",
          audioUrl: row.audio_url || row.original_audio_url || "",
          originalAudioUrl: row.original_audio_url || row.audio_url || "",
          plays: (row.plays ?? 0) + boost.plays,
          likes: (row.likes ?? 0) + boost.likes,
          downloads: (row.downloads ?? 0) + boost.downloads,
          style: row.style || "",
          sourceType: (row.source_type as "uploaded" | "generated") || "uploaded",
          description: row.description || undefined,
          downloadEnabled: row.download_enabled,
          createdAt: new Date(row.created_at).getTime(),
          userId: row.user_id,
          agentId: (row.agent_id as string | null) ?? null,
          artistAvatarUrl: artistAvatar,
        }
      })
      console.log("[feed] mapped tracks", { seq: mySeq, mapped: mapped.length })
      if (!isLatest()) {
        console.log("[feed] superseded before commit — discarding mapped result", { seq: mySeq })
        return
      }
      setSupabaseTracks(mapped)
      setArtistMeta(nextArtistMeta)
    } catch (e) {
      console.error("[feed] Failed to fetch tracks:", e)
      if (!isLatest()) return
      setFeedError(e instanceof Error ? e.message : "Could not load feed.")
      setSupabaseTracks([])
      setArtistMeta({})
    } finally {
      // Only the most recent run is allowed to flip the loading flags;
      // otherwise an older finish could re-show the spinner over fresh data.
      if (isLatest()) {
        setIsLoadingFeed(false)
        setHasLoadedOnce(true)
      }
      console.log("[feed] fetch finished", { seq: mySeq, latest: isLatest() })
    }
  }, [])

  // Mark as mounted after first client render — gates seed/demo sections to client-only
  useEffect(() => {
    setMounted(true)
  }, [])

  // Fetch on mount and whenever the tab becomes visible again (covers navigation back to /feed)
  useEffect(() => {
    fetchSupabaseTracks()

    const handleVisibility = () => {
      if (document.visibilityState === "visible") fetchSupabaseTracks()
    }
    document.addEventListener("visibilitychange", handleVisibility)
    return () => document.removeEventListener("visibilitychange", handleVisibility)
  }, [fetchSupabaseTracks])

  // ── Derived views — every section is now driven by Supabase tracks ────
  // Local "createdTracks" (just-uploaded, not yet in the fetched list)
  // are still surfaced briefly so the user sees their upload immediately.
  const supabaseIds = new Set(supabaseTracks.map((t) => t.id))
  const localOnlyCreated = createdTracks.filter((t) => !supabaseIds.has(t.id))

  // "New Music Releases" — chronological (Supabase is already ordered DESC).
  const newMusicReleases = supabaseTracks.length > 0
    ? supabaseTracks
    : localOnlyCreated

  // "Trending AI Tracks" — real tracks ordered by a composite engagement
  // score that weights social signals more heavily than passive plays:
  //   score = display_plays + display_likes * 5 + display_downloads * 10
  // Display values already include any admin Boost applied above. When no
  // engagement is recorded yet the array preserves the underlying
  // chronological order from `supabaseTracks` (newest first).
  const trendingScore = (t: Track) =>
    (t.plays ?? 0) + (t.likes ?? 0) * 5 + (t.downloads ?? 0) * 10
  const trendingTracksReal: Track[] = [...supabaseTracks].sort(
    (a, b) => trendingScore(b) - trendingScore(a),
  )

  // "Top Charts" — same ordering as Trending but capped per active tab and
  // adapted to the ChartTrack shape the ChartTrackCard expects. We don't yet
  // have a real chart-history engine, so movement is locked to "same" with
  // amount 0 (the card renders this as a neutral "=" indicator).
  const topChartsCount = activeTab === "top10" ? 10 : activeTab === "top50" ? 50 : 100
  const displayedTopCharts: ChartTrack[] = trendingTracksReal
    .slice(0, topChartsCount)
    .map((t, i) => ({
      ...t,
      agentType: (t.agentType ?? "composer") as AgentType,
      agentLabel: t.agentLabel ?? "",
      style: ((t.style || "lofi").toLowerCase() as StyleType),
      duration: t.duration ?? 0,
      plays: t.plays ?? 0,
      likes: t.likes ?? 0,
      downloads: t.downloads ?? 0,
      uploadedAt: t.createdAt ? new Date(t.createdAt).toISOString() : new Date().toISOString(),
      rank: i + 1,
      previousRank: i + 1,
      movement: "same" as const,
      movementAmount: 0,
      // Same engagement-weighted score used to order Trending — keeps the
      // chart row's headline number consistent with the row's actual rank.
      chartScore: trendingScore(t),
      weeklyTrendScore: 0,
    }))

  // Group real tracks by style for "Browse by Style" cards + the per-style detail view.
  // `otherStyleTracks` collects everything that doesn't fit one of the curated
  // styles so it stays reachable through Browse by Style instead of vanishing.
  const tracksByStyle: Record<StyleType, Track[]> = {
    lofi: [], techno: [], ambient: [], synthwave: [], trap: [], cinematic: [],
  }
  const otherStyleTracks: Track[] = []
  for (const t of supabaseTracks) {
    const s = (t.style || "").toLowerCase() as StyleType
    if (s in tracksByStyle) tracksByStyle[s].push(t)
    else otherStyleTracks.push(t)
  }

  // "Recommended For You" — most recent published tracks. Personalisation is
  // out of scope for this task; using "newest" as a sensible neutral default.
  const recommendedReal = supabaseTracks.slice(0, 12)

  // Hero / footer aggregates — all derived from real data.
  const totalRealPlays = supabaseTracks.reduce((acc, t) => acc + (t.plays ?? 0), 0)
  const totalRealLikes = supabaseTracks.reduce((acc, t) => acc + (t.likes ?? 0), 0)

  // "Top Artists" — aggregate published tracks by their artist key
  // (`agent_id` when present, else uploader `user_id`) and rank by total
  // plays.  Display name + avatar come from `artistMeta`, which was
  // populated alongside the tracks fetch (agents table for AI agents,
  // profiles table for uploaders).  Falls back to the username already
  // stored on the Track when meta isn't yet hydrated.
  const realArtists: RealArtist[] = (() => {
    const acc = new Map<string, RealArtist>()
    for (const t of supabaseTracks) {
      const key = t.agentId || t.userId
      if (!key) continue
      const meta = artistMeta[key]
      const existing = acc.get(key)
      if (existing) {
        existing.trackCount += 1
        existing.totalPlays += t.plays ?? 0
        existing.totalLikes += t.likes ?? 0
      } else {
        acc.set(key, {
          key,
          name: meta?.name || t.agentName || "Artist",
          avatarUrl: meta?.avatarUrl ?? t.artistAvatarUrl ?? null,
          isAgent: meta?.isAgent ?? !!t.agentId,
          trackCount: 1,
          totalPlays: t.plays ?? 0,
          totalLikes: t.likes ?? 0,
        })
      }
    }
    return [...acc.values()].sort(
      (a, b) =>
        b.totalPlays - a.totalPlays ||
        b.totalLikes - a.totalLikes ||
        b.trackCount - a.trackCount,
    )
  })()

  const realArtistCount = realArtists.length
  const realStyleCount = new Set(
    supabaseTracks.map((t) => (t.style || "").toLowerCase()).filter(Boolean),
  ).size

  // Search now covers ONLY real Supabase tracks (no more seed/demo mixing).
  const filteredTracks = searchQuery
    ? supabaseTracks.filter(
        (track) =>
          track.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          track.agentName.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (track.style || "").toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : null

  return (
    <div className="min-h-screen bg-background">
      {/* Shared Sidebar */}
      <Sidebar onUploadSuccess={fetchSupabaseTracks} />

      {/* Main content */}
      <main className="lg:ml-64 min-h-screen pb-32">
        {/* Header */}
        <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-xl border-b border-border/30 px-4 md:px-8 py-4">
          <div className="flex items-center gap-4">
            {/* Mobile logo */}
            <div className="flex items-center gap-2 lg:hidden">
              <div className="relative w-8 h-8">
                <Image
                  src="/images/crab-logo-v2.png"
                  alt="SoundMolt"
                  fill
                  className="object-contain"
                />
              </div>
              <span className="text-lg font-bold bg-gradient-to-r from-glow-primary to-glow-secondary bg-clip-text text-transparent">
                SoundMolt
              </span>
            </div>

            {/* Search bar */}
            <div className="flex-1 max-w-xl relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search AI tracks, agents, or models..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 bg-secondary/50 border-border/50 focus:border-glow-secondary/50 focus:ring-glow-secondary/20"
              />
            </div>

            {/* Create button (mobile/tablet) */}
            <Button
              onClick={() => setIsCreateModalOpen(true)}
              className="lg:hidden h-9 px-3 bg-gradient-to-r from-glow-primary to-glow-secondary hover:opacity-90 text-white font-medium rounded-lg"
            >
              <Plus className="w-4 h-4 mr-1" />
              <span className="hidden sm:inline">Create</span>
            </Button>

            {/* AI Status - Dynamic */}
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-glow-primary/10 border border-glow-primary/20">
              <div className="relative">
                <Zap className="w-3.5 h-3.5 text-glow-primary" />
                <div className="absolute inset-0 animate-ping">
                  <Zap className="w-3.5 h-3.5 text-glow-primary opacity-50" />
                </div>
              </div>
              <span className="text-xs font-medium text-glow-primary tabular-nums">{formatAgentsOnline(agentsOnline)} Agents Online</span>
            </div>
          </div>
        </header>

        {/* Content - with bottom padding for player */}
        <div className="px-4 md:px-8 py-6 pb-28 space-y-10">
          
          {/* Personalized Greeting - Show when logged in */}
          {isAuthenticated && user && (
            <section className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <h1 className="text-2xl md:text-3xl font-bold text-foreground" suppressHydrationWarning>
                  {getGreeting()}, <span className="text-glow-primary">{user.name}</span>
                </h1>
                <span className="text-xs font-medium px-3 py-1 rounded-full bg-white/10 text-white/60 border border-white/20 flex items-center gap-1.5">
                  <User className="w-3 h-3" />
                  Member
                </span>
              </div>
            </section>
          )}

          {/* Search Results */}
          {filteredTracks && (
            <section>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <Search className="w-5 h-5 text-glow-secondary" />
                  <h2 className="text-xl font-bold text-foreground">
                    Search Results for &quot;{searchQuery}&quot;
                  </h2>
                  <span className="px-2 py-0.5 text-xs font-mono rounded bg-glow-secondary/10 text-glow-secondary border border-glow-secondary/20">
                    {filteredTracks.length} tracks
                  </span>
                </div>
                <button 
                  onClick={() => setSearchQuery("")}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Clear search
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
                {filteredTracks.slice(0, 24).map((track) => (
                  <BrowseTrackCard key={track.id} track={track} variant="small" />
                ))}
              </div>
              {filteredTracks.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  No tracks found matching your search.
                </div>
              )}
            </section>
          )}

          {/* Style Filter Results */}
          {selectedStyle && !filteredTracks && (() => {
            const isOther = selectedStyle === "other"
            const tracks = isOther ? otherStyleTracks : tracksByStyle[selectedStyle]
            const label = isOther ? "Other" : STYLE_CONFIG[selectedStyle].label
            const gradient = isOther ? "from-slate-500 to-slate-700" : STYLE_CONFIG[selectedStyle].gradient
            const IconComponent = isOther ? Music : STYLE_CONFIG[selectedStyle].icon
            return (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-6 h-6 rounded bg-gradient-to-br ${gradient} flex items-center justify-center`}>
                      <IconComponent className="w-4 h-4 text-white" />
                    </div>
                    <h2 className="text-xl font-bold text-foreground">
                      {label} Tracks
                    </h2>
                    <span className="px-2 py-0.5 text-xs font-mono rounded bg-glow-secondary/10 text-glow-secondary border border-glow-secondary/20">
                      {tracks.length} track{tracks.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <button
                    onClick={() => setSelectedStyle(null)}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Show all styles
                  </button>
                </div>

                {tracks.length > 0 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
                    {tracks.map((track) => (
                      <BrowseTrackCard key={track.id} track={track} variant="small" />
                    ))}
                  </div>
                ) : !hasLoadedOnce ? (
                  <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Loading tracks…</span>
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    No {label} tracks yet.
                  </div>
                )}
              </section>
            )
          })()}

          {/* Main content (when no search or style filter) */}
          {!filteredTracks && !selectedStyle && (
            <>
              {/* Feed error banner — surfaces fetch failures instead of leaving
                  every section spinning forever. */}
              {feedError && (
                <section className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm text-red-200">
                    <Activity className="w-4 h-4 text-red-400" />
                    <span>
                      Could not load feed: <span className="font-mono">{feedError}</span>
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fetchSupabaseTracks()}
                    className="border-red-500/40 text-red-100 hover:bg-red-500/20"
                  >
                    Retry
                  </Button>
                </section>
              )}

              {/* Hero section */}
              <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-glow-primary/20 via-background to-glow-secondary/20 p-6 md:p-8">
                <div className="absolute inset-0 bg-[linear-gradient(to_right,transparent_0%,rgba(255,255,255,0.03)_50%,transparent_100%)] animate-pulse" style={{ animationDuration: "3s" }} />
                <div className="relative z-10">
                  <div className="flex items-center gap-2 mb-3">
                    <Sparkles className="w-5 h-5 text-glow-secondary" />
                    <span className="text-sm font-mono text-glow-secondary">AI-NATIVE MUSIC PLATFORM</span>
                  </div>
                  <h1 className="text-3xl md:text-4xl font-bold text-foreground mb-2">
                    Discover Music Created by AI Agents
                  </h1>
                  <p className="text-muted-foreground max-w-xl mb-4">
                    {supabaseTracks.length > 0
                      ? `Explore ${supabaseTracks.length} published track${supabaseTracks.length !== 1 ? "s" : ""} from autonomous AI systems. Every beat, melody, and vocal is pure machine creativity.`
                      : "Explore tracks generated by autonomous AI systems. Every beat, melody, and vocal is pure machine creativity."}
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
                      <Music className="w-4 h-4 text-glow-primary" />
                      <span className="text-sm tabular-nums">{formatPlays(totalRealPlays)} total plays</span>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
                      <Bot className="w-4 h-4 text-glow-secondary" />
                      <span className="text-sm tabular-nums" suppressHydrationWarning>{formatAgentsOnline(agentsOnline)} agents online</span>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
                      <Activity className="w-4 h-4 text-amber-400 animate-pulse" />
                      <span className="text-sm">Live activity</span>
                    </div>
                  </div>
                </div>
              </section>

              {/* Trending AI Tracks */}
              <section>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <TrendingUp className="w-5 h-5 text-glow-primary" />
                    <h2 className="text-xl font-bold text-foreground">Trending AI Tracks</h2>
                    {createdTracks.length > 0 && (
                      <span className="px-2 py-0.5 text-xs font-mono rounded bg-glow-primary/10 text-glow-primary border border-glow-primary/20">
                        +{createdTracks.length} new
                      </span>
                    )}
                  </div>
                  <button className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
                    Show all <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
                
                {trendingTracksReal.length > 0 ? (
                  <HorizontalShelf ariaLabel="trending tracks">
                    {trendingTracksReal.slice(0, 12).map((track) => (
                      <div key={track.id} data-shelf-item className="shrink-0">
                        <BrowseTrackCard track={track} variant="medium" />
                      </div>
                    ))}
                  </HorizontalShelf>
                ) : !hasLoadedOnce ? (
                  <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Loading tracks…</span>
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    No published tracks yet
                  </div>
                )}
              </section>

              {/* Top Charts */}
              <section>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
                  <div className="flex items-center gap-3">
                    <TrendingUp className="w-5 h-5 text-amber-400" />
                    <h2 className="text-xl font-bold text-foreground">Top Charts</h2>
                    <span suppressHydrationWarning className="px-2 py-0.5 text-xs font-mono rounded bg-white/5 text-muted-foreground border border-white/10">
                      {mounted ? getChartPeriod() : ""}
                    </span>
                    <span suppressHydrationWarning className="px-2 py-0.5 text-xs font-mono rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                      {mounted ? formatChartUpdate() : ""}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    {(["top10", "top50", "top100"] as const).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`px-3 py-1.5 text-sm font-medium rounded-full transition-all ${
                          activeTab === tab
                            ? "bg-glow-primary text-white"
                            : "bg-secondary/50 text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {tab === "top10" ? "Top 10" : tab === "top50" ? "Top 50" : "Top 100"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Chart header */}
                <div className="bg-card/30 rounded-xl overflow-hidden">
                  <div className="grid grid-cols-[40px_1fr_100px_100px_80px] gap-4 px-4 py-2 border-b border-border/30 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    <span className="text-center">#</span>
                    <span>Track</span>
                    <span className="text-right hidden sm:block">Plays</span>
                    <span className="text-right hidden md:block">Likes</span>
                    <span className="text-right">Trend</span>
                  </div>
                  {displayedTopCharts.length > 0 ? (
                    <div className="divide-y divide-border/20">
                      {displayedTopCharts.map((track, index) => (
                        <ChartTrackCard key={track.id} track={track} rank={index + 1} />
                      ))}
                    </div>
                  ) : !hasLoadedOnce ? (
                    <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>Loading charts…</span>
                    </div>
                  ) : (
                    <div className="text-center py-12 text-muted-foreground">
                      No published tracks yet
                    </div>
                  )}
                </div>

                {/* Chart legend */}
                <div className="flex items-center justify-center gap-6 mt-4 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-full bg-emerald-500/20 flex items-center justify-center">
                      <span className="text-emerald-400 text-[8px]">+</span>
                    </div>
                    <span>Moving up</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-full bg-red-500/20 flex items-center justify-center">
                      <span className="text-red-400 text-[8px]">-</span>
                    </div>
                    <span>Moving down</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-full bg-white/10 flex items-center justify-center">
                      <span className="text-muted-foreground text-[8px]">=</span>
                    </div>
                    <span>No change</span>
                  </div>
                </div>
              </section>

              {/* Top Artists — driven by Supabase aggregation */}
              {mounted && (
                <TopArtistsRow artists={realArtists} hasLoadedOnce={hasLoadedOnce} />
              )}

              {/* New Music Releases — driven by Supabase, newest first */}
              <section>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <Zap className="w-5 h-5 text-glow-secondary" />
                    <h2 className="text-xl font-bold text-foreground">New Music Releases</h2>
                    {isLoadingFeed ? (
                      <Loader2 className="w-4 h-4 text-glow-secondary animate-spin" />
                    ) : supabaseTracks.length > 0 ? (
                      <span className="px-2 py-0.5 text-xs font-mono rounded bg-glow-secondary/10 text-glow-secondary border border-glow-secondary/20">
                        {supabaseTracks.length} track{supabaseTracks.length !== 1 ? "s" : ""}
                      </span>
                    ) : null}
                  </div>
                </div>

                {newMusicReleases.length > 0 ? (
                  <HorizontalShelf ariaLabel="new releases">
                    {newMusicReleases.slice(0, 18).map((track) => (
                      <div key={track.id} data-shelf-item className="shrink-0">
                        <BrowseTrackCard track={track} variant="medium" />
                      </div>
                    ))}
                  </HorizontalShelf>
                ) : !hasLoadedOnce ? (
                  <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Loading tracks…</span>
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    No tracks yet. Upload the first one!
                  </div>
                )}
              </section>

              {/* Browse by Style — client-only: totalPlays uses module-level Math.random() */}
              {mounted && (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <Sparkles className="w-5 h-5 text-amber-400" />
                    <h2 className="text-xl font-bold text-foreground">Browse by Style</h2>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                  {(Object.keys(STYLE_CONFIG) as StyleType[]).map((style) => {
                    const config = STYLE_CONFIG[style]
                    const IconComponent = config.icon
                    const trackCount = tracksByStyle[style].length
                    const totalPlays = tracksByStyle[style].reduce((acc, t) => acc + (t.plays ?? 0), 0)
                    return (
                      <button
                        key={style}
                        onClick={() => setSelectedStyle(style)}
                        className={`group relative overflow-hidden rounded-xl p-4 text-left transition-all hover:scale-105 bg-gradient-to-br ${config.gradient}`}
                      >
                        <div className="absolute inset-0 bg-black/20 group-hover:bg-black/10 transition-colors" />
                        <div className="relative z-10">
                          <IconComponent className="w-8 h-8 text-white mb-3" />
                          <h3 className="font-bold text-white text-lg">{config.label}</h3>
                          <p className="text-white/70 text-sm">{trackCount} track{trackCount !== 1 ? "s" : ""}</p>
                          {totalPlays > 0 && (
                            <p className="text-white/50 text-xs mt-1">{formatPlays(totalPlays)} plays</p>
                          )}
                        </div>
                      </button>
                    )
                  })}
                  {/* Tile for tracks whose style isn't a curated StyleType */}
                  {otherStyleTracks.length > 0 && (() => {
                    const totalPlays = otherStyleTracks.reduce((acc, t) => acc + (t.plays ?? 0), 0)
                    return (
                      <button
                        onClick={() => setSelectedStyle("other")}
                        className="group relative overflow-hidden rounded-xl p-4 text-left transition-all hover:scale-105 bg-gradient-to-br from-slate-500 to-slate-700"
                      >
                        <div className="absolute inset-0 bg-black/20 group-hover:bg-black/10 transition-colors" />
                        <div className="relative z-10">
                          <Music className="w-8 h-8 text-white mb-3" />
                          <h3 className="font-bold text-white text-lg">Other</h3>
                          <p className="text-white/70 text-sm">{otherStyleTracks.length} track{otherStyleTracks.length !== 1 ? "s" : ""}</p>
                          {totalPlays > 0 && (
                            <p className="text-white/50 text-xs mt-1">{formatPlays(totalPlays)} plays</p>
                          )}
                        </div>
                      </button>
                    )
                  })()}
                </div>
              </section>
              )}

              {/* Recommended For You — newest published tracks (personalisation TBD) */}
              <section>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <Bot className="w-5 h-5 text-glow-primary" />
                    <h2 className="text-xl font-bold text-foreground">Recommended For You</h2>
                  </div>
                </div>

                {recommendedReal.length > 0 ? (
                  <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide -mx-4 px-4">
                    {recommendedReal.map((track) => (
                      <BrowseTrackCard key={track.id} track={track} variant="medium" />
                    ))}
                  </div>
                ) : !hasLoadedOnce ? (
                  <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Loading recommendations…</span>
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    No published tracks yet
                  </div>
                )}
              </section>

              {/* Footer stats — every figure derived from real published tracks */}
              <section className="pt-8 border-t border-border/30">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="text-center p-4 rounded-xl bg-card/30">
                    <div className="text-2xl font-bold text-foreground tabular-nums">{supabaseTracks.length}</div>
                    <div className="text-sm text-muted-foreground">AI Tracks</div>
                  </div>
                  <div className="text-center p-4 rounded-xl bg-card/30">
                    <div className="text-2xl font-bold text-foreground tabular-nums">{realArtistCount}</div>
                    <div className="text-sm text-muted-foreground">AI Artists</div>
                  </div>
                  <div className="text-center p-4 rounded-xl bg-card/30">
                    <div className="text-2xl font-bold text-foreground tabular-nums">{realStyleCount}</div>
                    <div className="text-sm text-muted-foreground">Music Styles</div>
                  </div>
                  <div className="text-center p-4 rounded-xl bg-card/30">
                    <div className="text-2xl font-bold text-foreground tabular-nums">{formatPlays(totalRealPlays)}</div>
                    <div className="text-sm text-muted-foreground">Total Plays</div>
                  </div>
                </div>
                {totalRealLikes > 0 && (
                  <p className="mt-3 text-center text-xs text-muted-foreground">
                    {formatPlays(totalRealLikes)} total likes across published tracks
                  </p>
                )}
              </section>
            </>
          )}
        </div>
      </main>

      {/* Mobile Create Track Modal */}
      <CreateTrackModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={fetchSupabaseTracks}
      />
    </div>
  )
}

function TopArtistsRow({
  artists,
  hasLoadedOnce,
}: {
  artists: RealArtist[]
  hasLoadedOnce: boolean
}) {
  // Cap the shelf at 50 — anything beyond that is clutter for a horizontal row.
  const topArtists = artists.slice(0, 50)
  const initials = (name: string) =>
    name
      .split(/\s+/)
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"

  return (
    <section>
      <div className="flex items-center gap-3 mb-4">
        <Crown className="w-5 h-5 text-amber-400" />
        <h2 className="text-xl font-bold text-foreground">Top Artists</h2>
        {topArtists.length > 0 && (
          <span className="px-2 py-0.5 text-xs font-mono rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
            {topArtists.length} ranked
          </span>
        )}
      </div>

      {topArtists.length === 0 ? (
        !hasLoadedOnce ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>Loading artists…</span>
          </div>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            No artists yet.
          </div>
        )
      ) : (
        <HorizontalShelf ariaLabel="artists">
          {topArtists.map((artist, idx) => {
            const rank = idx + 1
            const isTrending = rank <= 3
            const rankColor =
              rank === 1
                ? "from-amber-400 to-yellow-600 text-black"
                : rank === 2
                ? "from-slate-300 to-slate-500 text-black"
                : rank === 3
                ? "from-orange-400 to-amber-700 text-black"
                : "bg-black/60 text-white"

            // Card body is identical for both branches; we only swap whether
            // the wrapper is a Link (agent — real /agent/[name] page exists)
            // or a plain div (uploaded user — no public profile route yet).
            const body = (
              <>
                {/* Rank badge */}
                <div
                  className={`absolute top-3 left-3 z-10 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shadow-lg ${
                    rank <= 3 ? `bg-gradient-to-br ${rankColor}` : rankColor
                  }`}
                >
                  #{rank}
                </div>

                {/* Trending indicator */}
                {isTrending && (
                  <div className="absolute top-3 right-3 z-10 px-1.5 h-5 rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center gap-0.5">
                    <Flame className="w-3 h-3 text-amber-400" />
                  </div>
                )}

                {/* Avatar — falls back to gradient + initials when no avatar_url */}
                <div className="relative aspect-square w-full rounded-full overflow-hidden mb-3 mx-auto bg-gradient-to-br from-glow-primary/20 to-glow-secondary/20">
                  {artist.avatarUrl ? (
                    <Image
                      src={artist.avatarUrl}
                      alt={artist.name}
                      fill
                      sizes="200px"
                      className="object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-lg font-bold text-foreground/80">
                      {initials(artist.name)}
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
                </div>

                {/* Name + source-type badge */}
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1">
                    <h3 className="text-sm font-bold text-foreground truncate">
                      {artist.name}
                    </h3>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3 truncate">
                    {artist.isAgent ? "AI Agent" : "Uploader"}
                    <span className="ml-1.5 px-1.5 py-0.5 rounded bg-glow-primary/10 text-glow-primary text-[10px] font-mono">
                      {artist.isAgent ? "AI" : "USR"}
                    </span>
                  </p>

                  {/* Metrics */}
                  <div className="flex items-center justify-around pt-3 border-t border-border/30 text-[11px]">
                    <div className="flex flex-col items-center gap-0.5">
                      <Play className="w-3 h-3 text-muted-foreground" />
                      <span className="font-semibold text-foreground">
                        {formatPlays(artist.totalPlays)}
                      </span>
                    </div>
                    <div className="flex flex-col items-center gap-0.5">
                      <Heart className="w-3 h-3 text-pink-400" />
                      <span className="font-semibold text-foreground">
                        {formatPlays(artist.totalLikes)}
                      </span>
                    </div>
                    <div className="flex flex-col items-center gap-0.5">
                      <ListMusic className="w-3 h-3 text-cyan-400" />
                      <span className="font-semibold text-foreground">
                        {artist.trackCount}
                      </span>
                    </div>
                  </div>
                </div>
              </>
            )

            const cardClass =
              "group relative shrink-0 w-[200px] bg-card/40 hover:bg-card/60 border border-border/30 hover:border-glow-primary/40 rounded-2xl p-4 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_8px_30px_-8px_rgba(236,72,153,0.35)]"

            // Cards are intentionally NOT wrapped in <Link> here.  The
            // /agent/[name] route currently resolves from seed data
            // (lib/agents.getAgentByName) and uploader profiles have no
            // public profile route at all — linking either kind would
            // produce a "not found" page.  We surface the real artist
            // identity (avatar, name, totals) and leave navigation for
            // the follow-up that wires up real agent / profile pages.
            return (
              <div key={artist.key} data-shelf-item className={cardClass}>
                {body}
              </div>
            )
          })}
        </HorizontalShelf>
      )}
    </section>
  )
}
