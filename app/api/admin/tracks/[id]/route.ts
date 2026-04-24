import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/admin-auth"

export const dynamic = "force-dynamic"

interface PatchBody {
  /** "publish" sets published_at = now(); "unpublish" sets it to NULL. */
  action?: "publish" | "unpublish"
}

/**
 * PATCH /api/admin/tracks/:id
 * Body: { action: "publish" | "unpublish" }
 *
 * Toggles the track's published_at column. Setting published_at = NULL
 * hides the track from public feeds (the existing public queries filter
 * `where published_at is not null`). Resetting it to now() makes it
 * publicly visible again.
 *
 * The whole handler is wrapped in a top-level try/catch as a safety net
 * — every failure mode (auth, JSON parse, supabase error, unexpected
 * throw) returns a JSON body with `{ error }`. This is what guarantees
 * the admin panel's per-row spinner can always reach its `finally` and
 * never hangs the button forever.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAdmin(request)
    if (!auth.ok) return auth.response
    const { admin } = auth

    const { id } = await context.params
    if (!id) return NextResponse.json({ error: "Missing track id" }, { status: 400 })

    let body: PatchBody = {}
    try {
      body = (await request.json()) as PatchBody
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    if (body.action !== "publish" && body.action !== "unpublish") {
      return NextResponse.json(
        { error: 'action must be "publish" or "unpublish"' },
        { status: 400 },
      )
    }

    const newPublishedAt = body.action === "publish" ? new Date().toISOString() : null

    const { data, error } = await admin
      .from("tracks")
      .update({ published_at: newPublishedAt })
      .eq("id", id)
      .select("id, published_at")
      .single()

    if (error) {
      console.error("[admin/tracks PATCH] update failed:", error)
      return NextResponse.json({ error: error.message || "Update failed" }, { status: 500 })
    }

    return NextResponse.json({ track: data })
  } catch (e) {
    console.error("[admin/tracks PATCH] unexpected:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unexpected server error" },
      { status: 500 },
    )
  }
}

/**
 * DELETE /api/admin/tracks/:id
 *
 * Permanently removes the track row. ON DELETE CASCADE on track_analysis,
 * track_plays, etc. cleans up dependent rows. Storage objects (audio /
 * cover) are NOT removed by this endpoint — that's a separate concern
 * (orphaned-asset cleanup cron handles abandoned uploads).
 *
 * Wrapped in top-level try/catch for the same reason as PATCH above —
 * the admin panel relies on a JSON response (success or failure) to
 * reach its per-row `finally { setBusyId(null) }` cleanup.
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAdmin(request)
    if (!auth.ok) return auth.response
    const { admin } = auth

    const { id } = await context.params
    if (!id) return NextResponse.json({ error: "Missing track id" }, { status: 400 })

    const { error } = await admin.from("tracks").delete().eq("id", id)
    if (error) {
      console.error("[admin/tracks DELETE] failed:", error)
      return NextResponse.json({ error: error.message || "Delete failed" }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error("[admin/tracks DELETE] unexpected:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unexpected server error" },
      { status: 500 },
    )
  }
}
