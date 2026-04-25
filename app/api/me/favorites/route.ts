import { NextRequest, NextResponse } from "next/server"
import { getAdminClient, getUserFromAuthHeader } from "@/lib/supabase-admin"

/**
 * GET /api/me/favorites
 *
 * Returns the calling user's favorite track IDs in reverse-chronological
 * order. Used by the FavoritesProvider on login to hydrate its in-memory
 * Set so the favorite-button toggle state is correct on first paint
 * across the app (modal, cards, sidebar, etc.).
 *
 * The returned shape is intentionally minimal — favorites are a private
 * bookmark surface, not a public-feed display, so we don't need the full
 * track join here. Pages that want to render the user's favorited tracks
 * can fetch the matching `tracks` rows separately as needed.
 *
 * Auth: Supabase user JWT in `Authorization: Bearer <jwt>`.
 */
export async function GET(request: NextRequest) {
  const user = await getUserFromAuthHeader(request)
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 })
  }

  const admin = getAdminClient()

  const { data, error } = await admin
    .from("track_favorites")
    .select("track_id, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(500)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    ids: (data ?? []).map((r) => r.track_id as string),
  })
}
