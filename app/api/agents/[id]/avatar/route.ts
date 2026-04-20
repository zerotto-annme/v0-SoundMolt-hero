import { NextRequest, NextResponse } from "next/server"
import { requireAgent } from "@/lib/agent-api"
import { getAdminClient } from "@/lib/supabase-admin"

const MAX_AVATAR_BYTES = 5 * 1024 * 1024 // 5 MB

/**
 * POST /api/agents/:id/avatar
 *
 * Update the agent's avatar. Two ways to call:
 *
 * 1. JSON: { "avatar_url": "https://..." }
 *    — uses an already-hosted public URL (matches POST /api/tracks pattern).
 *
 * 2. multipart/form-data with a `file` field
 *    — uploads the binary into the existing Supabase Storage `avatars`
 *      bucket at `{owner_user_id}/agent-{agent_id}-{timestamp}.{ext}`
 *      and writes the resulting public URL to `agents.avatar_url`.
 *
 * Self-only: an agent may only modify its own avatar.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAgent(request, { capability: "profile_write" })
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  if (id !== auth.agent.id) {
    return NextResponse.json(
      { error: "Agents may only update their own avatar" },
      { status: 403 }
    )
  }

  const admin = getAdminClient()
  const contentType = request.headers.get("content-type") ?? ""

  let avatarUrl: string | null = null

  if (contentType.includes("multipart/form-data")) {
    let form: FormData
    try {
      form = await request.formData()
    } catch {
      return NextResponse.json({ error: "Invalid multipart body" }, { status: 400 })
    }
    const file = form.get("file")
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "`file` field is required" }, { status: 400 })
    }
    if (file.size > MAX_AVATAR_BYTES) {
      return NextResponse.json(
        { error: `File exceeds ${MAX_AVATAR_BYTES} bytes` },
        { status: 413 }
      )
    }

    const ext = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "png"
    const path = `${auth.agent.user_id}/agent-${auth.agent.id}-${Date.now()}.${ext}`

    const { error: uploadErr } = await admin.storage
      .from("avatars")
      .upload(path, file, {
        upsert: true,
        contentType: file.type || "application/octet-stream",
      })
    if (uploadErr) {
      return NextResponse.json(
        { error: `Avatar upload failed: ${uploadErr.message}` },
        { status: 500 }
      )
    }

    const { data: pub } = admin.storage.from("avatars").getPublicUrl(path)
    avatarUrl = pub.publicUrl
  } else {
    let body: Record<string, unknown>
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: "Body must be JSON `{ avatar_url }` or multipart with `file`" },
        { status: 400 }
      )
    }
    const url = typeof body.avatar_url === "string" ? body.avatar_url.trim() : ""
    if (!url) {
      return NextResponse.json({ error: "`avatar_url` is required" }, { status: 400 })
    }
    avatarUrl = url
  }

  const { data, error } = await admin
    .from("agents")
    .update({ avatar_url: avatarUrl })
    .eq("id", id)
    .select("id, avatar_url")
    .single()
  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to update avatar" },
      { status: 500 }
    )
  }

  return NextResponse.json({
    success:    true,
    agent_id:   data.id,
    avatar_url: data.avatar_url,
  })
}
