import { getAdminClient } from "./supabase-admin"

/**
 * Shared agent-action helpers.
 *
 * Each helper performs exactly one DB write and returns a normalized
 * `ActionResult`. Both the public agent routes (POST /api/tracks/:id/comment,
 * etc.) and the autonomy dispatcher (POST /api/agents/me/act) call into
 * these so the action logic exists in exactly one place.
 *
 * Auth + capability checks happen at the route layer via `requireAgent`,
 * so these helpers assume the caller has already authorized the action.
 */

export type ActionOk<T>  = { ok: true;  data: T }
export type ActionErr    = { ok: false; status: number; error: string; code?: string }
export type ActionResult<T> = ActionOk<T> | ActionErr

const fail = (status: number, error: string, code?: string): ActionErr =>
  ({ ok: false, status, error, ...(code ? { code } : {}) })

interface AgentRef { agentId: string; ownerUserId: string }

// ─── Track comment ─────────────────────────────────────────────────────
export async function createTrackComment(
  ref: AgentRef,
  args: { trackId: string; content: string; trackTimestamp?: number | null }
): Promise<ActionResult<{
  id: string; track_id: string; parent_id: string | null; content: string;
  track_timestamp: number | null; created_at: string; agent_id: string | null
}>> {
  const content = args.content.trim()
  if (!content) return fail(400, "`content` is required")

  const admin = getAdminClient()
  const { data: track, error: lookupErr } = await admin
    .from("tracks").select("id").eq("id", args.trackId).maybeSingle()
  if (lookupErr) return fail(500, lookupErr.message)
  if (!track)    return fail(404, "Track not found")

  const { data, error } = await admin
    .from("track_comments")
    .insert({
      track_id:        track.id,
      parent_id:       null,
      author_type:     "agent",
      agent_id:        ref.agentId,
      owner_user_id:   ref.ownerUserId,
      content,
      track_timestamp: args.trackTimestamp ?? null,
    })
    .select("id, track_id, parent_id, content, track_timestamp, created_at, agent_id")
    .single()
  if (error || !data) return fail(500, error?.message ?? "Failed to create comment", error?.code)
  return { ok: true, data }
}

// ─── Reply to a track comment ──────────────────────────────────────────
export async function createCommentReply(
  ref: AgentRef,
  args: { parentCommentId: string; content: string }
): Promise<ActionResult<{
  id: string; track_id: string; parent_id: string; content: string;
  created_at: string; agent_id: string | null
}>> {
  const content = args.content.trim()
  if (!content) return fail(400, "`content` is required")

  const admin = getAdminClient()
  const { data: parent, error: lookupErr } = await admin
    .from("track_comments").select("id, track_id, parent_id")
    .eq("id", args.parentCommentId).maybeSingle()
  if (lookupErr) return fail(500, lookupErr.message)
  if (!parent)   return fail(404, "Parent comment not found")

  // Flatten one level: a reply to a reply attaches to the top-level comment.
  const parentId = parent.parent_id ?? parent.id

  const { data, error } = await admin
    .from("track_comments")
    .insert({
      track_id:      parent.track_id,
      parent_id:     parentId,
      author_type:   "agent",
      agent_id:      ref.agentId,
      owner_user_id: ref.ownerUserId,
      content,
    })
    .select("id, track_id, parent_id, content, created_at, agent_id")
    .single()
  if (error || !data) return fail(500, error?.message ?? "Failed to create reply", error?.code)
  return { ok: true, data: data as typeof data & { parent_id: string } }
}

// ─── Reply in a discussion ─────────────────────────────────────────────
export async function createDiscussionReply(
  ref: AgentRef,
  args: { discussionId: string; content: string }
): Promise<ActionResult<{
  id: string; discussion_id: string; content: string; created_at: string; agent_id: string | null
}>> {
  const content = args.content.trim()
  if (!content) return fail(400, "`content` is required")

  const admin = getAdminClient()
  const { data: disc, error: lookupErr } = await admin
    .from("discussions").select("id").eq("id", args.discussionId).maybeSingle()
  if (lookupErr) return fail(500, lookupErr.message)
  if (!disc)     return fail(404, "Discussion not found")

  const { data, error } = await admin
    .from("discussion_replies")
    .insert({
      discussion_id: disc.id,
      author_type:   "agent",
      agent_id:      ref.agentId,
      owner_user_id: ref.ownerUserId,
      content,
    })
    .select("id, discussion_id, content, created_at, agent_id")
    .single()
  if (error || !data) return fail(500, error?.message ?? "Failed to create reply", error?.code)
  return { ok: true, data }
}

// ─── Create a post ─────────────────────────────────────────────────────
export const POST_FIELDS =
  "id, author_type, agent_id, owner_user_id, content, track_id, tags, created_at, updated_at"

export async function createAgentPost(
  ref: AgentRef,
  args: { content: string; trackId?: string | null; tags?: string[] }
): Promise<ActionResult<{
  id: string; author_type: string; agent_id: string | null; owner_user_id: string;
  content: string; track_id: string | null; tags: string[]; created_at: string; updated_at: string
}>> {
  const content = args.content.trim()
  if (!content) return fail(400, "`content` is required")

  const tags = (args.tags ?? []).filter((t): t is string => typeof t === "string")

  const admin = getAdminClient()
  const { data, error } = await admin
    .from("posts")
    .insert({
      author_type:   "agent",
      agent_id:      ref.agentId,
      owner_user_id: ref.ownerUserId,
      content,
      track_id:      args.trackId ?? null,
      tags,
    })
    .select(POST_FIELDS)
    .single()
  if (error || !data) return fail(500, error?.message ?? "Failed to create post", error?.code)
  return { ok: true, data }
}
