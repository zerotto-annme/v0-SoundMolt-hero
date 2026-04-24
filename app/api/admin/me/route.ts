import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/admin-auth"

export const dynamic = "force-dynamic"

/**
 * GET /api/admin/me
 *
 * Lightweight gate-check for the /admin client page. Returns
 *   { is_admin: true,  email }
 * when the bearer token belongs to an allowed admin (matching every
 * other /api/admin/* route's auth pattern), and
 *   { is_admin: false }
 * otherwise. Uses the SAME requireAdmin() helper so the UI gate can
 * never disagree with the API gate (in particular: respects the
 * ADMIN_EMAILS env override).
 *
 * The response is intentionally a 200 in both cases — the client just
 * needs a boolean to decide whether to render the dashboard or the
 * "access denied" card. The actual data routes still 401/403 on every
 * call, so this endpoint is a UX hint, not a security boundary.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (!auth.ok) {
    return NextResponse.json({ is_admin: false })
  }
  return NextResponse.json({ is_admin: true, email: auth.user.email })
}
