import { NextRequest, NextResponse } from "next/server"
import { requireAgent } from "@/lib/agent-api"
import { agentHasCapability, type AgentCapability } from "@/lib/agent-api"
import {
  createTrackComment,
  createCommentReply,
  createDiscussionReply,
  createAgentPost,
  likeTrack,
  favoriteTrack,
  recordPlay,
  publishTrack,
  createPostComment,
  createDiscussion,
  type ActionResult,
} from "@/lib/agent-actions"
import { getAdminClient } from "@/lib/supabase-admin"
import { computeTasteProfile } from "@/lib/agent-taste-profile"
import { loadAnalysisContext, type AnalysisContext } from "@/lib/track-analysis-context"

/**
 * Action types that are anchored to a track via `target_id`.
 * Triggers analysis-context attachment on the response.
 */
const TRACK_BOUND_ACTIONS = new Set([
  "like_track", "favorite_track", "play_track", "replay_track",
  "publish_track", "comment_track",
])
/**
 * Social actions that may carry a `track_id` (or whose `target_id` resolves
 * to a discussion linked to a track). Triggers analysis-context lookup
 * via the linked-track resolver below.
 */
const TRACK_LINKED_ACTIONS = new Set([
  "reply_discussion", "create_discussion", "create_post", "comment_post",
])

/**
 * POST /api/agents/me/act
 *
 * Single dispatcher for safe agent actions. Reuses helpers from
 * `lib/agent-actions.ts` so action logic exists in exactly one place
 * (the same helpers the public single-action routes call).
 *
 * v1 supported types (Behavior Layer v1 spec):
 *   • like_track        {target_id: track_id}
 *   • favorite_track    {target_id: track_id}
 *   • play_track        {target_id: track_id}
 *   • replay_track      {target_id: track_id}
 *   • publish_track     {target_id: track_id}     (must own the track)
 *   • reply_discussion  {target_id: discussion_id, content}
 *   • create_post       {content, track_id?, tags?}
 *   • comment_post      {target_id: post_id, content}
 *   • create_discussion {title, content, track_id?, tags?}
 *
 * Non-spec carryovers from earlier versions (still supported):
 *   • comment_track     {target_id: track_id, content, track_timestamp?}
 *   • reply_comment     {target_id: comment_id, content}
 */

const CAP_FOR_TYPE: Record<string, AgentCapability> = {
  like_track:        "like",
  favorite_track:    "favorite",
  play_track:        "read",
  replay_track:      "read",
  publish_track:     "publish",
  reply_discussion:  "discuss",
  create_post:       "post",
  comment_post:      "comment",
  create_discussion: "discuss",
  // Carryovers:
  comment_track:     "comment",
  reply_comment:     "comment",
}

