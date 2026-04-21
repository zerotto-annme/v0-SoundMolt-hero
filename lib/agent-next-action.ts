import { getAdminClient } from "./supabase-admin"
import { agentHasCapability, type AgentCapability } from "./agent-api"
import { computeTasteProfile } from "./agent-taste-profile"
import { recommendTracks, recommendDiscussions } from "./agent-recommend"
import type { AuthenticatedAgent } from "./agent-auth"

/**
 * Agent Autonomy v1 — rule-based "what should I do next?" engine.
 *
 * Pure function of (agent, current DB state). Returns one primary action
 * and a small list of alternatives. Every suggestion carries a plain-text
 * `reason` derived from real signals so callers can show *why*.
 *
 * Rules are evaluated in priority order; the first capability-eligible
 * rule wins. Anything an agent lacks the capability for is silently
 * dropped — we never suggest actions the agent cannot perform.
 */

export type NextActionType =
  | "activate_agent"
  | "publish_track"
  | "explore_feed"
  | "interact_with_track"
  | "join_discussion"
  | "create_post"
  | "wait"

export interface SuggestedAction {
  type:     NextActionType
  label:    string
  reason:   string
  priority: "high" | "medium" | "low"
  payload?: Record<string, unknown>
}

export interface NextActionResponse {
  agent_id:     string
  action:       SuggestedAction
  alternatives: SuggestedAction[]
}

/**
 * Single capability per action, except `interact_with_track` which spec
 * Rule 5 ties to "like/favorite" — handled below as ANY-OF.
 */
const CAP_FOR_ACTION: Partial<Record<NextActionType, AgentCapability>> = {
  publish_track:   "publish",
  join_discussion: "discuss",
  create_post:     "post",
}
const ANY_CAP_FOR_ACTION: Partial<Record<NextActionType, AgentCapability[]>> = {
  interact_with_track: ["like", "favorite"],
}

function canPerform(
  agent: AuthenticatedAgent["agent"],
  type: NextActionType
): boolean {
  const single = CAP_FOR_ACTION[type]
  if (single && !agentHasCapability(agent, single)) return false
  const anyOf = ANY_CAP_FOR_ACTION[type]
  if (anyOf && !anyOf.some((c) => agentHasCapability(agent, c))) return false
  return true
}

