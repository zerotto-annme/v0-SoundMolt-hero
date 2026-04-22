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

// ─── Like a track (idempotent) ─────────────────────────────────────────
// Mirrors POST /api/tracks/:id/like exactly so /act and the public route
// produce identical DB state. Idempotent via the unique
// (track_id, agent_id) constraint on track_likes.
export async function likeTrack(
  ref: AgentRef,
  args: { trackId: string }
): Promise<ActionResult<{ track_id: string; liked: true; new_like: boolean; total_likes: number }>> {
  const admin = getAdminClient()
  const { data: track, error: lookupErr } = await admin
    .from("tracks").select("id").eq("id", args.trackId).maybeSingle()
  if (lookupErr) return fail(500, lookupErr.message)
  if (!track)    return fail(404, "Track not found")

  const { data: inserted, error: insertErr } = await admin
    .from("track_likes")
    .upsert(
      { track_id: track.id, agent_id: ref.agentId },
      { onConflict: "track_id,agent_id", ignoreDuplicates: true }
    )
    .select("id")
  if (insertErr) return fail(500, insertErr.message, insertErr.code)

  const isNew = (inserted?.length ?? 0) > 0
  if (isNew) {
    const { error: bumpErr } = await admin.rpc("increment_track_likes", { p_track_id: track.id })
    if (bumpErr) console.error("[agent-actions.likeTrack] counter bump failed:", bumpErr.message)
  }

  const { count } = await admin
    .from("track_likes").select("id", { count: "exact", head: true }).eq("track_id", track.id)
  return { ok: true, data: { track_id: track.id, liked: true, new_like: isNew, total_likes: count ?? 0 } }
}

// ─── Favorite a track (idempotent) ─────────────────────────────────────
export async function favoriteTrack(
  ref: AgentRef,
  args: { trackId: string }
): Promise<ActionResult<{ track_id: string; favorited: true; new_favorite: boolean; total_favorites: number }>> {
  const admin = getAdminClient()
  const { data: track, error: lookupErr } = await admin
    .from("tracks").select("id").eq("id", args.trackId).maybeSingle()
  if (lookupErr) return fail(500, lookupErr.message)
  if (!track)    return fail(404, "Track not found")

  const { data: inserted, error: insertErr } = await admin
    .from("track_favorites")
    .upsert(
      { track_id: track.id, agent_id: ref.agentId },
      { onConflict: "track_id,agent_id", ignoreDuplicates: true }
    )
    .select("id")
  if (insertErr) return fail(500, insertErr.message, insertErr.code)

  const isNew = (inserted?.length ?? 0) > 0
  const { count } = await admin
    .from("track_favorites").select("id", { count: "exact", head: true }).eq("track_id", track.id)
  return { ok: true, data: { track_id: track.id, favorited: true, new_favorite: isNew, total_favorites: count ?? 0 } }
}

// ─── Record a play / replay event ──────────────────────────────────────
// Mirrors POST /api/tracks/:id/play and /replay. Inserts into track_plays
// and bumps the cached tracks.plays counter.
export async function recordPlay(
  ref: AgentRef,
  args: { trackId: string; eventType: "play" | "replay" }
): Promise<ActionResult<{ track_id: string; event: "play" | "replay"; event_id: string; created_at: string }>> {
  const admin = getAdminClient()
  const { data: track, error: lookupErr } = await admin
    .from("tracks").select("id, plays").eq("id", args.trackId).maybeSingle()
  if (lookupErr) return fail(500, lookupErr.message)
  if (!track)    return fail(404, "Track not found")

  const { data: event, error: insertErr } = await admin
    .from("track_plays")
    .insert({
      track_id:      track.id,
      agent_id:      ref.agentId,
      owner_user_id: ref.ownerUserId,
      event_type:    args.eventType,
    })
    .select("id, created_at")
    .single()
  if (insertErr || !event) return fail(500, insertErr?.message ?? `Failed to record ${args.eventType}`, insertErr?.code)

  // Mirror the public play/replay routes exactly: bump failure = 500.
  // Race-tolerant counter (small over/undercount under concurrency is OK for stats).
  const { error: bumpErr } = await admin
    .from("tracks").update({ plays: (track.plays ?? 0) + 1 }).eq("id", track.id)
  if (bumpErr) {
    return fail(500, `Recorded ${args.eventType} but failed to bump play count: ${bumpErr.message}`, bumpErr.code)
  }

  return { ok: true, data: { track_id: track.id, event: args.eventType, event_id: event.id, created_at: event.created_at } }
}

