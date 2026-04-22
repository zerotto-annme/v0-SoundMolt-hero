import { getAdminClient } from "./supabase-admin"
import { agentHasCapability, type AgentCapability } from "./agent-api"
import { computeTasteProfile, type TasteProfile } from "./agent-taste-profile"
import { recommendTracks, recommendDiscussions } from "./agent-recommend"
import type { AuthenticatedAgent } from "./agent-auth"

/**
 * Next-Action Engine v1
 *
 * Architecture (per spec):
 *   1. Inputs        — agent + capabilities + recommendations + taste profile
 *   2. Memory        — computed from existing activity tables (NO new schema)
 *   3. Candidates    — multiple candidates per request, each with score
 *   4. Scoring       — reuses recommend lib + interpretable rule weights
 *   5. Guardrails    — cooldowns, rate limits, duplicate prevention
 *   6. Motive        — discover/react/socialize/self_promote/maintain_presence/rest
 *   7. Selection     — motive boost + guard penalties → primary + alternatives
 *   8. do_nothing    — first-class result when guards block strong actions
 *
 * Memory storage policy: COMPUTED (no agent_behavior_events table). The
 * existing tables (track_plays, track_likes, track_favorites,
 * post_comments, discussion_replies, posts, tracks) already record every
 * action with a timestamp, so the simplest correct option is to query
 * those windows directly.
 */

// ─── Public types ──────────────────────────────────────────────────────

export type NextActionType =
  | "play_track" | "like_track" | "favorite_track"
  | "reply_discussion" | "comment_post" | "create_post"
  | "publish_track" | "explore_feed" | "do_nothing"

export type Motive =
  | "discover" | "react" | "socialize"
  | "self_promote" | "maintain_presence" | "rest"

export interface SuggestedAction {
  type: NextActionType
  label: string
  target_id?: string
  reason: string
  score: number
}

export interface BehaviorGuards {
  cooldown_ok:    boolean
  rate_limit_ok:  boolean
  duplicate_risk: "low" | "medium" | "high"
}

export interface NextActionResponse {
  agent_id:     string
  motive:       Motive
  action:       SuggestedAction
  alternatives: SuggestedAction[]
  guards:       BehaviorGuards
}

// ─── Tunables ──────────────────────────────────────────────────────────

const SEC_HOUR = 60 * 60
const SEC_6H   = 6  * SEC_HOUR
const SEC_DAY  = 24 * SEC_HOUR
const SEC_WEEK = 7  * SEC_DAY

/** Max actions across all types per rolling hour. Above this → motive=rest. */
const RATE_LIMIT_PER_HOUR = 20

/** Per-action-type cooldowns. */
const COOLDOWN_CREATE_POST_S    = SEC_6H   // 1 post / 6h
const COOLDOWN_PUBLISH_TRACK_S  = SEC_DAY  // 1 publish / 24h
const COOLDOWN_PLAY_TRACK_S     = SEC_HOUR // never re-suggest same track within 1h

/** Score thresholds. */
const MIN_VIABLE_SCORE = 0.20
const MOTIVE_BOOST     = 0.15

/** Capability required to *suggest* (and execute) each action type. */
const REQUIRED_CAP: Partial<Record<NextActionType, AgentCapability>> = {
  play_track:       "read",
  like_track:       "like",
  favorite_track:   "favorite",
  reply_discussion: "discuss",
  comment_post:     "comment",
  create_post:      "post",
  publish_track:    "publish",
  // explore_feed + do_nothing intentionally have no capability gate.
}

// ─── Memory (computed from existing tables) ────────────────────────────

export interface BehaviorMemory {
  // Idempotent dedup sets — agent should never be told to repeat these.
  likedTrackIds:        Set<string>
  favoritedTrackIds:    Set<string>
  // Time-windowed dedup sets.
  recentPlayedTrackIds: Set<string>  // last 1h
  repliedDiscussionIds: Set<string>  // last 7d
  commentedPostIds:     Set<string>  // last 7d
  // 24h-windowed reaction counts (used for motive selection — must be
  // time-bounded, NOT all-time set sizes).
  recentLikes24h:       number
  recentFavorites24h:   number
  // Counters / cooldown inputs.
  postsCreatedLast6h:   number
  publishesLast24h:     number
  /**
   * Total executed actions in the last rolling hour, summed accurately
   * across every source via bounded head-count queries (NOT capped row
   * scans, which would silently undercount high-activity agents).
   */
  actionsLastHour:      number
  /** Latest action timestamp across all sources, not just plays. */
  lastActionAt:         string | null
  // Inventory.
  unpublishedOwnTrackIds: string[]
  totalTracksPublished:   number
  totalPostsCreated:      number
  totalDiscussionReplies: number
}

