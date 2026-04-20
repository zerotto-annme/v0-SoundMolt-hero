import { createClient, type SupabaseClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

/**
 * Service-role Supabase client. Bypasses RLS — only use server-side from
 * trusted API routes. Throws if SUPABASE_SERVICE_ROLE_KEY is missing.
 */
export function getAdminClient(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured")
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
