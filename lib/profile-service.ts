"use client"

import { supabase } from "./supabase"

export type ProfileRow = {
  id: string
  role: string | null
  username: string | null
  artist_name: string | null
  avatar_url: string | null
  avatar_is_custom: boolean | null
  updated_at?: string | null
}

export class UsernameTakenError extends Error {
  constructor(public readonly username: string) {
    super(`Username "${username}" is already taken.`)
    this.name = "UsernameTakenError"
  }
}

const SELECT_COLS = "id, role, username, artist_name, avatar_url, avatar_is_custom, updated_at"
const SELECT_COLS_FALLBACK = "id, role, username, artist_name, avatar_url, avatar_is_custom"

// Strict: only catch the actual Postgres "undefined column" code AND require
// the message to mention updated_at. Avoids accidentally swallowing
// permission / trigger / runtime errors that happen to mention the column.
function isMissingUpdatedAt(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false
  if (err.code !== "42703") return false
  return /updated_at/i.test(err.message ?? "")
}

function sanitizeUsername(raw: string): string {
  let u = (raw || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "_")
  if (u.length < 3) u = (u + "_user").slice(0, 30)
  if (u.length > 30) u = u.slice(0, 30)
  return u || "user"
}

function readMetaAvatar(user: { user_metadata?: Record<string, unknown> | null } | null): string | null {
  const m = user?.user_metadata
  if (!m || typeof m !== "object") return null
  const a = ((m as Record<string, unknown>).avatar_url ?? (m as Record<string, unknown>).picture ?? null) as unknown
  if (typeof a !== "string" || !a.trim()) return null
  return a.trim()
}

// Tolerant SELECT — falls back to the legacy column list if updated_at is
// missing (i.e. migration 039 hasn't been applied yet).
async function selectProfile(userId: string): Promise<ProfileRow | null> {
  let data: unknown = null
  let error: { code?: string; message?: string } | null = null
  const first = await supabase
    .from("profiles")
    .select(SELECT_COLS)
    .eq("id", userId)
    .maybeSingle()
  data = first.data
  error = first.error
  if (error && isMissingUpdatedAt(error)) {
    const r = await supabase
      .from("profiles")
      .select(SELECT_COLS_FALLBACK)
      .eq("id", userId)
      .maybeSingle()
    data = r.data
    error = r.error
  }
  console.log("PROFILE fetch result", { userId, hasRow: !!data, error: error?.message ?? null })
  // Throw on real errors so callers can surface a meaningful message;
  // only return null when the query genuinely returned no row.
  if (error) throw new Error(error.message || "Could not load profile.")
  return (data ?? null) as ProfileRow | null
}

type EnsureUserInput = {
  id: string
  email?: string | null
  user_metadata?: Record<string, unknown> | null
}

// Idempotent: tries a client upsert first (RLS-permitted on the user's own
// id) and escalates to /api/profile/ensure (service-role) on failure. Never
// overwrites an existing username/avatar — uses ignoreDuplicates so an
// existing row is a no-op.
export async function ensureProfile(user: EnsureUserInput): Promise<ProfileRow | null> {
  console.log("PROFILE ensure start", { userId: user.id })
  const fallbackUsername = sanitizeUsername((user.email ?? "user").split("@")[0])
  const metaAvatar = readMetaAvatar(user)

  const { error: e1 } = await supabase
    .from("profiles")
    .upsert(
      {
        id: user.id,
        role: "human",
        username: fallbackUsername,
        artist_name: fallbackUsername,
        avatar_url: metaAvatar,
      },
      { onConflict: "id", ignoreDuplicates: true },
    )

  if (e1) {
    if (e1.code === "23505") {
      // Username collision — retry with NULL username so the row gets in.
      // The user can choose a username afterwards via the SetUsername modal.
      const { error: e2 } = await supabase
        .from("profiles")
        .upsert(
          {
            id: user.id,
            role: "human",
            username: null,
            artist_name: fallbackUsername,
            avatar_url: metaAvatar,
          },
          { onConflict: "id", ignoreDuplicates: true },
        )
      if (e2) {
        console.warn("[profile-service] ensure NULL-username retry failed; escalating", e2)
        await escalateEnsureToServer(metaAvatar)
      }
    } else {
      console.warn("[profile-service] ensure client upsert failed; escalating", e1)
      await escalateEnsureToServer(metaAvatar)
    }
  }

  const row = await selectProfile(user.id)
  console.log("PROFILE ensure result", { userId: user.id, ok: !!row })
  return row
}

