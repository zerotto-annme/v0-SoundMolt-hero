import { createClient, type SupabaseClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

/**
 * Resolve the service-role key from env, accepting several common
 * naming variants so deployments that already provisioned the secret
 * under an older/alternate name keep working without redeploy.
 *
 * Canonical name: `SUPABASE_SERVICE_ROLE_KEY`
 * Accepted aliases (legacy / Supabase docs variants):
 *   - SUPABASE_SERVICE_KEY
 *   - SUPABASE_SERVICE_ROLE
 *
 * NOTE: We deliberately do NOT accept `NEXT_PUBLIC_*` variants —
 * the service-role key MUST never be inlined into the client bundle.
 *
 * The lookup is server-only — `lib/supabase-admin.ts` is imported
 * exclusively by API route handlers, never by `"use client"` files.
 */
function resolveServiceRoleKey(): string | undefined {
  const candidates = [
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.SUPABASE_SERVICE_KEY,
    process.env.SUPABASE_SERVICE_ROLE,
  ]
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) return c.trim()
  }
  return undefined
}

/**
 * Pure existence check — returns true iff a service-role key is
 * configured under any of the accepted env names. Useful for routes
 * that want to early-return a structured 500 instead of throwing.
 */
export function hasServiceRoleKey(): boolean {
  return resolveServiceRoleKey() !== undefined
}

/**
 * Returns the resolved service-role key string (under any accepted
 * env name) or `undefined` if none is configured. For the few routes
 * that still build their own `createClient(...)` calls and want the
 * raw key value rather than the cached `getAdminClient()` instance.
 *
 * Server-only; never call from client code.
 */
export function getServiceRoleKey(): string | undefined {
  return resolveServiceRoleKey()
}

/**
 * Service-role Supabase client. Bypasses RLS — only use server-side from
 * trusted API routes. Throws if no service-role key is configured under
 * any of the accepted env names.
 */
export function getAdminClient(): SupabaseClient {
  const key = resolveServiceRoleKey()
  if (!key) {
    // Safe diagnostic: log WHICH env names we checked and which other
    // Supabase env vars ARE present. Never log the actual key value.
    console.error("[supabase-admin] Missing service role key", {
      hasUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      hasAnonKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      hasServiceRoleKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      hasServiceKeyAlias: !!process.env.SUPABASE_SERVICE_KEY,
      hasServiceRoleAlias: !!process.env.SUPABASE_SERVICE_ROLE,
      acceptedNames: [
        "SUPABASE_SERVICE_ROLE_KEY",
        "SUPABASE_SERVICE_KEY",
        "SUPABASE_SERVICE_ROLE",
      ],
    })
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured (also checked SUPABASE_SERVICE_KEY, SUPABASE_SERVICE_ROLE)",
    )
  }
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false } })
}

/**
 * Validate a Supabase user JWT from the `Authorization: Bearer <jwt>`
 * header. Returns `{ id, email }` on success, or `null` if missing/invalid.
 */
export async function getUserFromAuthHeader(
  request: Request
): Promise<{ id: string; email: string | null } | null> {
  const header = request.headers.get("authorization") ?? ""
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : ""
  if (!token) return null

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data, error } = await userClient.auth.getUser()
  if (error || !data.user) return null
  return { id: data.user.id, email: data.user.email ?? null }
}
