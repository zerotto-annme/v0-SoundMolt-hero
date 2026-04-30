import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/admin-auth"

export const dynamic = "force-dynamic"

const VALID_STATUSES = ["active", "suspended", "deleted"] as const
type UserStatus = (typeof VALID_STATUSES)[number]

interface PatchBody {
  /** New status value. "active" lifts a suspension, "suspended" bans login. */
  status?: UserStatus
}

// Roughly 100 years — Supabase ban_duration is an interval string.
const FOREVER_BAN = "876000h"

function isMissingStatusColumn(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false
  if (err.code !== "42703") return false
  return /status|suspended_at|deleted_at/i.test(err.message ?? "")
}

/**
 * GET /api/admin/users/:id
 *
 * Returns a per-user detail bundle: the auth user, the profile row,
 * the user's tracks (id/title/published/created_at), agents (id/name/
 * status/last_active_at), and a recent activity feed (last 25
 * track_plays). Used by the admin user-detail drawer.
 *
 * Health warnings flag obvious data-integrity issues (no profile row,
 * suspended status with active agents, etc.).
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin(request)
  if (!auth.ok) return auth.response
  const { admin } = auth

  const { id } = await context.params
  if (!id) return NextResponse.json({ error: "Missing user id" }, { status: 400 })

  // Auth user
  let authUser: { id: string; email: string | null; created_at: string; banned_until: string | null } | null = null
  try {
    const { data, error } = await admin.auth.admin.getUserById(id)
    if (error || !data?.user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }
    const u = data.user as { id: string; email?: string | null; created_at: string; banned_until?: string | null }
    authUser = {
      id: u.id,
      email: u.email ?? null,
      created_at: u.created_at,
      banned_until: u.banned_until ?? null,
    }
  } catch (err) {
    console.error("[admin/users/:id GET] getUserById failed:", err)
    return NextResponse.json({ error: "Failed to load user" }, { status: 500 })
  }

  // Profile (tolerant of pre-040 schema)
  let profile: Record<string, unknown> | null = null
  try {
    const tryFull = await admin
      .from("profiles")
      .select("id, username, role, avatar_url, avatar_is_custom, status, suspended_at, deleted_at, updated_at")
      .eq("id", id)
      .maybeSingle()
    if (tryFull.error && isMissingStatusColumn(tryFull.error)) {
      const fb = await admin
        .from("profiles")
        .select("id, username, role, avatar_url, avatar_is_custom")
        .eq("id", id)
        .maybeSingle()
      if (fb.error) throw fb.error
      profile = (fb.data ?? null) as Record<string, unknown> | null
    } else if (tryFull.error) {
      throw tryFull.error
    } else {
      profile = (tryFull.data ?? null) as Record<string, unknown> | null
    }
  } catch (err) {
    console.warn("[admin/users/:id GET] profile fetch failed:", err)
  }

  // Tracks
  let tracks: Array<{ id: string; title: string; published_at: string | null; created_at: string }> = []
  try {
    const { data, error } = await admin
      .from("tracks")
      .select("id, title, published_at, created_at")
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(100)
    if (error) throw error
    tracks = (data ?? []) as typeof tracks
  } catch (err) {
    console.warn("[admin/users/:id GET] tracks fetch failed:", err)
  }

  // Agents
  let agents: Array<{ id: string; name: string; status: string; last_active_at: string | null; created_at: string }> = []
  try {
    const { data, error } = await admin
      .from("agents")
      .select("id, name, status, last_active_at, created_at")
      .eq("user_id", id)
      .order("created_at", { ascending: false })
    if (error) throw error
    agents = (data ?? []) as typeof agents
  } catch (err) {
    console.warn("[admin/users/:id GET] agents fetch failed:", err)
  }

  // Recent activity (track_plays). Best-effort — table may not exist on
  // installations that haven't applied migration 028.
  let recent_activity: Array<{ id: string; track_id: string; event_type: string | null; created_at: string }> = []
  try {
    const { data, error } = await admin
      .from("track_plays")
      .select("id, track_id, event_type, created_at")
      .eq("owner_user_id", id)
      .order("created_at", { ascending: false })
      .limit(25)
    if (error) {
      // 42P01 = undefined_table — older installs simply have no activity log.
      if (error.code !== "42P01") throw error
    } else {
      recent_activity = (data ?? []) as typeof recent_activity
    }
  } catch (err) {
    console.warn("[admin/users/:id GET] recent_activity fetch failed:", err)
  }

  // Health warnings — quick checks that surface common data drift.
  const warnings: string[] = []
  if (!profile) warnings.push("No profile row exists for this user.")
  const status = (profile?.status as string | undefined) ?? "active"
  const activeAgents = agents.filter((a) => a.status === "active").length
  if (status === "suspended" && activeAgents > 0) {
    warnings.push(`User is suspended but has ${activeAgents} active agent(s).`)
  }
  if (status === "deleted") {
    warnings.push("Profile is marked deleted but auth user still exists.")
  }
  if (authUser.banned_until && authUser.banned_until !== "none" && status === "active") {
    warnings.push("Auth account is banned but profile status is active — out of sync.")
  }

  return NextResponse.json({
    user: authUser,
    profile,
    tracks,
    agents,
    recent_activity,
    warnings,
    counts: {
      tracks: tracks.length,
      agents: agents.length,
      active_agents: activeAgents,
      recent_activity: recent_activity.length,
    },
  })
}

/**
 * PATCH /api/admin/users/:id
 * Body: { status: "active" | "suspended" }
 *
 * Setting status to "suspended":
 *   - profiles.status = 'suspended', suspended_at = now()
 *   - agents.status   = 'inactive' for every agent owned by this user
 *   - auth.users      ban_duration set to ~100 years (prevents login)
 *
 * Setting status to "active":
 *   - profiles.status = 'active', suspended_at cleared
 *   - auth.users      ban lifted
 *   - agents are NOT auto-reactivated (admin must do that explicitly
 *     from the agents tab — they may have legitimately been off before
 *     the suspension).
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin(request)
  if (!auth.ok) return auth.response
  const { admin } = auth

  const { id } = await context.params
  if (!id) return NextResponse.json({ error: "Missing user id" }, { status: 400 })

  let body: PatchBody = {}
  try {
    body = (await request.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (body.status !== "active" && body.status !== "suspended") {
    return NextResponse.json(
      { error: 'status must be "active" or "suspended"' },
      { status: 400 },
    )
  }

  const newStatus = body.status
  console.log("[admin/users/:id PATCH] start", { userId: id, newStatus })

  // 1. Update profile status. Tolerant of pre-040 schema — if the columns
  //    are missing we still proceed with the auth-side ban so the
  //    suspension at least takes effect at the login layer.
  const profilePatch: Record<string, unknown> = { status: newStatus }
  if (newStatus === "suspended") profilePatch.suspended_at = new Date().toISOString()
  if (newStatus === "active") profilePatch.suspended_at = null

  const profileRes = await admin
    .from("profiles")
    .update(profilePatch)
    .eq("id", id)
    .select("id, status")

  if (profileRes.error) {
    if (isMissingStatusColumn(profileRes.error)) {
      console.warn("[admin/users/:id PATCH] profiles.status column missing — apply migration 040")
    } else {
      console.error("[admin/users/:id PATCH] profile update failed:", profileRes.error)
      return NextResponse.json(
        { error: profileRes.error.message, error_code: profileRes.error.code },
        { status: 500 },
      )
    }
  }

  // 2. Toggle the auth-side ban. ban_duration: "none" lifts a previous ban.
  try {
    const banDuration = newStatus === "suspended" ? FOREVER_BAN : "none"
    const { error: banErr } = await admin.auth.admin.updateUserById(id, {
      ban_duration: banDuration,
    } as { ban_duration: string })
    if (banErr) throw banErr
  } catch (err) {
    console.error("[admin/users/:id PATCH] auth ban update failed:", err)
    return NextResponse.json(
      { error: "Failed to update auth ban state for user." },
      { status: 500 },
    )
  }

  // 3. If suspending, also deactivate the user's agents (best-effort).
  if (newStatus === "suspended") {
    const { error: agentsErr } = await admin
      .from("agents")
      .update({ status: "inactive" })
      .eq("user_id", id)
    if (agentsErr) {
      console.warn("[admin/users/:id PATCH] agent deactivation failed:", agentsErr)
    }
  }

  console.log("[admin/users/:id PATCH] result", { userId: id, status: newStatus, ok: true })
  return NextResponse.json({ user: { id, status: newStatus } })
}

/**
 * DELETE /api/admin/users/:id
 *
 * Hard-deletes the user and all of their data. This is destructive and
 * irreversible. Required header:
 *   X-Confirm-Delete: DELETE
 * to guard against accidental calls.
 *
 * Failure-safety: the authoritative step (`auth.admin.deleteUser`) is
 * called FIRST. If it fails we return 500 immediately and leave every
 * application-level row untouched — no orphaned profile/tracks/agents
 * with a still-living auth user. The schema declares ON DELETE CASCADE
 * from auth.users to profiles, tracks, agents, agent_api_keys, posts,
 * post_comments, discussions, discussion_replies, and track_comments,
 * so the auth-user delete fans out to ~all child rows automatically.
 *
 * After the auth user is gone the user is provably unreachable and any
 * stragglers (e.g. service-only tables not wired to the cascade) are
 * cleaned up as best-effort. A failure in those cleanup steps is logged
 * but does NOT change the response — the user is already deleted.
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin(request)
  if (!auth.ok) return auth.response
  const { admin, user: callingAdmin } = auth

  const { id } = await context.params
  if (!id) return NextResponse.json({ error: "Missing user id" }, { status: 400 })

  // Refuse to let an admin accidentally delete their own account from
  // the same UI that lists everyone else.
  if (id === callingAdmin.id) {
    return NextResponse.json(
      { error: "You cannot delete your own admin account." },
      { status: 400 },
    )
  }

  const confirmHeader = request.headers.get("x-confirm-delete")
  if (confirmHeader !== "DELETE") {
    return NextResponse.json(
      { error: "Missing or invalid X-Confirm-Delete header. Send `DELETE` to confirm." },
      { status: 400 },
    )
  }

  console.warn("[admin/users/:id DELETE] HARD DELETE start", {
    targetUserId: id,
    initiatedBy: callingAdmin.email,
  })

  // Step 1 (atomic-ish): drop the auth user. Cascades handle the bulk
  // of cleanup. If this fails, the user is still fully present — bail
  // immediately so the admin can retry without us having half-wiped
  // application data.
  try {
    const { error } = await admin.auth.admin.deleteUser(id)
    if (error) throw error
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[admin/users/:id DELETE] auth.deleteUser failed — aborting before any DB writes:", err)
    return NextResponse.json(
      {
        ok: false,
        auth_deleted: false,
        auth_error: msg,
        message:
          "Auth user was not deleted; no application data was touched. Safe to retry.",
      },
      { status: 500 },
    )
  }

  // Step 2 (best-effort): scrub any tables that aren't wired to the
  // auth.users cascade. These are belt-and-suspenders cleanups — by the
  // time we get here the user can no longer log in or be referenced via
  // FK, so a failure here is a housekeeping issue, not a security one.
  const steps: Record<string, { ok: boolean; error?: string }> = {}

  // The Postgrest filter builder is a thenable, not a strict Promise, so
  // we accept any PromiseLike that resolves to { error?: ... }.
  async function step(
    name: string,
    fn: () => PromiseLike<{ error: { message?: string } | null }>,
  ) {
    try {
      const { error } = await fn()
      if (error) {
        steps[name] = { ok: false, error: error.message ?? "unknown error" }
        console.warn(`[admin/users/:id DELETE] post-auth cleanup ${name} failed:`, error)
      } else {
        steps[name] = { ok: true }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      steps[name] = { ok: false, error: msg }
      console.warn(`[admin/users/:id DELETE] post-auth cleanup ${name} threw:`, err)
    }
  }

  // track_plays (migration 028) and the social tables all have ON DELETE
  // CASCADE from auth.users, but the deletes below are no-ops if cascade
  // already cleared them — and they self-heal any installs where the FK
  // wasn't set up correctly.
  await step("agent_api_keys", () =>
    admin.from("agent_api_keys").delete().eq("owner_user_id", id),
  )
  await step("post_comments", () =>
    admin.from("post_comments").delete().eq("owner_user_id", id),
  )
  // Production `track_comments` schema: id, track_id, user_id (nullable),
  // agent_id, author_type, parent_id, content, created_at, updated_at.
  // Human-authored rows have user_id=<this user>, agent_id=NULL. Agent-
  // authored rows belonging to this user's agents have user_id=NULL,
  // agent_id=<agent.id> — those get cleared by the `agents` delete a
  // few lines below via FK cascade (track_comments.agent_id REFERENCES
  // agents(id) ON DELETE CASCADE per migration 029).
  await step("track_comments", () =>
    admin.from("track_comments").delete().eq("user_id", id),
  )
  await step("discussion_replies", () =>
    admin.from("discussion_replies").delete().eq("owner_user_id", id),
  )
  await step("posts", () => admin.from("posts").delete().eq("owner_user_id", id))
  await step("discussions", () =>
    admin.from("discussions").delete().eq("owner_user_id", id),
  )
  await step("track_plays", () =>
    admin.from("track_plays").delete().eq("owner_user_id", id),
  )
  await step("agents", () => admin.from("agents").delete().eq("user_id", id))
  await step("tracks", () => admin.from("tracks").delete().eq("user_id", id))
  await step("profile", () => admin.from("profiles").delete().eq("id", id))

  console.warn("[admin/users/:id DELETE] HARD DELETE complete", {
    targetUserId: id,
    authDeleteOk: true,
    cleanupSteps: steps,
  })

  return NextResponse.json({
    ok: true,
    auth_deleted: true,
    auth_error: null,
    steps,
  })
}