async function escalateEnsureToServer(avatarUrl: string | null): Promise<void> {
  const { data: sess } = await supabase.auth.getSession()
  const token = sess?.session?.access_token
  if (!token) {
    throw new Error("Not signed in — cannot ensure profile via server.")
  }
  let res: Response
  try {
    res = await fetch("/api/profile/ensure", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ avatarUrl }),
    })
  } catch (err) {
    // Always surface a deterministic, user-actionable message; preserve the
    // underlying error as `cause` for debugging without forcing the UI to
    // display "TypeError: Failed to fetch".
    console.warn("[profile-service] server fallback threw", err)
    throw new Error("Network error contacting profile-ensure endpoint.", {
      cause: err instanceof Error ? err : new Error(String(err)),
    })
  }
  if (!res.ok) {
    let detail = ""
    try { detail = (await res.json())?.error ?? "" } catch {}
    const msg = `Server-side profile creation failed (${res.status}${detail ? `: ${detail}` : ""}).`
    console.warn("[profile-service] server fallback non-OK", { status: res.status, detail })
    throw new Error(msg)
  }
}

export async function fetchProfile(userId: string): Promise<ProfileRow | null> {
  return await selectProfile(userId)
}

export type ProfileUpdates = {
  username?: string
  avatar_url?: string | null
  avatar_is_custom?: boolean
  artist_name?: string
}

