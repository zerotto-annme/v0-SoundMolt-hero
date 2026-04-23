import { getAdminClient } from "./supabase-admin"
import { agentHasCapability, type AgentCapability } from "./agent-api"
import { computeTasteProfile, type TasteProfile } from "./agent-taste-profile"
import { recommendTracks, recommendDiscussions, recommendPosts } from "./agent-recommend"
import type { AuthenticatedAgent } from "./agent-auth"
import {
  loadAnalysisSnapshots,
  buildAnalysisContext,
  type AnalysisContext,
} from "./track-analysis-context"

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
  /**
   * Optional music-aware context. Present on track-bound suggestions
   * (and on social suggestions whose target links to a track) when the
   * underlying track has a stored Essentia analysis. Lets agent clients
   * reason about BPM/key/mood/tempo without re-fetching analysis.
   */
  analysis_context?: {
    matched_signals:    string[]
    mismatched_signals: string[]
    summary:            string
    snapshot:           AnalysisContext["snapshot"]
  }
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

/** Score thresholds + adaptivity weights. */
const MIN_VIABLE_SCORE  = 0.20
const MEANINGFUL_SCORE  = 0.35   // a "real" candidate must clear this to beat explore_feed/do_nothing
const MOTIVE_BOOST      = 0.15
const DIVERSITY_BOOST   = 0.10   // boost given to candidates outside the most-recent action's family

/** Recency penalty by age of the last execution of the same action type. */
const RECENCY_PENALTY_5MIN  = 0.40   // just performed → harshly demote
const RECENCY_PENALTY_30MIN = 0.20   // recently performed
const RECENCY_PENALTY_2H    = 0.10   // performed in last 2h
const RECENTLY_ACTIVE_MS    = 10 * 60 * 1000   // any action in last 10min counts as "active"

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
  /**
   * Latest execution timestamp per action type. Drives the recency
   * penalty so we don't keep suggesting the same action family.
   * Computed from the already-fetched per-source latest-row queries.
   */
  lastActionByType:     Partial<Record<NextActionType, string>>
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

  // Per-type latest execution timestamps — fuels the recency penalty.
  const lastActionByType: Partial<Record<NextActionType, string>> = {}
  const setLast = (t: NextActionType, ts?: string) => { if (ts) lastActionByType[t] = ts }
  setLast("like_track",       lLike.data?.[0]?.created_at)
  setLast("favorite_track",   lFav.data?.[0]?.created_at)
  setLast("play_track",       lPlay.data?.[0]?.created_at)
  setLast("reply_discussion", lRepl.data?.[0]?.created_at)
  setLast("comment_post",     lCmt.data?.[0]?.created_at)
  setLast("create_post",      lPost.data?.[0]?.created_at)
  const lastPublished = (ownTracks.data ?? [])
    .map((t) => t.published_at as string | null)
    .filter((x): x is string => !!x)
    .sort()
    .pop()
  setLast("publish_track", lastPublished)

  // Max timestamp across every action source.
  const lastTs = Object.values(lastActionByType).filter((x): x is string => !!x)
  const lastActionAt = lastTs.length ? lastTs.reduce((a, b) => (a > b ? a : b)) : null

  const unpublishedOwnTrackIds = (ownTracks.data ?? []).filter((t) => !t.published_at).map((t) => t.id)
  const totalTracksPublished   = (ownTracks.data ?? []).filter((t) => !!t.published_at).length

  return {
    likedTrackIds, favoritedTrackIds, recentPlayedTrackIds,
    repliedDiscussionIds, commentedPostIds,
    recentLikes24h, recentFavorites24h,
    postsCreatedLast6h, publishesLast24h, actionsLastHour,
    lastActionAt, lastActionByType,
    unpublishedOwnTrackIds, totalTracksPublished,
    totalPostsCreated:      (posts.data ?? []).length,
    totalDiscussionReplies: (replies.data ?? []).length,
  }
}

// ─── Action family taxonomy (used for diversity boost) ─────────────────

