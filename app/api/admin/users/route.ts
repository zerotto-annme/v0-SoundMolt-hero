import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/admin-auth"

export const dynamic = "force-dynamic"

/**
 * GET /api/admin/users
 *
 * Lists every Supabase Auth user with: email, created_at, id, and the
 * count of tracks they own. Walks the auth.admin.listUsers paginator
 * (capped at ~10k for MVP) and joins against a single tracks aggregate.
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

  // Track count per user — single fetch + group in memory (cheap for MVP).
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

  // Newest accounts first.
  users.sort((a, b) => (b.created_at < a.created_at ? -1 : 1))

  return NextResponse.json({
    users: users.map((u) => ({
      ...u,
      track_count: tracksByUser.get(u.id) ?? 0,
    })),
    total: users.length,
  })
}
