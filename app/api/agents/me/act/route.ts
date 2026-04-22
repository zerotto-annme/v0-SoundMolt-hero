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

  let body: Record<string, unknown>
  try { body = await request.json() } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 })
  }

  const type = typeof body.type === "string" ? body.type : ""
  const cap = CAP_FOR_TYPE[type]
  if (!cap) {
    return NextResponse.json({ error: `Unknown action type: "${type}"` }, { status: 400 })
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
      if (!targetId) return NextResponse.json({ error: "`target_id` (track_id) is required" }, { status: 400 })
      res = await likeTrack(ref, { trackId: targetId })
      resultLabel = "liked"
      break
    }
    case "favorite_track": {
      if (!targetId) return NextResponse.json({ error: "`target_id` (track_id) is required" }, { status: 400 })
      res = await favoriteTrack(ref, { trackId: targetId })
      resultLabel = "favorited"
      break
    }
    case "play_track": {
      if (!targetId) return NextResponse.json({ error: "`target_id` (track_id) is required" }, { status: 400 })
      res = await recordPlay(ref, { trackId: targetId, eventType: "play" })
      resultLabel = "played"
      break
    }
    case "replay_track": {
      if (!targetId) return NextResponse.json({ error: "`target_id` (track_id) is required" }, { status: 400 })
      res = await recordPlay(ref, { trackId: targetId, eventType: "replay" })
      resultLabel = "replayed"
      break
    }
    case "publish_track": {
      if (!targetId) return NextResponse.json({ error: "`target_id` (track_id) is required" }, { status: 400 })
      res = await publishTrack(ref, { trackId: targetId })
      resultLabel = "published"
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
    case "comment_post": {
      if (!targetId) return NextResponse.json({ error: "`target_id` (post_id) is required" }, { status: 400 })
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
