/**
 * Supabase Edge Function: cleanup-orphaned-accounts
 *
 * Finds and permanently removes auth users whose profile username has been
 * NULL for longer than `olderThanDays` days (default: 7).  These accounts are
 * created when two users race for the same username and the loser ends up with
 * a NULL username, making the account unrecoverable without this cleanup.
 *
 * This function is designed to be invoked on a schedule via pg_cron
 * (see migrations/017_schedule_orphaned_account_cleanup.sql) but can also be
 * called manually from the Supabase dashboard or CLI.
 *
 * Authentication:
 *   Requests MUST include the Supabase service-role key as a Bearer token:
 *     Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 *
 * Body (JSON, optional):
 *   { "olderThanDays": number }   — defaults to 7
 *
 * Response:
 *   { "deleted": number, "errors": Array<{ id: string, error: string }> }
 *
 * Scheduling:
 *   This function is called daily at 00:00 UTC by the pg_cron job installed in
 *   migrations/017_schedule_orphaned_account_cleanup.sql.
 *   Cron expression: 0 0 * * *
 *
 * Relationship to the Next.js API route:
 *   This function intentionally mirrors app/api/admin/cleanup-orphaned-accounts/route.ts
 *   so that it can run as a self-contained Supabase Edge Function without depending on
 *   the Next.js app being available.  If you update the deletion logic, thresholds, or
 *   error handling in one file you MUST apply the same change to the other.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const DEFAULT_OLDER_THAN_DAYS = 7

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    })
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error("[cleanup-orphaned-accounts] Missing required environment variables")
    return new Response(JSON.stringify({ error: "Server misconfiguration" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }

  // Authenticate the caller using the service-role key as a shared secret.
  // This ensures only trusted server-side infrastructure (e.g. the pg_cron
  // job) can trigger account deletions.
  const authHeader = req.headers.get("authorization") ?? ""
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : ""
  if (token !== supabaseServiceKey) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    })
  }

  let olderThanDays = DEFAULT_OLDER_THAN_DAYS
  try {
    const body = await req.json().catch(() => ({}))
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
    console.error(
      "[cleanup-orphaned-accounts] Failed to fetch orphaned user IDs:",
      fetchError,
    )
    return new Response(
      JSON.stringify({ error: "Failed to query orphaned accounts" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    )
  }

  const rows = (orphans ?? []) as Array<{ user_id: string; profile_created_at: string }>

  if (rows.length === 0) {
    console.log(
      `[cleanup-orphaned-accounts] No orphaned accounts found (olderThanDays=${olderThanDays})`,
    )
    return new Response(JSON.stringify({ deleted: 0, errors: [] }), {
      headers: { "Content-Type": "application/json" },
    })
  }

  let deleted = 0
  const errors: Array<{ id: string; error: string }> = []

  for (const { user_id } of rows) {
    const { error: deleteError } = await admin.auth.admin.deleteUser(user_id)
    if (deleteError) {
      console.error(
        `[cleanup-orphaned-accounts] Failed to delete user ${user_id}:`,
        deleteError,
      )
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

  return new Response(JSON.stringify({ deleted, errors }), {
    headers: { "Content-Type": "application/json" },
  })
})
