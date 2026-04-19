import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

// Number of days a NULL-username profile must be stale before it is
// considered orphaned and eligible for removal.
const DEFAULT_OLDER_THAN_DAYS = 7

/**
 * POST /api/admin/cleanup-orphaned-accounts
 *
 * Finds and permanently removes auth users whose profile username has been
 * NULL for longer than `olderThanDays` days.  These accounts are created when
 * two users race for the same username and one confirms their email first; the
 * loser ends up with a NULL username and is immediately signed out on every
 * subsequent login attempt, making the account unrecoverable without cleanup.
 *
 * Authentication:
 *   The request MUST include the Supabase service-role key as a Bearer token:
 *     Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 *
 * Body (JSON, optional):
 *   { "olderThanDays": number }   — defaults to 7
 *
 * Headers (optional):
 *   X-Triggered-By: <label>   — stored in the audit log (defaults to "admin-api")
 *
 * Response:
 *   { "deleted": number, "errors": Array<{ id: string, error: string }> }
 *
 * Every successful run writes a row to public.cleanup_audit_log so that
 * historical cleanup activity can be reviewed over time.
 */
export async function POST(request: NextRequest) {
  if (!supabaseServiceKey) {
    console.error("[cleanup-orphaned-accounts] SUPABASE_SERVICE_ROLE_KEY is not set")
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 })
  }

  // Authenticate the caller using the service-role key as a shared secret.
  // This endpoint must only be invoked from trusted server-side infrastructure
  // (e.g. a Supabase Edge Function, CI script, or internal cron job) — never
  // from client-side code or exposed in browser logs.
  const authHeader = request.headers.get("authorization") ?? ""
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : ""
  if (token !== supabaseServiceKey) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Optional label stored in the audit log so callers can identify themselves.
  // Sanitised to printable ASCII and capped at 100 chars to keep audit rows
  // predictable regardless of what a caller sends.
  const rawTriggeredBy = request.headers.get("x-triggered-by") ?? "admin-api"
  const triggeredBy = rawTriggeredBy.replace(/[^\x20-\x7E]/g, "").slice(0, 100) || "admin-api"

  let olderThanDays = DEFAULT_OLDER_THAN_DAYS
  try {
    const body = await request.json().catch(() => ({}))
    if (typeof body?.olderThanDays === "number" && body.olderThanDays > 0) {
      olderThanDays = Math.floor(body.olderThanDays)
    }
  } catch {
    // Ignore body parse errors; proceed with the default.
  }

  const admin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  })

  // Identify orphaned profiles using the helper RPC created in migration 013.
  const { data: orphans, error: fetchError } = await admin.rpc(
    "get_orphaned_user_ids",
    { older_than_days: olderThanDays },
  )

  if (fetchError) {
    console.error("[cleanup-orphaned-accounts] Failed to fetch orphaned user IDs:", fetchError)
    return NextResponse.json({ error: "Failed to query orphaned accounts" }, { status: 500 })
  }

  const rows = (orphans ?? []) as Array<{ user_id: string; profile_created_at: string }>

  let deleted = 0
  const errors: Array<{ id: string; error: string }> = []

  for (const { user_id } of rows) {
    const { error: deleteError } = await admin.auth.admin.deleteUser(user_id)
    if (deleteError) {
      console.error(`[cleanup-orphaned-accounts] Failed to delete user ${user_id}:`, deleteError)
      errors.push({ id: user_id, error: deleteError.message })
    } else {
      deleted++
    }
  }

  console.log(
    `[cleanup-orphaned-accounts] Cleanup complete: deleted=${deleted}, errors=${errors.length}, olderThanDays=${olderThanDays}`,
  )

  if (errors.length > 0) {
    console.warn(
      `[cleanup-orphaned-accounts] ${errors.length} deletion(s) failed — these accounts were not removed and will be retried on the next run. IDs:`,
      errors.map((e) => e.id),
    )
  }

  // Persist an audit record for this run so historical cleanup activity can
  // be reviewed.  Runs are logged even when deleted=0 so you can tell the
  // difference between "nothing to clean up" and "the job never ran".
  // A failure here is non-fatal — we still return the run results to the caller.
  const { error: auditError } = await admin
    .from("cleanup_audit_log")
    .insert({
      accounts_deleted: deleted,
      error_count: errors.length,
      triggered_by: triggeredBy,
    })

  if (auditError) {
    console.error(
      "[cleanup-orphaned-accounts] Failed to write audit log row:",
      auditError,
    )
  }

  return NextResponse.json({ deleted, errors })
}