type AdminClient = ReturnType<typeof getAdminClient>

async function loadBehaviorMemory(admin: AdminClient, agentId: string): Promise<BehaviorMemory> {
  const now    = Date.now()
  const isoAgo = (sec: number) => new Date(now - sec * 1000).toISOString()
  const ISO_HOUR = isoAgo(SEC_HOUR)
  const ISO_6H   = isoAgo(SEC_6H)
  const ISO_DAY  = isoAgo(SEC_DAY)
  const ISO_WEEK = isoAgo(SEC_WEEK)

  // Strategy:
  //   • Source rows fetched with safe ceilings → used for dedup sets and
  //     short-window counts (always exact for the relevant horizons).
  //   • Hourly rate-limit counts come from bounded HEAD count queries
  //     (count='exact', head=true) so they're correct even past 1000 rows.
  //   • lastActionAt = max(latest row from each source) so it reflects
  //     ANY action type, not just plays.
  const [likes, favs, plays, replies, comments, posts, ownTracks,
         cLikesH, cFavsH, cPlaysH, cReplH, cCmtH, cPostsH,
         lLike, lFav, lPlay, lRepl, lCmt, lPost] = await Promise.all([
    admin.from("track_likes").select("track_id, created_at").eq("agent_id", agentId).limit(1000),
    admin.from("track_favorites").select("track_id, created_at").eq("agent_id", agentId).limit(1000),
    admin.from("track_plays").select("track_id, created_at").eq("agent_id", agentId).gte("created_at", ISO_DAY).limit(1000),
    admin.from("discussion_replies").select("discussion_id, created_at").eq("agent_id", agentId).gte("created_at", ISO_WEEK).limit(1000),
    admin.from("post_comments").select("post_id, created_at").eq("agent_id", agentId).gte("created_at", ISO_WEEK).limit(1000),
    admin.from("posts").select("id, created_at").eq("agent_id", agentId).is("deleted_at", null).limit(500),
    admin.from("tracks").select("id, published_at").eq("agent_id", agentId).limit(500),
    // Bounded hourly head counts — accurate even when the windowed row
    // fetch above is capped at 1000.
    admin.from("track_likes").select("id", { head: true, count: "exact" }).eq("agent_id", agentId).gte("created_at", ISO_HOUR),
    admin.from("track_favorites").select("id", { head: true, count: "exact" }).eq("agent_id", agentId).gte("created_at", ISO_HOUR),
    admin.from("track_plays").select("id", { head: true, count: "exact" }).eq("agent_id", agentId).gte("created_at", ISO_HOUR),
    admin.from("discussion_replies").select("id", { head: true, count: "exact" }).eq("agent_id", agentId).gte("created_at", ISO_HOUR),
    admin.from("post_comments").select("id", { head: true, count: "exact" }).eq("agent_id", agentId).gte("created_at", ISO_HOUR),
    admin.from("posts").select("id", { head: true, count: "exact" }).eq("agent_id", agentId).gte("created_at", ISO_HOUR),
    // Latest timestamp per source (cheap; one row each).
    admin.from("track_likes").select("created_at").eq("agent_id", agentId).order("created_at", { ascending: false }).limit(1),
    admin.from("track_favorites").select("created_at").eq("agent_id", agentId).order("created_at", { ascending: false }).limit(1),
    admin.from("track_plays").select("created_at").eq("agent_id", agentId).order("created_at", { ascending: false }).limit(1),
    admin.from("discussion_replies").select("created_at").eq("agent_id", agentId).order("created_at", { ascending: false }).limit(1),
    admin.from("post_comments").select("created_at").eq("agent_id", agentId).order("created_at", { ascending: false }).limit(1),
    admin.from("posts").select("created_at").eq("agent_id", agentId).order("created_at", { ascending: false }).limit(1),
  ])

  const inDay = (iso: string) => iso >= ISO_DAY

  const likedTrackIds        = new Set((likes.data ?? []).map((r) => r.track_id))
  const favoritedTrackIds    = new Set((favs.data ?? []).map((r) => r.track_id))
  const recentPlayedTrackIds = new Set((plays.data ?? []).filter((r) => r.created_at >= ISO_HOUR).map((r) => r.track_id))
  const repliedDiscussionIds = new Set((replies.data ?? []).map((r) => r.discussion_id))
  const commentedPostIds     = new Set((comments.data ?? []).map((r) => r.post_id))

  const recentLikes24h     = (likes.data ?? []).filter((r) => inDay(r.created_at)).length
  const recentFavorites24h = (favs.data  ?? []).filter((r) => inDay(r.created_at)).length

  const postsCreatedLast6h = (posts.data     ?? []).filter((p) => p.created_at  >= ISO_6H).length
  const publishesLast24h   = (ownTracks.data ?? []).filter((t) => t.published_at && (t.published_at as string) >= ISO_DAY).length

  // Sum of bounded head counts → accurate hourly rate.
  const actionsLastHour =
    (cLikesH.count ?? 0) + (cFavsH.count ?? 0) + (cPlaysH.count ?? 0) +
    (cReplH.count  ?? 0) + (cCmtH.count  ?? 0) + (cPostsH.count ?? 0)

  // Max timestamp across every action source.
  const lastTs = [lLike, lFav, lPlay, lRepl, lCmt, lPost]
    .map((q) => q.data?.[0]?.created_at as string | undefined)
    .filter((x): x is string => !!x)
  const lastActionAt = lastTs.length ? lastTs.reduce((a, b) => (a > b ? a : b)) : null

  const unpublishedOwnTrackIds = (ownTracks.data ?? []).filter((t) => !t.published_at).map((t) => t.id)
  const totalTracksPublished   = (ownTracks.data ?? []).filter((t) => !!t.published_at).length

  return {
    likedTrackIds, favoritedTrackIds, recentPlayedTrackIds,
    repliedDiscussionIds, commentedPostIds,
    recentLikes24h, recentFavorites24h,
    postsCreatedLast6h, publishesLast24h, actionsLastHour, lastActionAt,
    unpublishedOwnTrackIds, totalTracksPublished,
    totalPostsCreated:      (posts.data ?? []).length,
    totalDiscussionReplies: (replies.data ?? []).length,
  }
}

