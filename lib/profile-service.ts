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

// UPDATE → if 0 rows: ensureProfile + retry once. On 23505 unique violation:
// throws UsernameTakenError so callers can show a friendly message.
export async function updateProfile(
  freshUser: EnsureUserInput,
  updates: ProfileUpdates,
): Promise<ProfileRow> {
  const userId = freshUser.id
  console.log("PROFILE update start", { userId, fields: Object.keys(updates) })

  const doUpdate = async (): Promise<{ data: ProfileRow[] | null; error: { code?: string; message?: string } | null }> => {
    const { data, error } = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", userId)
      .select(SELECT_COLS)
    if (error && isMissingUpdatedAt(error)) {
      const r = await supabase
        .from("profiles")
        .update(updates)
        .eq("id", userId)
        .select(SELECT_COLS_FALLBACK)
      return { data: (r.data ?? null) as ProfileRow[] | null, error: r.error }
    }
    return { data: (data ?? null) as ProfileRow[] | null, error }
  }

  const first = await doUpdate()
  if (first.error) {
    if (first.error.code === "23505" && updates.username !== undefined) {
      console.warn("PROFILE update result", { userId, ok: false, code: "23505" })
      throw new UsernameTakenError(updates.username)
    }
    console.error("PROFILE update result", { userId, ok: false, error: first.error.message })
    throw new Error(first.error.message || "Profile update failed.")
  }

  if (!first.data || first.data.length === 0) {
    console.warn("PROFILE update result", { userId, ok: false, rows: 0, action: "ensure+retry" })
    await ensureProfile(freshUser)
    const retry = await doUpdate()
    if (retry.error) {
      if (retry.error.code === "23505" && updates.username !== undefined) {
        throw new UsernameTakenError(updates.username)
      }
      throw new Error(retry.error.message || "Profile update failed.")
    }
    if (!retry.data || retry.data.length === 0) {
      throw new Error("Could not update your profile after creating it. Please try again.")
    }
    console.log("PROFILE update result", { userId, ok: true, rows: retry.data.length, retried: true })
    return retry.data[0]
  }

  console.log("PROFILE update result", { userId, ok: true, rows: first.data.length })
  return first.data[0]
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