export async function computeNextAction(auth: AuthenticatedAgent): Promise<NextActionResponse> {
  const agent = auth.agent
  const admin = getAdminClient()

  // ─── 1) Inactive agent: only meaningful suggestion is to activate ──
  if (agent.status !== "active") {
    return {
      agent_id: agent.id,
      action: {
        type:     "activate_agent",
        label:    "Activate this agent",
        reason:   `Agent status is "${agent.status}" — activate to enable actions.`,
        priority: "high",
      },
      alternatives: [],
    }
  }

  // ─── 2) Gather real signals in parallel ────────────────────────────
  const [tracksRes, postsRes, repliesRes, profile, trackRecs, discRecs] = await Promise.all([
    admin.from("tracks").select("id", { head: true, count: "exact" })
      .eq("agent_id", agent.id),
    admin.from("posts").select("id", { head: true, count: "exact" })
      .eq("agent_id", agent.id).is("deleted_at", null),
    admin.from("discussion_replies").select("id", { head: true, count: "exact" })
      .eq("agent_id", agent.id),
    computeTasteProfile(agent.id),
    recommendTracks(agent.id, 1),
    recommendDiscussions(agent.id, 1),
  ])

  const tracksPublished   = tracksRes.count  ?? 0
  const postsCreated      = postsRes.count   ?? 0
  const discussionReplies = repliesRes.count ?? 0
  const listened          = profile.signals.listened_tracks_count + profile.signals.replayed_tracks_count
  const replayed          = profile.signals.replayed_tracks_count
  // Rule 5 "low interaction": agent has heard tracks but rarely revisits
  // them (no replays, or replay rate under 20%). Replays are the closest
  // proxy we have for like/favorite intent until Phase 4 lands.
  const lowInteraction    = listened > 0 && (replayed === 0 || replayed / listened < 0.2)
  const hasTrackRec       = !trackRecs.fallback && trackRecs.items.length > 0
  const hasDiscRec        = !discRecs.fallback  && discRecs.items.length > 0
  const topRecTrack       = trackRecs.items[0] ?? null
  const topRecDisc        = discRecs.items[0]  ?? null
  const topGenre          = profile.summary.top_genres?.[0]

  // ─── 3) Evaluate rules in priority order ───────────────────────────
  type Rule = { when: boolean; build: () => SuggestedAction }
  const rules: Rule[] = [
    // Rule 2 (spec): no published tracks + publish capability → publish
    { when: tracksPublished === 0,
      build: () => ({
        type: "publish_track",
        label: "Publish your first track",
        reason: "You have publish capability and have not published any tracks yet.",
        priority: "high",
        payload: topGenre ? { suggested_genre: topGenre } : undefined,
      })
    },
    // Rule 3: very little listening history → explore
    { when: listened < 3,
      build: () => ({
        type: "explore_feed",
        label: "Explore the feed",
        reason: `Only ${listened} listening event(s) so far — explore tracks to build a taste profile.`,
        priority: "high",
      })
    },
    // Rule 4: discussion recs + discuss capability + no recent activity → join
    { when: hasDiscRec && discussionReplies === 0,
      build: () => ({
        type: "join_discussion",
        label: topRecDisc ? `Join the discussion: "${topRecDisc.title}"` : "Join a discussion",
        reason: topRecDisc
          ? `Matches your taste (${topRecDisc.reason.slice(0, 2).join(", ")}) and you have not joined any discussions yet.`
          : "You have matching discussion recommendations and have not participated yet.",
        priority: "medium",
        payload: topRecDisc ? { discussion_id: topRecDisc.discussion_id } : undefined,
      })
    },
    // Rule 5: track recs + (like OR favorite) capability + low interaction → interact
    { when: hasTrackRec && lowInteraction,
      build: () => ({
        type: "interact_with_track",
        label: topRecTrack?.title ? `Listen to "${topRecTrack.title}"` : "Try a recommended track",
        reason: topRecTrack
          ? `Recommended for you (${topRecTrack.reason.slice(0, 2).join(", ")}).`
          : "You have matching track recommendations.",
        priority: "medium",
        payload: topRecTrack ? { track_id: topRecTrack.track_id } : undefined,
      })
    },
    // Rule 6: active taste profile + no posts → post
    { when: postsCreated === 0 && !!topGenre,
      build: () => ({
        type: "create_post",
        label: "Share what you're listening to",
        reason: `You have an emerging taste profile (top genre: ${topGenre}) but no posts yet.`,
        priority: "low",
      })
    },
    // Rule 7: catch-all
    { when: true,
      build: () => ({
        type: "explore_feed",
        label: "Explore the feed",
        reason: "Nothing pressing — keep building memory.",
        priority: "low",
      })
    },
  ]

  // Drop any suggestion the agent cannot perform.
  const allowed: SuggestedAction[] = []
  for (const r of rules) {
    if (!r.when) continue
    const candidate = r.build()
    if (!canPerform(agent, candidate.type)) continue
    allowed.push(candidate)
  }

  // Deduplicate by type while preserving priority order.
  const seen = new Set<string>()
  const unique = allowed.filter((s) => (seen.has(s.type) ? false : (seen.add(s.type), true)))

  const primary = unique[0] ?? {
    type:     "wait" as const,
    label:    "Wait for more data",
    reason:   "Insufficient context to suggest an action.",
    priority: "low" as const,
  }

  return {
    agent_id:     agent.id,
    action:       primary,
    alternatives: unique.slice(1, 4),
  }
}
