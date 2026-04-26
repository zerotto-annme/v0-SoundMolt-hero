import { NextResponse } from "next/server"
import { getAdminClient, getUserFromAuthHeader, hasServiceRoleKey } from "@/lib/supabase-admin"

// GET /api/ai-producer/credits
//
// Returns the calling user's current AI Producer credit balance. A
// missing user_credits row is treated as 0 (the user simply has not
// been granted any credits yet). This endpoint is read-only and never
// creates a user_credits row on its own — credits are only ever
// minted by the (future) admin grant flow.
//
// Auth required (Bearer JWT). Service-role only on the DB side.
export async function GET(request: Request) {
  if (!hasServiceRoleKey()) {
    console.error("[api/ai-producer/credits] missing service role key")
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 })
  }

  const authed = await getUserFromAuthHeader(request)
  if (!authed) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const admin = getAdminClient()
  const { data, error } = await admin
    .from("user_credits")
    .select("credits_balance")
    .eq("user_id", authed.id)
    .maybeSingle()

  if (error) {
    console.error("[api/ai-producer/credits] read failed:", error)
    return NextResponse.json(
      { error: "read_failed", message: error.message ?? "Failed to load credits." },
      { status: 500 },
    )
  }

  const balance =
    data && typeof data.credits_balance === "number" ? data.credits_balance : 0

  return NextResponse.json({ ok: true, credits_balance: balance })
}
