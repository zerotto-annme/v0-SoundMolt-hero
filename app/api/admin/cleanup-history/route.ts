import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { getServiceRoleKey } from "@/lib/supabase-admin"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
// Resolved via the central helper so the SUPABASE_SERVICE_KEY /
// SUPABASE_SERVICE_ROLE legacy aliases also work.
const supabaseServiceKey = getServiceRoleKey()

// Comma-separated list of email addresses that are allowed to view the admin
// cleanup history.  Example: ADMIN_EMAILS=alice@example.com,bob@example.com
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean)

/**
 * GET /api/admin/cleanup-history
 *
 * Returns all rows from public.cleanup_audit_log ordered by ran_at DESC.
 *
 * Authentication:
 *   The request MUST include a valid Supabase user JWT as a Bearer token:
 *     Authorization: Bearer <supabase-access-token>
 *   The authenticated user's email must appear in the ADMIN_EMAILS
 *   environment variable (comma-separated list).
 *
 * Response:
 *   { "runs": Array<{ id, ran_at, accounts_deleted, error_count, triggered_by }> }
 */
export async function GET(request: NextRequest) {
  if (!supabaseServiceKey) {
    console.error("[cleanup-history] SUPABASE_SERVICE_ROLE_KEY is not set")
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 })
  }

  if (ADMIN_EMAILS.length === 0) {
    console.error("[cleanup-history] ADMIN_EMAILS env var is not configured")
    return NextResponse.json({ error: "Admin access not configured" }, { status: 503 })
  }

  // Verify the caller is an authenticated Supabase user.
  const authHeader = request.headers.get("authorization") ?? ""
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : ""
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Use the anon client + user JWT to resolve the caller's identity.
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

  const { data: { user }, error: userError } = await userClient.auth.getUser()
  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const email = (user.email ?? "").toLowerCase()
  if (!ADMIN_EMAILS.includes(email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // Fetch the audit log using the service-role client (bypasses RLS).
  const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  })

  const { data: runs, error: fetchError } = await adminClient
    .from("cleanup_audit_log")
    .select("id, ran_at, accounts_deleted, error_count, triggered_by")
    .order("ran_at", { ascending: false })

  if (fetchError) {
    console.error("[cleanup-history] Failed to fetch cleanup_audit_log:", fetchError)
    return NextResponse.json({ error: "Failed to fetch history" }, { status: 500 })
  }

  return NextResponse.json({ runs: runs ?? [] })
}
