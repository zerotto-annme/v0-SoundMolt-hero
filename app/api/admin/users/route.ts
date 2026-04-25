import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/admin-auth"

export const dynamic = "force-dynamic"

interface ProfileRow {
  id: string
  username: string | null
  role: string | null
  status?: string | null
  suspended_at?: string | null
  deleted_at?: string | null
}

/**
 * GET /api/admin/users
 *
 * Lists every Supabase Auth user with: email, created_at, id, username,
 * role, status, track_count, agent_count. Walks the auth.admin.listUsers
 * paginator (capped at ~10k for MVP) and joins against single
 * profiles / tracks / agents aggregates.
 *
 * Tolerates the absence of profiles.status (migration 040 not yet
 * applied) — falls back to a smaller SELECT and assumes status='active'.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (!auth.ok) return auth.response
  const { admin } = auth

  const users: Array<{
    id: string
    email: string | null
    created_at: string
  }> = []

  try {
    const PAGE = 1000
    for (let page = 1; page <= 10; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PAGE })
      if (error) throw error
      const batch = data?.users ?? []
      for (const u of batch) {
        users.push({ id: u.id, email: u.email ?? null, created_at: u.created_at })
      }
      if (batch.length < PAGE) break
    }
  } catch (err) {
    console.error("[admin/users] listUsers failed:", err)
    return NextResponse.json({ error: "Failed to list users" }, { status: 500 })
  }

  // Profiles join — username, role, status. Tolerant of pre-040 schemas.
  const profilesById = new Map<string, ProfileRow>()
  try {
    const tryFull = await admin
      .from("profiles")
      .select("id, username, role, status, suspended_at, deleted_at")
    let rows = tryFull.data as ProfileRow[] | null
    if (tryFull.error) {
      const isMissingStatus =
        tryFull.error.code === "42703" && /status|suspended_at|deleted_at/i.test(tryFull.error.message ?? "")
      if (!isMissingStatus) throw tryFull.error
      const fallback = await admin.from("profiles").select("id, username, role")
      if (fallback.error) throw fallback.error
      rows = fallback.data as ProfileRow[] | null
    }
    for (const r of rows ?? []) profilesById.set(r.id, r)
  } catch (err) {
    console.error("[admin/users] profiles aggregation failed:", err)
  }

  // Track count per user.
  const tracksByUser = new Map<string, number>()
  try {
    const { data: tracks, error } = await admin.from("tracks").select("user_id")
    if (error) throw error
    for (const row of tracks ?? []) {
      tracksByUser.set(row.user_id, (tracksByUser.get(row.user_id) ?? 0) + 1)
    }
  } catch (err) {
    console.error("[admin/users] track aggregation failed:", err)
  }

  // Agent count per user.
  const agentsByUser = new Map<string, number>()
  try {
    const { data: agents, error } = await admin.from("agents").select("user_id")
    if (error) throw error
    for (const row of agents ?? []) {
      agentsByUser.set(row.user_id, (agentsByUser.get(row.user_id) ?? 0) + 1)
    }
  } catch (err) {
    console.error("[admin/users] agent aggregation failed:", err)
  }

  // Newest accounts first.
  users.sort((a, b) => (b.created_at < a.created_at ? -1 : 1))

  return NextResponse.json({
    users: users.map((u) => {
      const p = profilesById.get(u.id)
      return {
        ...u,
        username: p?.username ?? null,
        role: p?.role ?? null,
        status: p?.status ?? "active",
        suspended_at: p?.suspended_at ?? null,
        deleted_at: p?.deleted_at ?? null,
        track_count: tracksByUser.get(u.id) ?? 0,
        agent_count: agentsByUser.get(u.id) ?? 0,
      }
    }),
    total: users.length,
  })
}
