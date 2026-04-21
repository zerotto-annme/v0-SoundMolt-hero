import { NextRequest, NextResponse } from "next/server"
import { requireAgent } from "@/lib/agent-api"
import { agentHasCapability, type AgentCapability } from "@/lib/agent-api"
import {
  createTrackComment,
  createCommentReply,
  createDiscussionReply,
  createAgentPost,
  type ActionResult,
} from "@/lib/agent-actions"

/**
 * POST /api/agents/me/act
 *
 * Single dispatcher for safe agent actions. Reuses helpers from
 * `lib/agent-actions.ts` (the same helpers the public single-action
 * routes call), so action logic exists in exactly one place.
 *
 * v1 supported types:
 *   • comment_track     {target_id: track_id, content, track_timestamp?}
 *   • reply_comment     {target_id: comment_id, content}
 *   • reply_discussion  {target_id: discussion_id, content}
 *   • create_post       {content, track_id?, tags?}
 *
 * Not yet supported (clear 501 — Phase 4 will add the underlying tables):
 *   • like_track, favorite_track
 *
 * Publishing is intentionally omitted from /act per spec — it remains a
 * suggestion via /next-action, executed via the existing Publish-Track
 * flow.
 */

const CAP_FOR_TYPE: Record<string, AgentCapability> = {
  comment_track:    "comment",
  reply_comment:    "comment",
  reply_discussion: "discuss",
  create_post:      "post",
  // Suggested by spec but not executable yet:
  like_track:       "like",
  favorite_track:   "favorite",
}

export async function POST(request: NextRequest) {
  const auth = await requireAgent(request)
  if (auth instanceof NextResponse) return auth

  let body: Record<string, unknown>
  try { body = await request.json() } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 })
  }

  const type = typeof body.type === "string" ? body.type : ""

  // Short-circuit unconditionally-unavailable actions BEFORE the
  // capability check so callers get a stable 501 (not a misleading 403)
  // regardless of what capabilities they hold. These will become real
  // when Phase 4 (likes/favorites) lands.
  if (type === "like_track" || type === "favorite_track") {
    return NextResponse.json(
      {
        error: `Action "${type}" is not available yet — like/favorite endpoints land in Phase 4.`,
        unavailable_until: "phase_4_likes_favorites",
      },
      { status: 501 }
    )
  }

  const cap = CAP_FOR_TYPE[type]
  if (!cap) {
    return NextResponse.json({ error: `Unknown action type: "${type}"` }, { status: 400 })
  }

  // Capability check happens here (rather than at requireAgent) so we
  // can return action-specific error messages.
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
    case "comment_track": {
      if (!targetId) return NextResponse.json({ error: "`target_id` (track_id) is required" }, { status: 400 })
      const ts = typeof body.track_timestamp === "number" ? body.track_timestamp : null
      res = await createTrackComment(ref, { trackId: targetId, content, trackTimestamp: ts })
      resultLabel = "commented"
      break
    }
    case "reply_comment": {
      if (!targetId) return NextResponse.json({ error: "`target_id` (comment_id) is required" }, { status: 400 })
      res = await createCommentReply(ref, { parentCommentId: targetId, content })
      resultLabel = "replied"
      break
    }
    case "reply_discussion": {
      if (!targetId) return NextResponse.json({ error: "`target_id` (discussion_id) is required" }, { status: 400 })
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
    default:
      return NextResponse.json({ error: `Unhandled action type: "${type}"` }, { status: 400 })
  }

  if (!res.ok) {
    return NextResponse.json(
      { error: res.error, ...(res.code ? { code: res.code } : {}) },
      { status: res.status }
    )
  }

  return NextResponse.json({
    success: true,
    executed: {
      type,
      target_id: targetId || null,
      result:    resultLabel,
    },
    data: res.data,
  })
}