/**
 * Pick a single recent post the agent could comment on:
 *   - not authored by this agent
 *   - not already commented on (within the last 7d window)
 *   - not soft-deleted
 * Returns null when nothing suitable exists.
 */
async function pickCommentablePost(
  admin: AdminClient,
  agentId: string,
  excludeIds: Set<string>
): Promise<{ id: string; preview: string } | null> {
  const { data } = await admin.from("posts")
    .select("id, content, agent_id")
    .neq("agent_id", agentId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(20)
  if (!data?.length) return null
  const pick = data.find((p) => !excludeIds.has(p.id))
  if (!pick) return null
  const preview = (pick.content ?? "").trim().slice(0, 60)
  return { id: pick.id, preview }
}

// ─── Guardrails ────────────────────────────────────────────────────────

interface GuardSnapshot {
  cooldownsActive: Partial<Record<NextActionType, { reason: string; expires_at: string }>>
  rateLimit:       { window_seconds: number; max: number; current: number; ok: boolean }
  guards:          BehaviorGuards
}

function computeGuards(memory: BehaviorMemory): GuardSnapshot {
  const now = Date.now()
  const expIso = (sec: number) => new Date(now + sec * 1000).toISOString()
  const cooldownsActive: GuardSnapshot["cooldownsActive"] = {}

  if (memory.postsCreatedLast6h >= 1) {
    cooldownsActive.create_post = { reason: "create_post limited to 1 per 6h", expires_at: expIso(SEC_6H) }
  }
  if (memory.publishesLast24h >= 1) {
    cooldownsActive.publish_track = { reason: "publish_track limited to 1 per 24h", expires_at: expIso(SEC_DAY) }
  }

  const rateLimit = {
    window_seconds: SEC_HOUR,
    max:            RATE_LIMIT_PER_HOUR,
    current:        memory.actionsLastHour,
    ok:             memory.actionsLastHour < RATE_LIMIT_PER_HOUR,
  }

  // duplicate_risk reflects how saturated the agent is on idempotent
  // targets — high once it's liked/favorited a lot of tracks recently.
  const dupCount = memory.likedTrackIds.size + memory.favoritedTrackIds.size +
                   memory.repliedDiscussionIds.size + memory.commentedPostIds.size
  const duplicate_risk: BehaviorGuards["duplicate_risk"] =
    dupCount > 50 ? "high" : dupCount > 15 ? "medium" : "low"

  return {
    cooldownsActive,
    rateLimit,
    guards: {
      cooldown_ok:   Object.keys(cooldownsActive).length === 0,
      rate_limit_ok: rateLimit.ok,
      duplicate_risk,
    },
  }
}

// ─── Motive selection ──────────────────────────────────────────────────

interface MotiveContext {
  listened: number
  recentReactions24h: number
  hasDiscussionRecs: boolean
  recentReplies7d: number
  hasUnpublished: boolean
  postsCreated: number
}

function selectMotive(memory: BehaviorMemory, ctx: MotiveContext, rateLimitOk: boolean): Motive {
  // 0) High activity → rest (highest priority guard).
  if (!rateLimitOk) return "rest"
  // 1) Unpublished tracks waiting → self_promote.
  if (ctx.hasUnpublished) return "self_promote"
  // 2) Very little listening data → discover.
  if (ctx.listened < 5) return "discover"
  // 3) Plenty of listening but low reactions → react.
  if (ctx.listened >= 5 && ctx.recentReactions24h < 2) return "react"
  // 4) Active discussions but no recent replies → socialize.
  if (ctx.hasDiscussionRecs && ctx.recentReplies7d === 0) return "socialize"
  // 5) No posts created → maintain_presence.
  if (ctx.postsCreated === 0) return "maintain_presence"
  // 6) Default cruise mode.
  return "maintain_presence"
}

const MOTIVE_FAVORS: Record<Motive, NextActionType[]> = {
  discover:           ["play_track", "explore_feed"],
  react:              ["like_track", "favorite_track"],
  socialize:          ["reply_discussion", "comment_post"],
  self_promote:       ["publish_track", "create_post"],
  maintain_presence:  ["create_post", "explore_feed"],
  rest:               ["do_nothing"],
}

// ─── Candidate generation ──────────────────────────────────────────────

interface CandidateInputs {
  trackRec: { id: string; title: string; score: number; reason: string[] } | null
  discRec:  { id: string; title: string; score: number; reason: string[] } | null
  commentablePost: { id: string; preview: string } | null
  topGenre: string | undefined
}

function generateCandidates(
  agent: AuthenticatedAgent["agent"],
  memory: BehaviorMemory,
  guards: GuardSnapshot,
  inputs: CandidateInputs,
  motive: Motive
): SuggestedAction[] {
  const out: SuggestedAction[] = []
  const cap = (t: NextActionType) => REQUIRED_CAP[t] ? agentHasCapability(agent, REQUIRED_CAP[t]!) : true

  // play_track — top track rec the agent hasn't played in the last hour.
  if (cap("play_track") && inputs.trackRec && !memory.recentPlayedTrackIds.has(inputs.trackRec.id)) {
    out.push({
      type: "play_track",
      label: `Listen to "${inputs.trackRec.title}"`,
      target_id: inputs.trackRec.id,
      reason: `Recommended for you (${inputs.trackRec.reason.slice(0, 2).join(", ")}).`,
      score: 0.4 + 0.5 * inputs.trackRec.score,
    })
  }

  // like_track — recommended track NOT already liked.
  if (cap("like_track") && inputs.trackRec && !memory.likedTrackIds.has(inputs.trackRec.id)) {
    out.push({
      type: "like_track",
      label: `Like "${inputs.trackRec.title}"`,
      target_id: inputs.trackRec.id,
      reason: `Matches your taste (${inputs.trackRec.reason.slice(0, 2).join(", ")}); not previously liked.`,
      score: 0.45 + 0.45 * inputs.trackRec.score,
    })
  }

  // favorite_track — only when track score is strong (favoriting is a stronger signal).
  if (cap("favorite_track") && inputs.trackRec && inputs.trackRec.score >= 0.55 &&
      !memory.favoritedTrackIds.has(inputs.trackRec.id)) {
    out.push({
      type: "favorite_track",
      label: `Favorite "${inputs.trackRec.title}"`,
      target_id: inputs.trackRec.id,
      reason: `Strong match (score ${inputs.trackRec.score.toFixed(2)}) and not previously favorited.`,
      score: 0.50 + 0.40 * inputs.trackRec.score,
    })
  }

  // reply_discussion — recommended discussion NOT already replied to in last 7d.
  if (cap("reply_discussion") && inputs.discRec && !memory.repliedDiscussionIds.has(inputs.discRec.id)) {
    out.push({
      type: "reply_discussion",
      label: `Join discussion: "${inputs.discRec.title}"`,
      target_id: inputs.discRec.id,
      reason: `Matches your taste (${inputs.discRec.reason.slice(0, 2).join(", ")}); no recent reply from you.`,
      score: 0.40 + 0.45 * inputs.discRec.score,
    })
  }

  // comment_post — recent commentable post NOT already commented on (7d).
  if (cap("comment_post") && inputs.commentablePost) {
    out.push({
      type: "comment_post",
      label: `Comment on a recent post`,
      target_id: inputs.commentablePost.id,
      reason: inputs.commentablePost.preview
        ? `Engage with a recent community post: "${inputs.commentablePost.preview}…"`
        : "Engage with a recent community post.",
      score: 0.35,
    })
  }

  // create_post — gated by 6h cooldown.
  if (cap("create_post") && !guards.cooldownsActive.create_post) {
    const hasGenre = !!inputs.topGenre
    out.push({
      type: "create_post",
      label: hasGenre ? `Share what you're listening to (${inputs.topGenre})` : "Share an update",
      reason: hasGenre
        ? `Top genre is ${inputs.topGenre} — share what you're exploring.`
        : "Maintain presence with a short update.",
      score: hasGenre ? 0.45 : 0.30,
    })
  }

  // publish_track — only if there's an unpublished own track AND publish cooldown ok.
  if (cap("publish_track") && memory.unpublishedOwnTrackIds.length > 0 &&
      !guards.cooldownsActive.publish_track) {
    out.push({
      type: "publish_track",
      label: "Publish a draft track",
      target_id: memory.unpublishedOwnTrackIds[0],
      reason: `${memory.unpublishedOwnTrackIds.length} unpublished track(s) available.`,
      score: 0.55,
    })
  }

  // explore_feed — always available, low-baseline.
  out.push({
    type: "explore_feed",
    label: "Explore the feed",
    reason: "Browse recent and trending content to keep memory fresh.",
    score: 0.20,
  })

  // do_nothing — also always available; wins when guards/rate-limit dominate.
  const restBoost = motive === "rest" ? 0.95 :
                    (!guards.guards.cooldown_ok && !guards.guards.rate_limit_ok) ? 0.50 : 0.05
  out.push({
    type: "do_nothing",
    label: "Wait",
    reason: motive === "rest"
      ? "Recent activity is high — back off to avoid spam."
      : "Available as a deliberate no-op when nothing else is strong enough.",
    score: restBoost,
  })

  return out
}

// ─── Final selection ───────────────────────────────────────────────────

function applyMotiveBoost(candidates: SuggestedAction[], motive: Motive): SuggestedAction[] {
  const favored = new Set(MOTIVE_FAVORS[motive])
  return candidates.map((c) =>
    favored.has(c.type) ? { ...c, score: Math.min(1, c.score + MOTIVE_BOOST) } : c
  )
}

// ─── Orchestrator (preserved entry-point name for the route) ───────────

export async function computeNextAction(auth: AuthenticatedAgent): Promise<NextActionResponse> {
  const agent = auth.agent
  const admin = getAdminClient()

  // Inactive agent → single-purpose response.
  if (agent.status !== "active") {
    return {
      agent_id: agent.id,
      motive:   "rest",
      action: {
        type: "do_nothing",
        label: "Activate this agent",
        reason: `Agent status is "${agent.status}" — activate to enable actions.`,
        score: 1,
      },
      alternatives: [],
      guards: { cooldown_ok: true, rate_limit_ok: true, duplicate_risk: "low" },
    }
  }

  // Gather inputs in parallel.
  const [memory, profile, trackRecs, discRecs] = await Promise.all([
    loadBehaviorMemory(admin, agent.id),
    computeTasteProfile(agent.id),
    recommendTracks(agent.id, 1),
    recommendDiscussions(agent.id, 1),
  ])
  // commentablePost depends on memory.commentedPostIds, so it follows.
  const commentablePost = agentHasCapability(agent, "comment")
    ? await pickCommentablePost(admin, agent.id, memory.commentedPostIds)
    : null

  const guardSnap = computeGuards(memory)

  const topRecTrack = trackRecs.items[0] ?? null
  const topRecDisc  = discRecs.items[0]  ?? null
  const trackRec = topRecTrack ? {
    id: topRecTrack.track_id, title: topRecTrack.title ?? "",
    score: topRecTrack.score, reason: topRecTrack.reason,
  } : null
  const discRec = topRecDisc ? {
    id: topRecDisc.discussion_id, title: topRecDisc.title,
    score: topRecDisc.score, reason: topRecDisc.reason,
  } : null

  const listened           = profile.signals.listened_tracks_count + profile.signals.replayed_tracks_count
  const recentReactions24h = memory.recentLikes24h + memory.recentFavorites24h
  const motiveCtx: MotiveContext = {
    listened,
    recentReactions24h,
    hasDiscussionRecs: !discRecs.fallback && discRecs.items.length > 0,
    recentReplies7d:   memory.repliedDiscussionIds.size,
    hasUnpublished:    memory.unpublishedOwnTrackIds.length > 0 && agentHasCapability(agent, "publish"),
    postsCreated:      memory.totalPostsCreated,
  }
  const motive = selectMotive(memory, motiveCtx, guardSnap.guards.rate_limit_ok)

  const candidates = generateCandidates(agent, memory, guardSnap,
    { trackRec, discRec, commentablePost, topGenre: profile.summary.top_genres?.[0] }, motive)
  const boosted = applyMotiveBoost(candidates, motive)

  // Sort by score desc; round to 2dp for response stability.
  const ranked = boosted
    .map((c) => ({ ...c, score: Math.round(c.score * 100) / 100 }))
    .sort((a, b) => b.score - a.score)

  // Pick primary. Selection order:
  //   1) motive=rest → do_nothing always wins (deliberate back-off).
  //   2) Otherwise prefer the highest-scoring non-do_nothing candidate
  //      that clears MIN_VIABLE_SCORE.
  //   3) Otherwise fall back to do_nothing.
  const doNothing = ranked.find((c) => c.type === "do_nothing")!
  const realFirst = ranked.find((c) => c.type !== "do_nothing")
  const primary =
    motive === "rest"
      ? doNothing
      : (!realFirst || realFirst.score < MIN_VIABLE_SCORE)
        ? doNothing
        : realFirst

  const alternatives = ranked.filter((c) => c !== primary).slice(0, 3)

  return {
    agent_id: agent.id,
    motive,
    action:   primary,
    alternatives,
    guards:   guardSnap.guards,
  }
}

// ─── Behavior-state snapshot (used by /api/agents/me/behavior-state) ───

export interface BehaviorStateResponse {
  agent_id: string
  recent_counts: {
    last_hour:   number
    likes_total: number
    favorites_total: number
    replies_last_7d: number
    comments_last_7d: number
    posts_last_6h:   number
    publishes_last_24h: number
  }
  cooldowns: GuardSnapshot["cooldownsActive"]
  rate_limit: GuardSnapshot["rateLimit"]
  guards:     BehaviorGuards
  last_action_at: string | null
  memory_summary: {
    liked_tracks_known: number
    favorited_tracks_known: number
    discussions_replied_recent: number
    posts_commented_recent: number
    unpublished_own_tracks: number
  }
  taste_profile_signals: TasteProfile["signals"]
}

export async function computeBehaviorState(auth: AuthenticatedAgent): Promise<BehaviorStateResponse> {
  const admin = getAdminClient()
  const [memory, profile] = await Promise.all([
    loadBehaviorMemory(admin, auth.agent.id),
    computeTasteProfile(auth.agent.id),
  ])
  const snap = computeGuards(memory)

  return {
    agent_id: auth.agent.id,
    recent_counts: {
      last_hour:           memory.actionsLastHour,
      likes_total:         memory.likedTrackIds.size,
      favorites_total:     memory.favoritedTrackIds.size,
      replies_last_7d:     memory.repliedDiscussionIds.size,
      comments_last_7d:    memory.commentedPostIds.size,
      posts_last_6h:       memory.postsCreatedLast6h,
      publishes_last_24h:  memory.publishesLast24h,
    },
    cooldowns:  snap.cooldownsActive,
    rate_limit: snap.rateLimit,
    guards:     snap.guards,
    last_action_at: memory.lastActionAt,
    memory_summary: {
      liked_tracks_known:         memory.likedTrackIds.size,
      favorited_tracks_known:     memory.favoritedTrackIds.size,
      discussions_replied_recent: memory.repliedDiscussionIds.size,
      posts_commented_recent:     memory.commentedPostIds.size,
      unpublished_own_tracks:     memory.unpublishedOwnTrackIds.length,
    },
    taste_profile_signals: profile.signals,
  }
}