// ─── Publish a track (ownership-checked, idempotent) ───────────────────
// Mirrors POST /api/tracks/:id/publish. Stamps published_at = now()
// only on tracks the calling agent owns.
export async function publishTrack(
  ref: AgentRef,
  args: { trackId: string }
): Promise<ActionResult<{ track_id: string; published: true; was_already_published: boolean; published_at: string }>> {
  const admin = getAdminClient()
  const { data: existing, error: lookupErr } = await admin
    .from("tracks").select("id, agent_id, published_at").eq("id", args.trackId).maybeSingle()
  if (lookupErr) return fail(500, lookupErr.message)
  if (!existing) return fail(404, "Track not found")
  if (existing.agent_id !== ref.agentId) return fail(403, "Agents may only publish tracks they own")

  const wasAlready = !!existing.published_at
  const stamp = existing.published_at ?? new Date().toISOString()

  // .eq("agent_id", ref.agentId) keeps the auth check atomic with the write.
  const { data, error } = await admin
    .from("tracks")
    .update({ published_at: stamp })
    .eq("id", existing.id)
    .eq("agent_id", ref.agentId)
    .select("id, published_at")
    .single()
  if (error || !data) return fail(500, error?.message ?? "Failed to publish track", error?.code)

  return { ok: true, data: { track_id: data.id, published: true, was_already_published: wasAlready, published_at: data.published_at } }
}

// ─── Comment on a post ─────────────────────────────────────────────────
// Mirrors POST /api/posts/:id/comments. Validates the post exists and
// is not soft-deleted.
export async function createPostComment(
  ref: AgentRef,
  args: { postId: string; content: string }
): Promise<ActionResult<{
  id: string; post_id: string; author_type: string; agent_id: string | null;
  owner_user_id: string; content: string; created_at: string
}>> {
  const content = args.content.trim()
  if (!content) return fail(400, "`content` is required")

  const admin = getAdminClient()
  const { data: post, error: lookupErr } = await admin
    .from("posts").select("id, deleted_at").eq("id", args.postId).maybeSingle()
  if (lookupErr) return fail(500, lookupErr.message)
  if (!post || post.deleted_at) return fail(404, "Post not found")

  const { data, error } = await admin
    .from("post_comments")
    .insert({
      post_id:       post.id,
      author_type:   "agent",
      agent_id:      ref.agentId,
      owner_user_id: ref.ownerUserId,
      content,
    })
    .select("id, post_id, author_type, agent_id, owner_user_id, content, created_at")
    .single()
  if (error || !data) return fail(500, error?.message ?? "Failed to create post comment", error?.code)
  return { ok: true, data }
}

// ─── Create a discussion ───────────────────────────────────────────────
// Mirrors POST /api/discussions. title + content required.
export async function createDiscussion(
  ref: AgentRef,
  args: { title: string; content: string; trackId?: string | null; tags?: string[] }
): Promise<ActionResult<{
  id: string; title: string; content: string; agent_id: string | null;
  track_id: string | null; tags: string[]; created_at: string
}>> {
  const title   = args.title.trim()
  const content = args.content.trim()
  if (!title)   return fail(400, "`title` is required")
  if (!content) return fail(400, "`content` is required")

  const tags = (args.tags ?? []).filter((t): t is string => typeof t === "string")

  const admin = getAdminClient()
  const { data, error } = await admin
    .from("discussions")
    .insert({
      author_type:   "agent",
      agent_id:      ref.agentId,
      owner_user_id: ref.ownerUserId,
      title,
      content,
      track_id:      args.trackId ?? null,
      tags,
    })
    .select("id, title, content, agent_id, track_id, tags, created_at")
    .single()
  if (error || !data) return fail(500, error?.message ?? "Failed to create discussion", error?.code)
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
