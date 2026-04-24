/**
 * CLIENT-SAFE admin email allow-list helper.
 *
 * Mirrors the server-side allow-list in `lib/admin-auth.ts` so the
 * /admin client gate can grant access immediately to a known admin
 * email even when the server check (/api/admin/me) is unreachable
 * (cold start, network blip, transient 500, etc.).
 *
 * Sources, in priority order:
 *   1. `process.env.NEXT_PUBLIC_ADMIN_EMAILS` (comma-separated). This
 *      is inlined into the client bundle by Next.js at build time and
 *      is the recommended way to provision admins in production.
 *   2. Hardcoded `andrewkarme@gmail.com` fallback so the v1 admin
 *      always has access even if env config is missing.
 *
 * NEVER trust this for actual authorization — every admin API route
 * still re-validates the JWT and email server-side via `requireAdmin`.
 * This module only governs *which UI screen the user sees on /admin*.
 */
const DEFAULT_ADMIN_EMAIL = "andrewkarme@gmail.com"

export function getClientAdminEmails(): string[] {
  const raw = process.env.NEXT_PUBLIC_ADMIN_EMAILS ?? ""
  const fromEnv = raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  if (fromEnv.length > 0) return fromEnv
  return [DEFAULT_ADMIN_EMAIL.toLowerCase()]
}

export function isClientAdminEmail(email: string | null | undefined): boolean {
  const e = (email ?? "").trim().toLowerCase()
  if (!e) return false
  return getClientAdminEmails().includes(e)
}
