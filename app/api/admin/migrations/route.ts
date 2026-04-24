import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { readdirSync } from "fs"
import { join } from "path"
import { getServiceRoleKey } from "@/lib/supabase-admin"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
// Resolved via the central helper so the SUPABASE_SERVICE_KEY /
// SUPABASE_SERVICE_ROLE legacy aliases also work.
const supabaseServiceKey = getServiceRoleKey()

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean)

export interface MigrationStatus {
  filename: string
  applied: boolean
  applied_at: string | null
}

/**
 * GET /api/admin/migrations
 *
 * Compares .sql files in the migrations/ directory against rows in
 * public.schema_migrations and returns the status of each migration.
 *
 * Authentication:
 *   The request MUST include a valid Supabase user JWT as a Bearer token:
 *     Authorization: Bearer <supabase-access-token>
 *   The authenticated user's email must appear in the ADMIN_EMAILS
 *   environment variable (comma-separated list).
 *
 * Response:
 *   {
 *     "migrations": Array<{ filename, applied, applied_at }>,
 *     "total": number,
 *     "applied": number,
 *     "missing": number
 *   }
 */
export async function GET(request: NextRequest) {
  if (!supabaseServiceKey) {
    console.error("[admin/migrations] SUPABASE_SERVICE_ROLE_KEY is not set")
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 })
  }

  if (ADMIN_EMAILS.length === 0) {
    console.error("[admin/migrations] ADMIN_EMAILS env var is not configured")
    return NextResponse.json({ error: "Admin access not configured" }, { status: 503 })
  }

  const authHeader = request.headers.get("authorization") ?? ""
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : ""
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

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

  // Read .sql files from the migrations directory
  let sqlFiles: string[] = []
  try {
    const migrationsDir = join(process.cwd(), "migrations")
    sqlFiles = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
  } catch (err) {
    console.error("[admin/migrations] Failed to read migrations directory:", err)
    return NextResponse.json({ error: "Failed to read migrations directory" }, { status: 500 })
  }

  // Fetch applied migrations from the database
  const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  })

  const { data: appliedRows, error: fetchError } = await adminClient
    .from("schema_migrations")
    .select("filename, applied_at")

  if (fetchError) {
    console.error("[admin/migrations] Failed to query schema_migrations:", fetchError)
    return NextResponse.json({ error: "Failed to query migration status" }, { status: 500 })
  }

  const appliedMap = new Map<string, string>()
  for (const row of appliedRows ?? []) {
    appliedMap.set(row.filename, row.applied_at)
  }

  const migrations: MigrationStatus[] = sqlFiles.map((filename) => ({
    filename,
    applied: appliedMap.has(filename),
    applied_at: appliedMap.get(filename) ?? null,
  }))

  const appliedCount = migrations.filter((m) => m.applied).length
  const missingCount = migrations.length - appliedCount

  return NextResponse.json({
    migrations,
    total: migrations.length,
    applied: appliedCount,
    missing: missingCount,
  })
}