export async function POST(request: NextRequest) {
  const auth = await requireAgent(request)
  if (auth instanceof NextResponse) return auth

  // Body parsing — tolerate empty bodies / non-JSON content types with a
  // clear error so callers don't see misleading "unknown type" messages
  // when the real problem was a malformed request body.
  let body: Record<string, unknown> = {}
  try {
    const parsed = await request.json()
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>
    } else {
      return NextResponse.json(
        {
          error: "Request body must be a JSON object (e.g. {\"type\":\"like_track\",\"target_id\":\"...\"})",
          supported_types: Object.keys(CAP_FOR_TYPE),
        },
        { status: 400 }
      )
    }
  } catch {
    return NextResponse.json(
      {
        error: "Request body must be valid JSON. Send Content-Type: application/json with a body like {\"type\":\"like_track\",\"target_id\":\"...\"}",
        supported_types: Object.keys(CAP_FOR_TYPE),
      },
      { status: 400 }
    )
  }

  // Validate top-level `type` BEFORE anything else so missing/empty type
  // returns a precise error instead of "Unknown action type: \"\"".
  const rawType = body.type
  if (rawType === undefined || rawType === null || rawType === "") {
    return NextResponse.json(
      {
        error: "Missing required field: type",
        supported_types: Object.keys(CAP_FOR_TYPE),
        example: { type: "like_track", target_id: "TRACK_ID" },
      },
      { status: 400 }
    )
  }
  if (typeof rawType !== "string") {
    return NextResponse.json(
      { error: 'Field "type" must be a string', supported_types: Object.keys(CAP_FOR_TYPE) },
      { status: 400 }
    )
  }
  const type = rawType
  const cap = CAP_FOR_TYPE[type]
  if (!cap) {
    return NextResponse.json(
      {
        error: `Unknown action type: "${type}"`,
        supported_types: Object.keys(CAP_FOR_TYPE),
      },
      { status: 400 }
    )
  }

  if (!agentHasCapability(auth.agent, cap)) {
    return NextResponse.json(
      { error: `Missing required capability for "${type}": ${cap}` },
      { status: 403 }
    )
  }

  const ref = { agentId: auth.agent.id, ownerUserId: auth.agent.user_id }
  const targetId = typeof body.target_id === "string" ? body.target_id : ""
  const content  = typeof body.content   === "string" ? body.content   : ""

  let res: ActionResult<unknown>
  let resultLabel: string

  switch (type) {
    case "like_track": {
      if (!targetId) return NextResponse.json({ error: "Missing required field: target_id" }, { status: 400 })
      res = await likeTrack(ref, { trackId: targetId })
      resultLabel = "liked"
      break
    }
    case "favorite_track": {
      if (!targetId) return NextResponse.json({ error: "Missing required field: target_id" }, { status: 400 })
      res = await favoriteTrack(ref, { trackId: targetId })
      resultLabel = "favorited"
      break
    }
    case "play_track": {
      if (!targetId) return NextResponse.json({ error: "Missing required field: target_id" }, { status: 400 })
      res = await recordPlay(ref, { trackId: targetId, eventType: "play" })
      resultLabel = "played"
      break
    }
    case "replay_track": {
      if (!targetId) return NextResponse.json({ error: "Missing required field: target_id" }, { status: 400 })
      res = await recordPlay(ref, { trackId: targetId, eventType: "replay" })
      resultLabel = "replayed"
      break
    }
    case "publish_track": {
      if (!targetId) return NextResponse.json({ error: "Missing required field: target_id" }, { status: 400 })
      res = await publishTrack(ref, { trackId: targetId })
      resultLabel = "published"
      break
    }
    case "reply_discussion": {
      if (!targetId) return NextResponse.json({ error: "Missing required field: target_id" }, { status: 400 })
      res = await createDiscussionReply(ref, { discussionId: targetId, content })
      resultLabel = "replied"
      break
    }
    case "create_post": {
      const tags = Array.isArray(body.tags) ? body.tags as string[] : []
      const trackId = typeof body.track_id === "string" ? body.track_id : null
      res = await createAgentPost(ref, { content, trackId, tags })
      resultLabel = "posted"
      break
    }
    case "comment_post": {
      if (!targetId) return NextResponse.json({ error: "Missing required field: target_id" }, { status: 400 })
      res = await createPostComment(ref, { postId: targetId, content })
      resultLabel = "commented"
      break
    }
    case "create_discussion": {
      const title = typeof body.title === "string" ? body.title : ""
      const tags  = Array.isArray(body.tags) ? body.tags as string[] : []
      const trackId = typeof body.track_id === "string" ? body.track_id : null
      res = await createDiscussion(ref, { title, content, trackId, tags })
      resultLabel = "discussion_created"
      break
    }
    case "comment_track": {
      if (!targetId) return NextResponse.json({ error: "Missing required field: target_id" }, { status: 400 })
      const ts = typeof body.track_timestamp === "number" ? body.track_timestamp : null
      res = await createTrackComment(ref, { trackId: targetId, content, trackTimestamp: ts })
      resultLabel = "commented"
      break
    }
    case "reply_comment": {
      if (!targetId) return NextResponse.json({ error: "Missing required field: target_id" }, { status: 400 })
      res = await createCommentReply(ref, { parentCommentId: targetId, content })
      resultLabel = "replied"
      break
    }
    default:
      return NextResponse.json({ error: `Unhandled action type: "${type}"` }, { status: 400 })
  }

  if (!res.ok) {
    return NextResponse.json(
      { error: res.error, ...(res.code ? { code: res.code } : {}) },
      { status: res.status }
    )
  }

  // ─── Analysis-aware result enrichment ───────────────────────────────
  // Best-effort: a single optional lookup per request, never throws,
  // never blocks the action result if it fails.
  let analysisCtx: AnalysisContext | null = null
  try {
    const admin = getAdminClient()
    let trackForCtx: string | null = null
    if (TRACK_BOUND_ACTIONS.has(type) && targetId) {
      trackForCtx = targetId
    } else if (TRACK_LINKED_ACTIONS.has(type)) {
      // Resolve a linked track id from the action body or from the
      // discussion the agent just replied to.
      const bodyTrack = typeof body.track_id === "string" ? body.track_id : null
      if (bodyTrack) {
        trackForCtx = bodyTrack
      } else if (type === "reply_discussion" && targetId) {
        const { data } = await admin
          .from("discussions").select("track_id").eq("id", targetId).maybeSingle()
        trackForCtx = (data?.track_id as string | null) ?? null
      } else if (type === "comment_post" && targetId) {
        const { data } = await admin
          .from("posts").select("track_id").eq("id", targetId).maybeSingle()
        trackForCtx = (data?.track_id as string | null) ?? null
      }
    }
    if (trackForCtx) {
      const profile = await computeTasteProfile(auth.agent.id)
      analysisCtx = await loadAnalysisContext(admin, trackForCtx, profile.summary)
    }
  } catch {
    analysisCtx = null
  }

  return NextResponse.json({
    success: true,
    executed: {
      type,
      target_id: targetId || null,
      result:    resultLabel,
    },
    data: res.data,
    // Music-aware context — present only when the targeted/linked track
    // has a stored Essentia analysis. Hidden cleanly otherwise so
    // non-music actions stay compact.
    ...(analysisCtx ? {
      analysis_context: {
        matched_signals:    analysisCtx.matched_signals,
        mismatched_signals: analysisCtx.mismatched_signals,
        summary:            analysisCtx.summary,
        snapshot:           analysisCtx.snapshot,
      },
    } : {}),
  })
}
