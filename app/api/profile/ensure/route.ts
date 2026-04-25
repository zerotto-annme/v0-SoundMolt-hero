import { NextResponse } from "next/server"
import { getAdminClient, getUserFromAuthHeader, hasServiceRoleKey } from "@/lib/supabase-admin"

// Server-side safety net for profile auto-creation.
//
// The client-side ensureProfileRow() in components/auth-context.tsx tries
// to upsert the row first using the user's session. If that fails (RLS
// race, transient network, schema drift, dropped DB trigger, etc.), the
// client falls back to POSTing to this route. The service-role admin
// client bypasses RLS entirely, so as long as the user is authenticated
// and the service-role key is configured, the row WILL be created.
//
// This makes profile creation "permanently" idempotent across every
// failure mode the architect identified — you should never again need
// to run manual SQL to backfill a missing profile.
//
// Auth model:
//   The caller MUST send `Authorization: Bearer <supabase_access_token>`.
//   We validate the JWT and then write the row keyed to THAT user.id.
//   The body is ignored for the user identity — the user can never
//   create a profile for someone else.
//
// Idempotent semantics:
//   onConflict="id", ignoreDuplicates=true. If a profile already exists
//   we leave it untouched (so the user's chosen username/avatar are
//   never silently overwritten).

function sanitizeUsername(raw: string): string {
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "")
  let candidate = cleaned.slice(0, 30)
  if (candidate.length < 3) candidate = (candidate + "_user").slice(0, 30)
  return candidate
}

export async function POST(request: Request) {
  if (!hasServiceRoleKey()) {
    console.error("[api/profile/ensure] missing service role key")
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 })
  }

  const authed = await getUserFromAuthHeader(request)
  if (!authed) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  // Body is OPTIONAL. Accept { avatarUrl?: string } so the client can pass
  // the user_metadata.avatar_url it already has on hand. We never trust the
  // body for identity — only for the avatar default.
  let avatarUrl: string | null = null
  try {
    const body = await request.json().catch(() => null)
    if (body && typeof body.avatarUrl === "string" && body.avatarUrl.startsWith("http")) {
      avatarUrl = body.avatarUrl
    }
  } catch {
    // ignore — body is optional
  }

  const admin = getAdminClient()

  // Re-fetch the user from auth.users using admin client so we can read
  // user_metadata server-side (the JWT validation only gave us id+email).
  // If this fails we still proceed with email-prefix; the row gets created
  // either way.
  let metaAvatar: string | null = avatarUrl
  let email = authed.email
  try {
    const { data: au } = await admin.auth.admin.getUserById(authed.id)
    if (au?.user) {
      email = au.user.email ?? email
      const meta = (au.user.user_metadata || {}) as Record<string, unknown>
      if (!metaAvatar) {
        if (typeof meta.avatar_url === "string" && meta.avatar_url) metaAvatar = meta.avatar_url
        else if (typeof meta.picture === "string" && meta.picture) metaAvatar = meta.picture
      }
    }
  } catch (err) {
    console.warn("[api/profile/ensure] admin.getUserById failed — proceeding with token claims only", err)
  }

  const emailPrefix = email ? email.split("@")[0] : "user"
  const username = sanitizeUsername(emailPrefix)

  // First attempt: upsert with the sanitized username.
  // ignoreDuplicates means a pre-existing row is a no-op — we never
  // overwrite a user's chosen values.
  const { error: firstErr } = await admin
    .from("profiles")
    .upsert(
      {
        id: authed.id,
        username,
        artist_name: username,
        role: "human",
        avatar_url: metaAvatar,
      },
      { onConflict: "id", ignoreDuplicates: true }
    )

  if (!firstErr) {
    return NextResponse.json({ ok: true, action: "ensured", username })
  }

  // Username collision — retry with NULL username so the row is created.
  // The client-side claimUsername() will pick a suffixed one afterwards.
  const isUnique =
    String(firstErr.code || "").includes("23505") ||
    /duplicate key|unique/i.test(firstErr.message || "")
  if (isUnique) {
    const { error: nullErr } = await admin
      .from("profiles")
      .upsert(
        {
          id: authed.id,
          username: null,
          artist_name: username,
          role: "human",
          avatar_url: metaAvatar,
        },
        { onConflict: "id", ignoreDuplicates: true }
      )
    if (!nullErr) {
      return NextResponse.json({ ok: true, action: "ensured_null_username" })
    }
    console.error("[api/profile/ensure] NULL-username retry failed", nullErr)
    return NextResponse.json({ error: "db_write_failed", detail: nullErr.message }, { status: 500 })
  }

  console.error("[api/profile/ensure] upsert failed", firstErr)
  return NextResponse.json({ error: "db_write_failed", detail: firstErr.message }, { status: 500 })
}
