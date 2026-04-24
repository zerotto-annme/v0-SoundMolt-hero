import { NextResponse } from "next/server"
import { getAdminClient, getUserFromAuthHeader } from "./supabase-admin"
import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Default admin email used when the ADMIN_EMAILS env var is not configured.
 * Per the v1 spec we have a single hardcoded admin until a proper role
 * system lands. ADMIN_EMAILS (comma-separated) overrides this and adds more.
 */
const DEFAULT_ADMIN_EMAIL = "andrewkarme@gmail.com"

function getAdminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS ?? ""
  const fromEnv = raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  if (fromEnv.length > 0) return fromEnv
  return [DEFAULT_ADMIN_EMAIL.toLowerCase()]
}

/**
 * Pure predicate — checks whether the given email belongs to the admin
 * allow-list. Useful for routes that already validated the JWT through
 * another path (e.g. owner-or-admin endpoints) and just need a lightweight
 * "is this an admin?" check without re-running requireAdmin().
 */
export function isAdminEmail(email: string | null | undefined): boolean {
  const e = (email ?? "").toLowerCase()
  if (!e) return false
  return getAdminEmails().includes(e)
}

export interface AdminAuthOk {
  ok: true
  admin: SupabaseClient
  user: { id: string; email: string }
}
export interface AdminAuthFail {
  ok: false
  response: NextResponse
}

/**
 * Server-side admin gate for /api/admin/* routes.
 *
 *   1. Reads the Bearer token from the Authorization header.
 *   2. Validates it via Supabase Auth (anon-key path, never the service key).
 *   3. Confirms the authenticated user's email is in the admin list.
 *   4. On success returns a service-role SupabaseClient ready for queries.
 *
 * The service role key NEVER leaves the server — clients only ever see the
 * anon key (NEXT_PUBLIC_SUPABASE_ANON_KEY) and their own JWT.
 */
export async function requireAdmin(
  request: Request,
): Promise<AdminAuthOk | AdminAuthFail> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Server misconfiguration: service role key missing" },
        { status: 500 },
      ),
    }
  }

  const user = await getUserFromAuthHeader(request)
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    }
  }

  const email = (user.email ?? "").toLowerCase()
  const allowed = getAdminEmails()
  if (!email || !allowed.includes(email)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    }
  }

  return {
    ok: true,
    admin: getAdminClient(),
    user: { id: user.id, email },
  }
}

// Client-side gating lives in the /admin page and consults
// GET /api/admin/me, which calls requireAdmin() above. This guarantees
// the UI gate always agrees with the API gate (including ADMIN_EMAILS
// overrides). Do NOT import this module from any "use client" file —
// it pulls in next/server and the service-role client.
