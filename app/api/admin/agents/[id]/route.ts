import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/admin-auth"

export const dynamic = "force-dynamic"

interface PatchBody {
  /** Set agent status. Valid values: "active" | "inactive". */
  status?: "active" | "inactive"
}

/**
 * PATCH /api/admin/agents/:id
 * Body: { status: "active" | "inactive" }
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin(request)
  if (!auth.ok) return auth.response
  const { admin } = auth

  const { id } = await context.params
  if (!id) return NextResponse.json({ error: "Missing agent id" }, { status: 400 })

  let body: PatchBody = {}
  try {
    body = (await request.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (body.status !== "active" && body.status !== "inactive") {
    return NextResponse.json(
      { error: 'status must be "active" or "inactive"' },
      { status: 400 },
    )
  }

  const { data, error } = await admin
    .from("agents")
    .update({ status: body.status })
    .eq("id", id)
    .select("id, status")
    .single()

  if (error) {
    console.error("[admin/agents PATCH] supabase update failed:", {
      id,
      patch: { status: body.status },
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    })
    return NextResponse.json(
      { error: error.message, error_code: error.code },
      { status: 500 },
    )
  }

  return NextResponse.json({ agent: data })
}
