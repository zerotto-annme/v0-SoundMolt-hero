import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/admin-auth"

// GET /api/admin/ai-producer/reviews
//
// Admin-only listing of every AI Producer review across all users.
// Used by /admin/ai-producer to render the "All Reviews" block.
//
// Returns at most 500 rows ordered by created_at desc. Each row is
// enriched with the owner's email when we can resolve it via the auth
// admin API — emails are best-effort and may be null for deleted
// accounts.
export const dynamic = "force-dynamic"

const SELECT_COLS = [
  "id",
  "user_id",
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

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (!auth.ok) return auth.response
  const { admin } = auth

  const { data: reviews, error } = await admin
    .from("ai_producer_reviews")
    .select(SELECT_COLS)
    .order("created_at", { ascending: false })
    .limit(500)

  if (error) {
    console.error("[admin/ai-producer/reviews] list failed:", error)
    return NextResponse.json(
      { error: "list_failed", message: error.message ?? "Failed to load reviews." },
      { status: 500 },
    )
  }

  // Best-effort owner-email enrichment. We pull a single page of
  // auth users (perPage 1000) which is plenty for testing/admin use.
  const emailById = new Map<string, string | null>()
  try {
    const { data: usersPage } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
    for (const u of usersPage?.users ?? []) {
      emailById.set(u.id, u.email ?? null)
    }
  } catch (err) {
    console.warn("[admin/ai-producer/reviews] listUsers enrichment failed:", err)
  }

  const enriched = (reviews ?? []).map((r: any) => ({
    ...r,
    owner_email: emailById.get(r.user_id) ?? null,
  }))

  return NextResponse.json({ ok: true, reviews: enriched })
}
