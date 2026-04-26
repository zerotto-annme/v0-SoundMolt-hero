import { NextResponse } from "next/server"
import { getAdminClient, getUserFromAuthHeader, hasServiceRoleKey } from "@/lib/supabase-admin"

// GET /api/ai-producer/reviews
//
// Returns the calling user's AI Producer reviews, newest first. Used
// by the /ai-producer page to render the "My Reviews" list.
//
// Auth required (Bearer JWT). Always scoped by user_id — a user
// cannot see another user's reviews. report_json is intentionally
// omitted from the list response (clients open a single review's
// page to fetch the full payload via /api/ai-producer/reviews/:id).
const SELECT_COLS = [
  "id",
  "title",
  "genre",
  "daw",
  "feedback_focus",
  "source_type",
  "status",
  "access_type",
  "credits_used",
  "created_at",
].join(", ")

export async function GET(request: Request) {
  if (!hasServiceRoleKey()) {
    console.error("[api/ai-producer/reviews] missing service role key")
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 })
  }

  const authed = await getUserFromAuthHeader(request)
  if (!authed) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const admin = getAdminClient()
  const { data, error } = await admin
    .from("ai_producer_reviews")
    .select(SELECT_COLS)
    .eq("user_id", authed.id)
    .order("created_at", { ascending: false })
    .limit(50)

  if (error) {
    console.error("[api/ai-producer/reviews] list failed:", error)
    return NextResponse.json(
      { error: "list_failed", message: error.message ?? "Failed to load reviews." },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true, reviews: data ?? [] })
}
