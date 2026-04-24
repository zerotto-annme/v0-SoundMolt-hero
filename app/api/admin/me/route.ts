import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/admin-auth"

export const dynamic = "force-dynamic"

/**
 * GET /api/admin/me
 *
 * Gate-check for the /admin client page. Uses the SAME requireAdmin()
 * helper as every /api/admin/* data route so the UI gate can never
 * disagree with the API gate (in particular: respects the ADMIN_EMAILS
 * env override).
 *
 * Status semantics — IMPORTANT:
 *   200 { is_admin: true, email }
 *     → bearer token belongs to a confirmed admin.
 *   200 { is_admin: false }
 *     → bearer token belongs to a confirmed authenticated NON-admin.
 *       This is the ONLY case the client treats as "Access denied".
 *   401
 *     → no/invalid bearer token. The client treats this as a transient
 *       error (token may not have propagated yet) and retries — NOT
 *       as a permanent denial — to avoid falsely denying an admin
 *       during a token refresh race.
 *   500
 *     → server misconfiguration (e.g. missing service role key).
 *       The client surfaces a retryable "Couldn't verify access" card
 *       instead of pretending the user has been denied.
 *
 * This endpoint is a UX hint, not a security boundary — the actual
 * data routes still 401/403 on every call regardless of what we
 * return here.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (auth.ok) {
    return NextResponse.json({ is_admin: true, email: auth.user.email })
  }

  // requireAdmin returned a NextResponse — preserve its status semantics:
  //   • 403 = authenticated but not on the admin allow-list → that's
  //     the "confirmed non-admin" case the client cares about, so we
  //     translate it into a 200 { is_admin: false }.
  //   • Anything else (401 unauthorized, 500 misconfig, etc.) is
  //     propagated as-is so the client can distinguish a real denial
  //     from a transient/auth/system problem.
  const status = auth.response.status
  if (status === 403) {
    return NextResponse.json({ is_admin: false })
  }
  return auth.response
}