// Single-shot UPSERT restricted to columns guaranteed to exist on every
// install of `public.profiles`: id, username, avatar_url, role. We do
// NOT touch updated_at, artist_name, or avatar_is_custom in the write
// path — they may not exist in every schema and Supabase upsert with
// onConflict:"id" only updates the columns we send, so omitting them
// is the safest possible behaviour.
//
// Throws UsernameTakenError on 23505 so callers can show a friendly
// message.
export async function updateProfile(
  freshUser: EnsureUserInput,
  updates: ProfileUpdates,
): Promise<ProfileRow> {
  // 1. Re-validate the active session up-front. Saving against a stale
  //    `freshUser.id` would either RLS-reject or silently write to the
  //    wrong row; calling getUser() here makes the failure mode loud
  //    and consistent with the rest of the auth flow.
  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData?.user) {
    throw new Error("Not signed in — please reload and sign in again.")
  }
  const userId = authData.user.id
  if (userId !== freshUser.id) {
    console.warn("PROFILE update: session userId differs from passed-in id — using session id", {
      passedIn: freshUser.id,
      session: userId,
    })
  }

  console.log("PROFILE update start", {
    userId,
    email: authData.user.email ?? freshUser.email ?? null,
    fields: Object.keys(updates),
  })

  // 2. Best-effort fetch of the existing row — drives two decisions:
  //      a) preserve `role` if the row already exists (we do NOT echo
  //         the existing role back into the payload — leaving the column
  //         out preserves it without risking a stale-overwrite race);
  //      b) keep the existing avatar_url when the caller passes an
  //         empty string / null.
  let existing: ProfileRow | null = null
  let preReadFailed = false
  try {
    existing = await selectProfile(userId)
  } catch (err) {
    preReadFailed = true
    console.warn("PROFILE update existing-fetch failed (continuing)", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
  console.log("PROFILE update existing", {
    userId,
    found: !!existing,
    preReadFailed,
    existingUsername: existing?.username ?? null,
    existingRole: existing?.role ?? null,
  })

  // 3. Build the payload using ONLY the four columns we trust to exist:
  //    id, username, avatar_url, role.
  const trimmedUsername =
    typeof updates.username === "string" ? updates.username.trim() : undefined

  const payload: Record<string, unknown> = { id: userId }

  if (trimmedUsername !== undefined) {
    payload.username = trimmedUsername
  }

  // avatar_url: only include when a non-empty value was provided. An
  // empty/whitespace/null value means "keep what's already there" — we
  // achieve that by omitting the column from the upsert payload (UPDATE
  // leaves untouched columns alone, INSERT writes NULL which is fine
  // because there's no existing avatar to preserve in that case).
  if (typeof updates.avatar_url === "string" && updates.avatar_url.trim().length > 0) {
    payload.avatar_url = updates.avatar_url.trim()
  }

  // role: never overwrite an existing row's role — a normal profile
  // edit must NEVER be able to downgrade an admin/agent account. We
  // include role ONLY when we have positively confirmed there is no
  // existing row (insert path); on a pre-read failure we omit role
  // entirely so the upsert can't accidentally overwrite a real role
  // (e.g. admin/agent) on a transient network/RLS hiccup.
  if (!preReadFailed && existing === null) {
    payload.role = "user"
  }

  // 4. Hand the write to the server-side admin endpoint. A direct
  //    client UPDATE here was silently no-op-ing under RLS — the request
  //    succeeded but no row was changed, so the modal flashed green
  //    without persisting anything. The endpoint validates the Bearer
  //    JWT, scopes the WHERE to that user id, and writes through the
  //    service-role client so the row genuinely changes.
  const { data: sess } = await supabase.auth.getSession()
  const accessToken = sess?.session?.access_token
  if (!accessToken) {
    throw new Error("Not signed in — please reload and sign in again.")
  }

  const apiPatch: Record<string, unknown> = {}
  if (typeof payload.username === "string") apiPatch.username = payload.username
  if (Object.prototype.hasOwnProperty.call(payload, "avatar_url")) {
    apiPatch.avatar_url = payload.avatar_url ?? null
  }

  let res: Response
  try {
    res = await fetch("/api/profile/update", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(apiPatch),
    })
  } catch (err) {
    console.error("PROFILE update network error", err)
    throw new Error("Could not reach the server. Please try again.")
  }

  if (!res.ok) {
    let parsed: { error?: string; message?: string } | null = null
    try {
      parsed = (await res.json()) as { error?: string; message?: string }
    } catch {
      // ignore — fall through to generic message below
    }
    console.error("PROFILE update result", {
      userId,
      ok: false,
      status: res.status,
      error: parsed?.error ?? null,
      message: parsed?.message ?? null,
    })
    if (parsed?.error === "username_taken" && trimmedUsername !== undefined) {
      throw new UsernameTakenError(trimmedUsername)
    }
    throw new Error(parsed?.message || "Profile update failed.")
  }

  // 5. Re-read through the tolerant selectProfile() so the caller
  //    always sees the canonical row (including any columns we didn't
  //    write but that may exist in the schema).
  const row = await selectProfile(userId)
  if (!row) {
    throw new Error("Profile saved but could not be read back. Please refresh.")
  }
  console.log("PROFILE update result", {
    userId,
    ok: true,
    username: row.username,
    avatar_url: row.avatar_url,
  })
  return row
}

// Append a deterministic cache-busting query param so <img src=...> reloads
// when the avatar changes even if the underlying URL is the same.
// Strips any prior ?v=/?t= so we don't accumulate them.
export function withCacheBust(url: string | null | undefined, version: string | number | null | undefined): string {
  if (!url) return ""
  const v = version ?? Date.now()
  const stripped = url
    .replace(/([?&])(?:v|t)=[^&]*(&|$)/g, (_m, p1, p2) => (p2 === "&" ? p1 : ""))
    .replace(/[?&]$/, "")
  const sep = stripped.includes("?") ? "&" : "?"
  return `${stripped}${sep}v=${encodeURIComponent(String(v))}`
}
