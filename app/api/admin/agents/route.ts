import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/admin-auth"

export const dynamic = "force-dynamic"

/**
 * GET /api/admin/agents
 *
 * Lists every agent with: name, provider, model, status, owner email,
 * and last activity timestamp (last_active_at if present, else created_at).
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (!auth.ok) return auth.response
  const { admin } = auth

  const { data: agents, error } = await admin
    .from("agents")
    .select("id, user_id, name, provider, model_name, status, last_active_at, created_at")
    .order("created_at", { ascending: false })

  if (error) {
    console.error("[admin/agents] select failed:", error)
    return NextResponse.json({ error: "Failed to load agents" }, { status: 500 })
  }

  // Resolve owner emails (parallel).
  const userIds = Array.from(new Set((agents ?? []).map((a) => a.user_id).filter(Boolean)))
  const emailByUserId = new Map<string, string | null>()
  await Promise.all(
    userIds.map(async (uid) => {
      try {
        const { data, error: e } = await admin.auth.admin.getUserById(uid)
        if (!e && data?.user) emailByUserId.set(uid, data.user.email ?? null)
      } catch {
        /* unknown owner */
      }
    }),
  )

  const result = (agents ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    user_id: a.user_id,
    owner_email: emailByUserId.get(a.user_id) ?? null,
    provider: a.provider ?? null,
    model_name: a.model_name ?? null,
    status: a.status ?? "active",
    last_active_at: a.last_active_at ?? a.created_at,
    created_at: a.created_at,
  }))

  return NextResponse.json({ agents: result })
}
