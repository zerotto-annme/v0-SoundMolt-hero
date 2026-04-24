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
 * RESPONSE CONTRACT — ALWAYS JSON, NEVER A RAW THROW:
 *   This route is wrapped in a top-level try/catch so any unexpected
 *   server error becomes a structured JSON body instead of a raw 500
 *   HTML page. The client uses the JSON shape to decide what UI to
 *   render; an HTML 500 would break that contract and trigger the
 *   "Couldn't verify access" card unnecessarily.
 *
 *   Shape (always present):
 *     {
 *       isAdmin: boolean,         // legacy: also exposed as is_admin
 *       email: string | null,     // the auth email if known
 *       reason: string,           // short tag: "ok" | "forbidden" |
 *                                 //   "unauthorized" | "misconfigured" |
 *                                 //   "exception"
 *     }
 *
 * Status codes:
 *   200 → request was processed; check `isAdmin`/`reason` for outcome.
 *         Both confirmed-admin and confirmed-non-admin are 200 so the
 *         client can rely on `isAdmin` without juggling status codes.
 *   401 → no/invalid bearer token. Body still JSON with reason="unauthorized".
 *   500 → genuine server misconfiguration or unexpected exception. Body
 *         still JSON with reason="misconfigured" or "exception".
 *
 *   The /admin page will fall back to a CLIENT-SIDE allow-list check
 *   (isClientAdminEmail) if the call fails or returns a non-2xx, so a
 *   known admin email is never blocked by a flaky API.
 *
 * This endpoint is a UX hint, not a security boundary — the actual
 * data routes still 401/403 on every call regardless of what we
 * return here.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request)
    if (auth.ok) {
      return NextResponse.json({
        isAdmin: true,
        is_admin: true, // legacy alias
        email: auth.user.email,
        reason: "ok",
      })
    }

    const status = auth.response.status
    if (status === 403) {
      // Confirmed authenticated non-admin. Translate to 200 + isAdmin:false
      // so the client can branch on the boolean cleanly.
      let email: string | null = null
      try {
        const body = (await auth.response.clone().json()) as { email?: string }
        email = body?.email ?? null
      } catch {
        // body wasn't JSON — that's fine, we just don't echo the email
      }
      return NextResponse.json({
        isAdmin: false,
        is_admin: false,
        email,
        reason: "forbidden",
      })
    }

    if (status === 401) {
      return NextResponse.json(
        { isAdmin: false, is_admin: false, email: null, reason: "unauthorized" },
        { status: 401 },
      )
    }

    // 500 from requireAdmin (e.g. missing service role key)
    console.error("[api/admin/me] requireAdmin returned non-OK status", { status })
    return NextResponse.json(
      { isAdmin: false, is_admin: false, email: null, reason: "misconfigured" },
      { status: 500 },
    )
  } catch (err) {
    // Any unexpected exception (Supabase outage, env crash, etc.) is
    // turned into a structured JSON error so the client never sees a
    // raw HTML 500 / Next.js error page.
    console.error("[api/admin/me] unexpected exception", err)
    return NextResponse.json(
      {
        isAdmin: false,
        is_admin: false,
        email: null,
        reason: "exception",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    )
  }
}
