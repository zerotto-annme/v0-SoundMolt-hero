import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/admin-auth"

export const dynamic = "force-dynamic"

interface BoostBody {
  /** Plays to add to the displayed total (organic stays untouched). */
  boost_plays?: number
  /** Likes to add to the displayed total. */
  boost_likes?: number
  /** Downloads to add to the displayed total. */
  boost_downloads?: number
  /** Free-text rationale shown in the boost-history audit log. */
  reason?: string
}

const TABLE_MISSING_HINT =
  "track_stat_boosts table does not exist. Apply migration " +
  "038_track_stat_boosts.sql via the Supabase SQL Editor."

function parseInteger(raw: unknown, field: string): { value: number; error: string | null } {
  if (raw === undefined || raw === null || raw === "") return { value: 0, error: null }
  const n = typeof raw === "number" ? raw : Number(raw)
  if (!Number.isFinite(n)) return { value: 0, error: `${field} must be a number` }
  if (!Number.isInteger(n)) return { value: 0, error: `${field} must be an integer` }
  if (n < 0) return { value: 0, error: `${field} cannot be negative` }
  // Sanity cap — anything above this is almost certainly a typo.
  if (n > 1_000_000_000) return { value: 0, error: `${field} is unrealistically large` }
  return { value: n, error: null }
}

/**
 * GET /api/admin/tracks/:id/boost
 *
 * Returns the full audit history of boosts applied to this track,
 * newest first. Each row records who boosted, by how much, and why —
 * so admins can see what was inflated and reason about chart movement.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAdmin(request)
    if (!auth.ok) return auth.response
    const { admin } = auth

    const { id } = await context.params
    if (!id) return NextResponse.json({ error: "Missing track id" }, { status: 400 })

    const { data: rows, error } = await admin
      .from("track_stat_boosts")
      .select(
        "id, track_id, boost_plays, boost_likes, boost_downloads, reason, created_by_admin, created_at",
      )
      .eq("track_id", id)
      .order("created_at", { ascending: false })

    if (error) {
      // Friendlier message for the most common cause: the migration
      // hasn't been applied yet on this Supabase project.
      const msg = /relation .* does not exist/i.test(error.message ?? "")
        ? TABLE_MISSING_HINT
        : error.message || "Failed to load boost history"
      console.error("[admin/tracks/boost GET]", error)
      return NextResponse.json({ error: msg }, { status: 500 })
    }

    // Resolve the admin emails for display, best-effort.
    const adminIds = Array.from(
      new Set((rows ?? []).map((r) => r.created_by_admin).filter(Boolean) as string[]),
    )
    const emailById = new Map<string, string | null>()
    await Promise.all(
      adminIds.map(async (uid) => {
        try {
          const { data, error: e } = await admin.auth.admin.getUserById(uid)
          if (!e && data?.user) emailById.set(uid, data.user.email ?? null)
        } catch {
          /* swallow */
        }
      }),
    )

    const boosts = (rows ?? []).map((r) => ({
      id: r.id,
      track_id: r.track_id,
      boost_plays: r.boost_plays,
      boost_likes: r.boost_likes,
      boost_downloads: r.boost_downloads,
      reason: r.reason,
      created_by_admin: r.created_by_admin,
      created_by_admin_email: r.created_by_admin
        ? emailById.get(r.created_by_admin) ?? null
        : null,
      created_at: r.created_at,
    }))

    return NextResponse.json({ boosts })
  } catch (e) {
    console.error("[admin/tracks/boost GET] unexpected:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unexpected server error" },
      { status: 500 },
    )
  }
}

/**
 * POST /api/admin/tracks/:id/boost
 * Body: { boost_plays?, boost_likes?, boost_downloads?, reason? }
 *
 * Inserts a single append-only boost row. Multiple boosts simply sum
 * — nothing is ever overwritten, so the audit log remains intact.
 *
 * Critical: this NEVER touches public.tracks.{plays,likes,downloads}.
 * Those columns remain the unmodified organic truth that the
 * recommendation / taste-profile pipeline reads.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAdmin(request)
    if (!auth.ok) return auth.response
    const { admin, user } = auth

    const { id } = await context.params
    if (!id) return NextResponse.json({ error: "Missing track id" }, { status: 400 })

    let body: BoostBody = {}
    try {
      body = (await request.json()) as BoostBody
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    const plays = parseInteger(body.boost_plays, "boost_plays")
    const likes = parseInteger(body.boost_likes, "boost_likes")
    const downloads = parseInteger(body.boost_downloads, "boost_downloads")
    const firstError = plays.error ?? likes.error ?? downloads.error
    if (firstError) return NextResponse.json({ error: firstError }, { status: 400 })

    if (plays.value === 0 && likes.value === 0 && downloads.value === 0) {
      return NextResponse.json(
        { error: "At least one of boost_plays / boost_likes / boost_downloads must be > 0" },
        { status: 400 },
      )
    }

    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : null

    // Confirm the track actually exists — saves us from an opaque FK
    // violation message and gives the admin a clear 404.
    const { data: trackRow, error: trackErr } = await admin
      .from("tracks")
      .select("id")
      .eq("id", id)
      .maybeSingle()
    if (trackErr) {
      console.error("[admin/tracks/boost POST] track lookup failed:", trackErr)
      return NextResponse.json({ error: trackErr.message }, { status: 500 })
    }
    if (!trackRow) {
      return NextResponse.json({ error: "Track not found" }, { status: 404 })
    }

    const { data: inserted, error: insErr } = await admin
      .from("track_stat_boosts")
      .insert({
        track_id: id,
        boost_plays: plays.value,
        boost_likes: likes.value,
        boost_downloads: downloads.value,
        reason: reason && reason.length > 0 ? reason : null,
        created_by_admin: user.id,
      })
      .select(
        "id, track_id, boost_plays, boost_likes, boost_downloads, reason, created_by_admin, created_at",
      )
      .single()

    if (insErr) {
      const msg = /relation .* does not exist/i.test(insErr.message ?? "")
        ? TABLE_MISSING_HINT
        : insErr.message || "Failed to record boost"
      console.error("[admin/tracks/boost POST] insert failed:", insErr)
      return NextResponse.json({ error: msg }, { status: 500 })
    }

    return NextResponse.json({ boost: inserted }, { status: 201 })
  } catch (e) {
    console.error("[admin/tracks/boost POST] unexpected:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unexpected server error" },
      { status: 500 },
    )
  }
}
