import { NextResponse } from "next/server"
import { getAdminClient, getUserFromAuthHeader, hasServiceRoleKey } from "@/lib/supabase-admin"

// GET /api/ai-producer/reviews/:id
//
// Stage-2 read endpoint for the AI Producer Review module.
//
// Hard rules enforced here:
//   • Auth required — Bearer JWT, validated server-side.
//   • A user can ONLY see their own reviews. We scope the query by
//     both id AND user_id so a row that belongs to someone else is
//     indistinguishable from a missing one (404).
//   • The full report_json is returned as-is. The backend never
//     truncates / blurs / redacts based on access_type — that is the
//     frontend's responsibility (Stage 4 blur logic).
//   • Read-only. We never touch the normal Upload Track / /api/tracks
//     pipeline.
//
// Response shape:
//   200 { ok: true, review: { id, user_id, track_id, original_track_id,
//                             source_type, audio_url, title, genre,
//                             daw, feedback_focus, comment, status,
//                             report_json, access_type, credits_used,
//                             created_at, updated_at } }
//   400 invalid id
//   401 unauthorized
//   404 not_found              ← also covers "row exists but belongs to someone else"
//   500 server misconfigured / unknown error

const SELECT_COLS = [
  "id",
  "user_id",
  "track_id",
  "original_track_id",
  "source_type",
  "audio_url",
  "title",
  "genre",
  "daw",
  "feedback_focus",
  "comment",
  "status",
  "report_json",
  "access_type",
  "credits_used",
  "created_at",
  "updated_at",
].join(", ")

function isLikelyUuid(value: string): boolean {
  // permissive — Postgres will reject anything genuinely malformed and
  // we surface that as a 404 rather than leaking parser internals.
  return /^[0-9a-f-]{32,36}$/i.test(value)
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!hasServiceRoleKey()) {
    console.error("[api/ai-producer/reviews/:id] missing service role key")
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 })
  }

  const authed = await getUserFromAuthHeader(request)
  if (!authed) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const { id } = await params
  if (!id || !isLikelyUuid(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 })
  }

  const admin = getAdminClient()

  // Scope by BOTH id and user_id so cross-user reads are impossible.
  const { data, error } = await admin
    .from("ai_producer_reviews")
    .select(SELECT_COLS)
    .eq("id", id)
    .eq("user_id", authed.id)
    .maybeSingle()

  if (error) {
    console.error("[api/ai-producer/reviews/:id] read failed:", error)
    return NextResponse.json(
      { error: "read_failed", message: error.message ?? "Failed to load review." },
      { status: 500 },
    )
  }

  if (!data) {
    return NextResponse.json({ error: "not_found" }, { status: 404 })
  }

  return NextResponse.json({ ok: true, review: data })
}
