import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

/**
 * GET /api/admin/cleanup-orphaned-accounts/history
 *
 * Returns recent rows from the cleanup_audit_log table so monitoring tools,
 * dashboards, or cron reporters can fetch the cleanup history without direct
 * database access.
 *
 * Authentication:
 *   The request MUST include the Supabase service-role key as a Bearer token:
 *     Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 *
 * Query params (optional):
 *   limit — number of rows to return (default 50, min 1, max 500)
 *
 * Response:
 *   { "history": Array<{ id, ran_at, accounts_deleted, error_count, triggered_by }> }
 */
export async function GET(request: NextRequest) {
  if (!supabaseServiceKey) {
    console.error("[cleanup-orphaned-accounts/history] SUPABASE_SERVICE_ROLE_KEY is not set")
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 })
  }

  const authHeader = request.headers.get("authorization") ?? ""
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : ""
  if (token !== supabaseServiceKey) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const rawLimit = parseInt(searchParams.get("limit") ?? "50", 10)
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 500) : 50

  const admin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  })

  const { data, error } = await admin
    .from("cleanup_audit_log")
    .select("id, ran_at, accounts_deleted, error_count, triggered_by")
    .order("ran_at", { ascending: false })
    .limit(limit)

  if (error) {
    console.error("[cleanup-orphaned-accounts/history] Failed to query audit log:", error)
    return NextResponse.json({ error: "Failed to query cleanup history" }, { status: 500 })
  }

  return NextResponse.json({ history: data ?? [] })
}
