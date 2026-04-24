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
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
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
    return NextResponse.json({ error: "Update failed" }, { status: 500 })
  }

  return NextResponse.json({ track: data })
}

/**
 * DELETE /api/admin/tracks/:id
 *
 * Permanently removes the track row. ON DELETE CASCADE on track_analysis,
 * track_plays, etc. cleans up dependent rows. Storage objects (audio /
 * cover) are NOT removed by this endpoint — that's a separate concern
 * (orphaned-asset cleanup cron handles abandoned uploads).
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin(request)
  if (!auth.ok) return auth.response
  const { admin } = auth

  const { id } = await context.params
  if (!id) return NextResponse.json({ error: "Missing track id" }, { status: 400 })

  const { error } = await admin.from("tracks").delete().eq("id", id)
  if (error) {
    console.error("[admin/tracks DELETE] failed:", error)
    return NextResponse.json({ error: "Delete failed" }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