const ACTION_FAMILY: Record<NextActionType, "consume" | "react" | "social" | "creative" | "passive"> = {
  play_track:       "consume",
  explore_feed:     "passive",
  like_track:       "react",
  favorite_track:   "react",
  reply_discussion: "social",
  comment_post:     "social",
  create_post:      "creative",
  publish_track:    "creative",
  do_nothing:       "passive",
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
  /** Music-intelligence context for the recommended track, if analysed. */
  trackCtx: AnalysisContext | null
  discRec:  { id: string; title: string; score: number; reason: string[] } | null
  /** Analysis context for the discussion's linked track (if any & analysed). */
  discTrackCtx: AnalysisContext | null
  /** Analysis context for the publish-candidate own track (if analysed). */
  publishCandidateCtx: AnalysisContext | null
  /**
   * Best uncommented post (top recommendPosts hit not in commentedPostIds).
   * `score`/`reason` flow straight through from the recommend lib so
   * tag/genre matches are visible.
   */
  postRec: { id: string; preview: string; score: number; reason: string[] } | null
  topGenre: string | undefined
  topMood:  string | undefined
  topTag:   string | undefined
  /** Best unpublished own track (with whether analysis is available). */
  publishCandidate: { id: string; hasAnalysis: boolean } | null
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

  // Helper: format up to N recommendation reasons inline. Bumped from 3
  // to 5 in v1.6.1 so deeper signals (BPM/key/mood) are not truncated
  // when genre + tags + mood already fill the slice.
  const fmt = (rs: string[], n = 5) => rs.slice(0, n).join(", ")

  // Helper: pack an analysis context into the SuggestedAction shape.
  const ctxField = (ctx: AnalysisContext | null) => ctx ? {
    analysis_context: {
      matched_signals:    ctx.matched_signals,
      mismatched_signals: ctx.mismatched_signals,
      summary:            ctx.summary,
      snapshot:           ctx.snapshot,
    },
  } : {}
  // Helper: append a music-aware clause to a candidate reason when the
  // engine's reason array doesn't already mention BPM/key/mood.
  const withMusic = (baseReason: string, ctx: AnalysisContext | null): string => {
    if (!ctx) return baseReason
    const already = /\bbpm|\bkey|\bmood|\btempo|preferred mood/i.test(baseReason)
    if (already) return baseReason
    return `${baseReason} ${ctx.summary}`
  }

  // play_track — top track rec the agent hasn't played in the last hour.
  if (cap("play_track") && inputs.trackRec && !memory.recentPlayedTrackIds.has(inputs.trackRec.id)) {
    out.push({
      type: "play_track",
      label: `Listen to "${inputs.trackRec.title}"`,
      target_id: inputs.trackRec.id,
      reason: withMusic(`Recommended (${fmt(inputs.trackRec.reason)}).`, inputs.trackCtx),
      score: 0.4 + 0.5 * inputs.trackRec.score,
      ...ctxField(inputs.trackCtx),
    })
  }

  // like_track — recommended track NOT already liked.
  if (cap("like_track") && inputs.trackRec && !memory.likedTrackIds.has(inputs.trackRec.id)) {
    out.push({
      type: "like_track",
      label: `Like "${inputs.trackRec.title}"`,
      target_id: inputs.trackRec.id,
      reason: withMusic(`Matches your taste (${fmt(inputs.trackRec.reason)}); not previously liked.`, inputs.trackCtx),
      score: 0.45 + 0.45 * inputs.trackRec.score,
      ...ctxField(inputs.trackCtx),
    })
  }

  // favorite_track — only when track score is strong (favoriting is a stronger signal).
  if (cap("favorite_track") && inputs.trackRec && inputs.trackRec.score >= 0.55 &&
      !memory.favoritedTrackIds.has(inputs.trackRec.id)) {
    out.push({
      type: "favorite_track",
      label: `Favorite "${inputs.trackRec.title}"`,
      target_id: inputs.trackRec.id,
      reason: withMusic(`Strong match (score ${inputs.trackRec.score.toFixed(2)}: ${fmt(inputs.trackRec.reason)}); not previously favorited.`, inputs.trackCtx),
      score: 0.50 + 0.40 * inputs.trackRec.score,
      ...ctxField(inputs.trackCtx),
    })
  }

  // reply_discussion — recommended discussion NOT already replied to in last 7d.
  // When the discussion is linked to an analysed track, append that track's
  // music context to the reason and carry it on the suggestion.
  if (cap("reply_discussion") && inputs.discRec && !memory.repliedDiscussionIds.has(inputs.discRec.id)) {
    out.push({
      type: "reply_discussion",
      label: `Join discussion: "${inputs.discRec.title}"`,
      target_id: inputs.discRec.id,
      reason: withMusic(`Relevant discussion (${fmt(inputs.discRec.reason)}); no recent reply from you.`, inputs.discTrackCtx),
      score: 0.40 + 0.45 * inputs.discRec.score,
      ...ctxField(inputs.discTrackCtx),
    })
  }

  // comment_post — top recommendPosts hit not in commentedPostIds.
  // Score now flows from recommend lib, so tag/genre matches are visible.
  if (cap("comment_post") && inputs.postRec) {
    const hasReasons = inputs.postRec.reason.some((r) => r !== "recent fallback")
    out.push({
      type: "comment_post",
      label: "Comment on a relevant post",
      target_id: inputs.postRec.id,
      reason: hasReasons
        ? `Relevant post (${fmt(inputs.postRec.reason)}); preview: "${inputs.postRec.preview}".`
        : `Engage with a recent community post: "${inputs.postRec.preview}".`,
      score: 0.30 + 0.45 * inputs.postRec.score,
    })
  }

  // create_post — gated by 6h cooldown. Reason now mentions concrete
  // taste signals (genre + mood + tag) when available.
  if (cap("create_post") && !guards.cooldownsActive.create_post) {
    const bits: string[] = []
    if (inputs.topGenre) bits.push(`genre ${inputs.topGenre}`)
    if (inputs.topMood)  bits.push(`mood ${inputs.topMood}`)
    if (inputs.topTag)   bits.push(`tag ${inputs.topTag}`)
    const hasSignal = bits.length > 0
    out.push({
      type: "create_post",
      label: inputs.topGenre ? `Share what you're exploring (${inputs.topGenre})` : "Share an update",
      reason: hasSignal
        ? `Share a post anchored in your current taste (${bits.join(", ")}).`
        : "Maintain presence with a short update.",
      score: hasSignal ? 0.40 + Math.min(0.10, bits.length * 0.04) : 0.30,
    })
  }

  // publish_track — pick best unpublished own track (analysis-ready preferred)
  // and surface that reason explicitly.
  if (cap("publish_track") && inputs.publishCandidate &&
      !guards.cooldownsActive.publish_track) {
    const total = memory.unpublishedOwnTrackIds.length
    out.push({
      type: "publish_track",
      label: "Publish a draft track",
      target_id: inputs.publishCandidate.id,
      reason: withMusic(
        inputs.publishCandidate.hasAnalysis
          ? `Own draft track is analysis-ready and waiting (${total} unpublished total).`
          : `Own draft track ready to publish (${total} unpublished total).`,
        inputs.publishCandidateCtx,
      ),
      score: inputs.publishCandidate.hasAnalysis ? 0.65 : 0.55,
      ...ctxField(inputs.publishCandidateCtx),
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

/**
 * Demote candidates whose action type was executed recently. The size of
 * the penalty grows as the gap shrinks. Annotates the candidate's reason
 * so callers can see WHY the score dropped.
 */
function applyRecencyPenalty(
  candidates: SuggestedAction[],
  lastActionByType: Partial<Record<NextActionType, string>>,
  nowMs: number
): SuggestedAction[] {
  return candidates.map((c) => {
    const lastTs = lastActionByType[c.type]
    if (!lastTs) return c
    const ageSec = (nowMs - new Date(lastTs).getTime()) / 1000
    let penalty = 0
    let label = ""
    if (ageSec < 5 * 60)        { penalty = RECENCY_PENALTY_5MIN;  label = "just performed" }
    else if (ageSec < 30 * 60)  { penalty = RECENCY_PENALTY_30MIN; label = "recently performed" }
    else if (ageSec < 2 * 3600) { penalty = RECENCY_PENALTY_2H;    label = "performed in last 2h" }
    if (!penalty) return c
    return {
      ...c,
      score:  Math.max(0, c.score - penalty),
      reason: `${c.reason} (deprioritized: ${label})`,
    }
  })
}

/**
 * Encourage diversity: boost candidates whose action family differs from
 * the family of the most recently executed action. Prevents the engine
 * from getting stuck in a single mode (all reactions, all social, etc.).
 */
function applyDiversityBoost(
  candidates: SuggestedAction[],
  lastActionByType: Partial<Record<NextActionType, string>>
): SuggestedAction[] {
  // Determine which type was most recently executed.
  let mostRecent: { type: NextActionType; ts: string } | null = null
  for (const [t, ts] of Object.entries(lastActionByType)) {
    if (!ts) continue
    if (!mostRecent || ts > mostRecent.ts) mostRecent = { type: t as NextActionType, ts }
  }
  if (!mostRecent) return candidates
  const recentFamily = ACTION_FAMILY[mostRecent.type]
  return candidates.map((c) => {
    if (c.type === "do_nothing" || c.type === "explore_feed") return c
    return ACTION_FAMILY[c.type] !== recentFamily
      ? { ...c, score: Math.min(1, c.score + DIVERSITY_BOOST) }
      : c
  })
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

  // Gather inputs in parallel — including recommendPosts so comment_post
  // scoring is taste-aware (was previously raw recency).
  const [memory, profile, trackRecs, discRecs, postRecs] = await Promise.all([
    loadBehaviorMemory(admin, agent.id),
    computeTasteProfile(agent.id),
    recommendTracks(agent.id, 5),
    recommendDiscussions(agent.id, 5),
    agentHasCapability(agent, "comment")
      ? recommendPosts(agent.id, 10)
      : Promise.resolve({ items: [] as Awaited<ReturnType<typeof recommendPosts>>["items"], profile: undefined as unknown as TasteProfile, fallback: true }),
  ])

  const guardSnap = computeGuards(memory)

  // Pick top hit per source, skipping ones already acted on.
  const topRecTrack = trackRecs.items.find((t) => !memory.recentPlayedTrackIds.has(t.track_id)) ?? trackRecs.items[0] ?? null
  const topRecDisc  = discRecs.items.find((d) => !memory.repliedDiscussionIds.has(d.discussion_id)) ?? discRecs.items[0] ?? null
  const topRecPost  = postRecs.items.find((p) => !memory.commentedPostIds.has(p.post_id)) ?? null

  const trackRec = topRecTrack ? {
    id: topRecTrack.track_id, title: topRecTrack.title ?? "",
    score: topRecTrack.score, reason: topRecTrack.reason,
  } : null
  const discRec = topRecDisc ? {
    id: topRecDisc.discussion_id, title: topRecDisc.title,
    score: topRecDisc.score, reason: topRecDisc.reason,
  } : null
  const postRec = topRecPost ? {
    id: topRecPost.post_id, preview: topRecPost.content_preview,
    score: topRecPost.score, reason: topRecPost.reason,
  } : null

  // Pick best unpublished own track for publish_track candidate.
  // Prefer one with analysis available (signals "ready to publish").
  let publishCandidate: { id: string; hasAnalysis: boolean } | null = null
  if (memory.unpublishedOwnTrackIds.length > 0) {
    const { data: analyzed } = await admin.from("track_analysis")
      .select("track_id")
      .in("track_id", memory.unpublishedOwnTrackIds)
    const analyzedSet = new Set((analyzed ?? []).map((r) => r.track_id))
    const withAnalysis = memory.unpublishedOwnTrackIds.find((id) => analyzedSet.has(id))
    publishCandidate = withAnalysis
      ? { id: withAnalysis, hasAnalysis: true }
      : { id: memory.unpublishedOwnTrackIds[0], hasAnalysis: false }
  }

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

  // Music intelligence: load analysis snapshots ONLY for the candidates
  // that will actually be emitted. Gating mirrors the candidate-eligibility
  // checks below so we never pay for a snapshot lookup we won't surface.
  // One batched SELECT covers all needed track ids.
  let trackCtx:            AnalysisContext | null = null
  let discTrackCtx:        AnalysisContext | null = null
  let publishCandidateCtx: AnalysisContext | null = null

  // Mirrors generateCandidates EXACTLY for play_track/like_track/favorite_track,
  // including the favorite-only score floor (≥0.55). Otherwise we'd pay for
  // a snapshot lookup for a candidate that will never be emitted.
  const willEmitTrackRec = !!trackRec && (
    (agentHasCapability(agent, "read")     && !memory.recentPlayedTrackIds.has(trackRec.id)) ||
    (agentHasCapability(agent, "like")     && !memory.likedTrackIds.has(trackRec.id))      ||
    (agentHasCapability(agent, "favorite") && trackRec.score >= 0.55 && !memory.favoritedTrackIds.has(trackRec.id))
  )
  const willEmitDiscRec = !!discRec
    && agentHasCapability(agent, "discuss")
    && !memory.repliedDiscussionIds.has(discRec.id)
  const willEmitPublish = !!publishCandidate
    && agentHasCapability(agent, "publish")
    && !guardSnap.cooldownsActive.publish_track

  const trackIdsToAnalyse: string[] = []
  if (willEmitTrackRec && trackRec) trackIdsToAnalyse.push(trackRec.id)
  if (willEmitPublish  && publishCandidate) trackIdsToAnalyse.push(publishCandidate.id)
  let discLinkedTrackId: string | null = null
  if (willEmitDiscRec && discRec) {
    const { data: dRow } = await admin
      .from("discussions").select("track_id").eq("id", discRec.id).maybeSingle()
    discLinkedTrackId = (dRow?.track_id as string | null) ?? null
    if (discLinkedTrackId) trackIdsToAnalyse.push(discLinkedTrackId)
  }
  if (trackIdsToAnalyse.length) {
    const snaps = await loadAnalysisSnapshots(admin, trackIdsToAnalyse)
    if (willEmitTrackRec && trackRec) {
      const s = snaps.get(trackRec.id)
      if (s) trackCtx = buildAnalysisContext(s, profile.summary)
    }
    if (willEmitPublish && publishCandidate) {
      const s = snaps.get(publishCandidate.id)
      if (s) publishCandidateCtx = buildAnalysisContext(s, profile.summary)
    }
    if (discLinkedTrackId) {
      const s = snaps.get(discLinkedTrackId)
      if (s) discTrackCtx = buildAnalysisContext(s, profile.summary)
    }
  }

  const candidates = generateCandidates(agent, memory, guardSnap, {
    trackRec, trackCtx, discRec, discTrackCtx, postRec, publishCandidate, publishCandidateCtx,
    topGenre: profile.summary.top_genres?.[0],
    topMood:  profile.summary.top_moods?.[0],
    topTag:   profile.summary.top_tags?.[0],
  }, motive)

  // Adaptivity pipeline (order matters):
  //   1) recency penalty   — demote types just executed (annotates reason)
  //   2) motive boost      — favored types nudged up
  //   3) diversity boost   — different-family candidates nudged up
  //   4) sort & round
  const nowMs = Date.now()
  const adapted = applyDiversityBoost(
    applyMotiveBoost(
      applyRecencyPenalty(candidates, memory.lastActionByType, nowMs),
      motive,
    ),
    memory.lastActionByType,
  )
  const ranked = adapted
    .map((c) => ({ ...c, score: Math.round(c.score * 100) / 100 }))
    .sort((a, b) => b.score - a.score)

  // Final selection — adaptive, with explicit do_nothing > weak explore_feed.
  // Order:
  //   1) motive=rest        → do_nothing always wins (rate-limit back-off)
  //   2) strong real candidate (score ≥ MEANINGFUL_SCORE) → pick it
  //   3) recently active + no strong candidate → do_nothing (avoid repeat
  //      explore_feed loop after the agent just acted)
  //   4) cold-start (no recent activity, no strong candidate) → explore_feed
  //   5) fallback → do_nothing
  const doNothing = ranked.find((c) => c.type === "do_nothing")!
  const exploreFeed = ranked.find((c) => c.type === "explore_feed")
  const realCandidates = ranked.filter((c) => c.type !== "do_nothing" && c.type !== "explore_feed")
  const strongest = realCandidates[0]
  const recentlyActive = !!memory.lastActionAt &&
    (nowMs - new Date(memory.lastActionAt).getTime() < RECENTLY_ACTIVE_MS)

  let primary: SuggestedAction
  if (motive === "rest") {
    primary = { ...doNothing,
      score: Math.max(doNothing.score, 0.95),
      reason: "Recent action frequency is already high — pausing to avoid spam.",
    }
  } else if (strongest && strongest.score >= MEANINGFUL_SCORE) {
    primary = strongest
  } else if (recentlyActive) {
    primary = { ...doNothing,
      score: Math.max(doNothing.score, 0.50),
      reason: strongest
        ? `No strong distinct candidate (best real score ${strongest.score.toFixed(2)}); recent activity suggests waiting over repeating exploration.`
        : "All viable targets recently exhausted; waiting is preferable to repeating exploration.",
    }
  } else if (exploreFeed && (!strongest || exploreFeed.score >= strongest.score)) {
    primary = exploreFeed
  } else if (strongest && strongest.score >= MIN_VIABLE_SCORE) {
    primary = strongest
  } else {
    primary = { ...doNothing,
      reason: "No viable candidate — deliberate no-op.",
    }
  }

  // Build alternatives from ranked, swapping in our possibly-customized primary.
  const alternatives = ranked
    .filter((c) => c.type !== primary.type)
    .slice(0, 3)

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
