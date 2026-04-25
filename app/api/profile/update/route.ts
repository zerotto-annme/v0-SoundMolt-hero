import { NextResponse } from "next/server"
import { getAdminClient, getUserFromAuthHeader, hasServiceRoleKey } from "@/lib/supabase-admin"

// Server-side profile update endpoint.
//
// The browser-side UPDATE on `public.profiles` was silently no-op-ing
// even when the row existed and the caller owned it: the request
// succeeded (no error returned) but the row was never modified, so
// `Edit Profile` would flash the green success state without anything
// changing in the database. This is a known interaction between RLS
// and PostgREST UPDATEs in this schema. Routing the write through the
// service-role admin client side-steps RLS entirely while still
// keeping ownership safe — the user id we write to is taken from the
// validated Bearer JWT, never from the request body.
//
// Auth model:
//   The caller MUST send `Authorization: Bearer <supabase_access_token>`.
//   We validate the JWT server-side; the user can never update someone
//   else's profile because the WHERE clause is keyed on the JWT user id.
//
// Body shape (all fields optional, only the present ones are updated):
//   { username?: string; avatar_url?: string | null }
//
// Response:
//   200 { ok: true, profile: { id, username, avatar_url, ... } }
//   400 invalid input (e.g. bad username format)
//   401 unauthorized
//   409 username already taken (Postgres 23505 unique_violation)
//   500 server misconfigured / unknown error

const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/

function validateUsername(raw: unknown): { ok: true; value: string } | { ok: false; reason: string } {
  if (typeof raw !== "string") return { ok: false, reason: "username must be a string" }
  const trimmed = raw.trim()
  if (trimmed.length < 3 || trimmed.length > 30) {
    return { ok: false, reason: "Username must be between 3 and 30 characters." }
  }
  if (!USERNAME_REGEX.test(trimmed)) {
    return { ok: false, reason: "Username can only contain letters, numbers, and underscores." }
  }
  return { ok: true, value: trimmed }
}

export async function POST(request: Request) {
  if (!hasServiceRoleKey()) {
    console.error("[api/profile/update] missing service role key")
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 })
  }

  const authed = await getUserFromAuthHeader(request)
  if (!authed) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 })
  }

  // Build the patch from ONLY the recognised fields. Anything the caller
  // sends that we don't list here is ignored — never reflect arbitrary
  // body fields back into the row.
  const patch: Record<string, unknown> = {}

  if (body && body.username !== undefined) {
    const v = validateUsername(body.username)
    if (!v.ok) {
      return NextResponse.json({ error: "invalid_username", message: v.reason }, { status: 400 })
    }
    patch.username = v.value
  }

  if (body && body.avatar_url !== undefined) {
    if (body.avatar_url === null) {
      patch.avatar_url = null
    } else if (typeof body.avatar_url === "string") {
      const trimmed = body.avatar_url.trim()
      patch.avatar_url = trimmed.length > 0 ? trimmed : null
    } else {
      return NextResponse.json({ error: "invalid_avatar_url" }, { status: 400 })
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no_fields_to_update" }, { status: 400 })
  }

  const admin = getAdminClient()

  const { data, error } = await admin
    .from("profiles")
    .update(patch)
    .eq("id", authed.id)
    .select("id, role, username, artist_name, avatar_url, avatar_is_custom")
    .maybeSingle()

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "username_taken", message: "That username is already taken." },
        { status: 409 },
      )
    }
    console.error("[api/profile/update] update failed:", error)
    return NextResponse.json(
      { error: "update_failed", message: error.message ?? "Profile update failed." },
      { status: 500 },
    )
  }

  if (!data) {
    // The user is authenticated but doesn't have a profiles row yet.
    // Insert one so the update isn't a no-op for brand-new accounts.
    const insertPayload: Record<string, unknown> = { id: authed.id, role: "user", ...patch }
    const { data: inserted, error: insertErr } = await admin
      .from("profiles")
      .insert(insertPayload)
      .select("id, role, username, artist_name, avatar_url, avatar_is_custom")
      .maybeSingle()

    if (insertErr) {
      if (insertErr.code === "23505") {
        return NextResponse.json(
          { error: "username_taken", message: "That username is already taken." },
          { status: 409 },
        )
      }
      console.error("[api/profile/update] insert failed:", insertErr)
      return NextResponse.json(
        { error: "update_failed", message: insertErr.message ?? "Profile update failed." },
        { status: 500 },
      )
    }
    return NextResponse.json({ ok: true, profile: inserted })
  }

  return NextResponse.json({ ok: true, profile: data })
}
