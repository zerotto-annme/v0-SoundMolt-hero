"use client"

import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from "react"
import { X, User, Bot, Lock, Music } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { supabase, SUPABASE_AUTH_STORAGE_KEY } from "@/lib/supabase"
import { withTimeout, isTimeoutError } from "@/lib/with-timeout"

export type UserRole = "guest" | "human" | "agent"

// Full user profile model
export interface UserProfile {
  id: string
  role: UserRole
  name: string
  username?: string
  artistName?: string
  email?: string
  avatar?: string
  avatarIsCustom?: boolean
  agentIdentifier?: string
  modelProvider?: string
  agentEndpoint?: string
  createdAt: number
  // Stats for agents
  totalPlays?: number
  totalLikes?: number
  publishedTracks?: number
}

interface AuthState {
  user: UserProfile | null
  isAuthenticated: boolean
}

interface AuthContextType {
  user: UserProfile | null
  role: UserRole
  isAuthenticated: boolean
  // True once the initial Supabase session restore has finished. Pages that
  // fetch user-specific data (avatar, my tracks, liked, etc.) MUST wait for
  // this to flip true — otherwise on first paint they see `isAuthenticated:
  // false` and either redirect away or render an empty state, then "snap"
  // into the real state once the session is restored, requiring a manual
  // refresh to see correct data.
  authReady: boolean
  // True once the public.profiles row for the current user has been fetched
  // (or definitively determined to be absent). Components that render the
  // user's display name / avatar (e.g. ProfileDropdown in the sidebar) MUST
  // gate visual output on this flag — otherwise they would render the
  // email-prefix fallback as a "fast path" name and then visibly flicker
  // to the real DB username once the profile fetch resolves. While
  // profileReady=false, render a skeleton instead.
  //
  // Lifecycle:
  //   • starts false
  //   • restoreSession sets bare auth fields (id/email) immediately so
  //     isAuthenticated flips true and authReady can flip true; profileReady
  //     stays false until fetchProfileData resolves.
  //   • on SIGNED_IN for a NEW user.id we clear the profile and reset
  //     profileReady=false, then re-enable it once the profile has loaded.
  //   • on TOKEN_REFRESHED for the same user with profileReady already
  //     true, we no-op (no refetch, no flicker).
  //   • on SIGNED_OUT we set profileReady=true (the unauthenticated UI is
  //     itself a stable rendered state — no skeleton needed).
  profileReady: boolean
  // Monotonically-increasing counter that bumps every time Supabase emits a
  // session-affecting auth event (INITIAL_SESSION, SIGNED_IN,
  // TOKEN_REFRESHED, USER_UPDATED). Components that fetch user-dependent
  // data should include this in their effect dependencies so they refetch
  // automatically right after a login/refresh — without this, post-login
  // the fetch effect doesn't re-run (user.id may already match the hook's
  // initial null→value transition that happened in a different render
  // cycle than the auth event), so the user sees stale empty state until
  // they manually reload.
  authVersion: number
  login: (role: "human" | "agent", profile?: Partial<UserProfile>) => void
  logout: () => void
  updateProfile: (updates: Partial<UserProfile>, options?: { persist?: boolean }) => void
  // Modal controls
  showSignInModal: boolean
  showAgentOnlyModal: boolean
  openSignInModal: () => void
  closeSignInModal: () => void
  openAgentOnlyModal: () => void
  closeAgentOnlyModal: () => void
  // Permission checks
  canInteract: () => boolean
  canCreate: () => boolean
  requireAuth: (callback: () => void) => void
  requireAgent: (callback: () => void) => void
}

const AuthContext = createContext<AuthContextType | null>(null)

const STORAGE_KEY = "soundmolt_user"

// Generate default avatar URL
export function generateAvatar(name: string, role: UserRole): string {
  const seed = name.replace(/\s+/g, "-").toLowerCase()
  const style = role === "agent" ? "bottts" : "avataaars"
  return `https://api.dicebear.com/7.x/${style}/svg?seed=${seed}`
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}

// Fetch username and avatar_url from public.profiles, falling back to user_metadata values.
// profileUsernameIsNull is true when the row exists but username is explicitly NULL in the DB.
// Sanitize a raw fallback (email prefix, full_name, etc.) into a value that
// satisfies the username DB constraints: ^[a-zA-Z0-9_]{3,30}$.
function sanitizeUsername(raw: string): string {
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "")
  let candidate = cleaned.slice(0, 30)
  if (candidate.length < 3) candidate = (candidate + "_user").slice(0, 30)
  return candidate
}

// Try to claim a username, appending a numeric suffix if it collides.
async function claimUsername(userId: string, base: string): Promise<string | null> {
  const seed = sanitizeUsername(base)
  const attempts = [seed, ...Array.from({ length: 5 }, (_, i) => {
    const suffix = String(Math.floor(Math.random() * 9000) + 1000)
    return (seed.slice(0, 30 - suffix.length) + suffix)
  })]
  for (const candidate of attempts) {
    const { error } = await supabase
      .from("profiles")
      .update({ username: candidate })
      .eq("id", userId)
    if (!error) return candidate
    // Unique violation (23505) → try next candidate; any other error → bail.
    if (!String(error.code || "").includes("23505") && !/duplicate key|unique/i.test(error.message || "")) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[auth] claimUsername non-collision error", { candidate, error })
      }
      return null
    }
  }
  return null
}

// Minimal shape of the Supabase auth user we rely on. Avoids importing the
// @supabase/supabase-js types into this file.
type AuthUserLike = {
  id: string
  email?: string | null
  created_at?: string
  user_metadata?: Record<string, unknown> | null
} | null | undefined

export interface MergedProfile {
  id: string
  email: string
  username: string
  artist_name: string
  avatar_url: string
  role: string
  profileUsernameIsNull: boolean
  avatarIsCustom: boolean
}

// Build a safe merged profile from an auth user + (possibly null) profile row.
// Pure / no I/O — used both before and after any heal write.
function buildMergedProfile(authUser: NonNullable<AuthUserLike>, row: Record<string, unknown> | null): MergedProfile {
  const meta = (authUser.user_metadata || {}) as Record<string, unknown>
  const metaFullName = typeof meta.full_name === "string" ? meta.full_name : undefined
  const metaName = typeof meta.name === "string" ? meta.name : undefined
  const metaAvatar = typeof meta.avatar_url === "string" ? meta.avatar_url : undefined
  const metaPicture = typeof meta.picture === "string" ? meta.picture : undefined
  const emailPrefix = authUser.email ? authUser.email.split("@")[0] : undefined

  const rowUsername = row && typeof row.username === "string" ? (row.username as string) : null
  const rowArtist = row && typeof row.artist_name === "string" ? (row.artist_name as string) : null
  const rowAvatar = row && typeof row.avatar_url === "string" ? (row.avatar_url as string) : null
  const rowRole = row && typeof row.role === "string" ? (row.role as string) : null
  const rowAvatarIsCustom = row ? (row as Record<string, unknown>).avatar_is_custom === true : false

  const username = rowUsername || metaFullName || metaName || emailPrefix || "user"
  const artist_name = rowArtist || rowUsername || metaFullName || metaName || emailPrefix || "User"
  const avatar_url = rowAvatar || metaAvatar || metaPicture || ""
  const role = rowRole || "human"

  return {
    id: authUser.id,
    email: authUser.email || "",
    username,
    artist_name,
    avatar_url,
    role,
    profileUsernameIsNull: !!row && rowUsername === null,
    avatarIsCustom: rowAvatarIsCustom,
  }
}

// Pull the avatar URL Supabase stores in user_metadata after a Google sign-in.
// Google sets `avatar_url` directly; some other OAuth providers set `picture`.
function readMetaAvatar(user: NonNullable<AuthUserLike>): string | null {
  const meta = (user.user_metadata || {}) as Record<string, unknown>
  if (typeof meta.avatar_url === "string" && meta.avatar_url) return meta.avatar_url
  if (typeof meta.picture === "string" && meta.picture) return meta.picture
  return null
}

// Result shape from `ensureProfileRow`: { ok, row?, savedUsername }.
//   ok=true  → we either created a row or one already existed.
//   ok=false → every attempt failed (e.g. RLS rejected; DB unreachable).
//   row      → the synthesized row we wrote (only useful when we did create).
type EnsureResult = {
  ok: boolean
  row: Record<string, unknown> | null
  savedUsername: string | null
}

// Idempotently guarantees a `public.profiles` row exists for `user`.
// Safe to call multiple times — uses `upsert` with `ignoreDuplicates: true`
// so it's also race-safe against the DB-side `on_auth_user_created` trigger
// and against concurrent SIGNED_IN events firing the same login flow twice.
//
// Spec mapping (per latest user request):
//   id          ← user.id
//   username    ← sanitized email-prefix (3–30 chars, [a-zA-Z0-9_])
//   role        ← "human"  (this app's equivalent of the generic "user" role;
//                            the role enum here is "human" | "agent")
//   avatar_url  ← user_metadata.avatar_url || user_metadata.picture || null
//
// Username collision is recoverable: we retry with NULL username so the row
// gets created, then asynchronously claim a suffixed username so the user
// has SOMETHING displayable. If even that fails we return ok=true with
// savedUsername=null (the SetUsername modal will surface afterwards).
// Last-resort server fallback: hits /api/profile/ensure with a Bearer token.
// That route uses the service-role admin client and bypasses RLS, so the
// row will be created even when every client-side path has failed.
// Returns the same EnsureResult shape on success/failure.
async function ensureProfileViaServer(
  user: NonNullable<AuthUserLike>,
  fallbackUsername: string,
  metaAvatar: string | null
): Promise<EnsureResult> {
  try {
    const { data: sess } = await supabase.auth.getSession()
    const token = sess?.session?.access_token
    if (!token) return { ok: false, row: null, savedUsername: null }
    const res = await fetch("/api/profile/ensure", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ avatarUrl: metaAvatar }),
    })
    if (!res.ok) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[auth] ensureProfileViaServer non-OK", { userId: user.id, status: res.status })
      }
      return { ok: false, row: null, savedUsername: null }
    }
    if (process.env.NODE_ENV !== "production") {
      console.log("[auth] ensureProfileViaServer ok", { userId: user.id })
    }
    return {
      ok: true,
      row: {
        id: user.id,
        role: "human",
        username: fallbackUsername,
        artist_name: fallbackUsername,
        avatar_url: metaAvatar,
        avatar_is_custom: false,
      },
      savedUsername: fallbackUsername,
    }
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[auth] ensureProfileViaServer threw", { userId: user.id, err })
    }
    return { ok: false, row: null, savedUsername: null }
  }
}

async function ensureProfileRow(user: NonNullable<AuthUserLike>): Promise<EnsureResult> {
  const fallbackUsername = sanitizeUsername(buildMergedProfile(user, null).username)
  const metaAvatar = readMetaAvatar(user)

  // First attempt: upsert with the sanitized username + role + avatar.
  // ignoreDuplicates=true means an existing row is a no-op (good — we don't
  // want to clobber a username the user has already set, or an avatar they
  // intentionally cleared). The trigger may have already inserted a row
  // moments ago and that's fine.
  const { error: firstErr } = await supabase
    .from("profiles")
    .upsert(
      {
        id: user.id,
        username: fallbackUsername,
        artist_name: fallbackUsername,
        role: "human",
        avatar_url: metaAvatar,
      },
      { onConflict: "id", ignoreDuplicates: true }
    )

  if (!firstErr) {
    if (process.env.NODE_ENV !== "production") {
      console.log("[auth] ensureProfileRow upsert ok", { userId: user.id, fallbackUsername })
    }
    return {
      ok: true,
      row: {
        id: user.id,
        role: "human",
        username: fallbackUsername,
        artist_name: fallbackUsername,
        avatar_url: metaAvatar,
        avatar_is_custom: false,
      },
      savedUsername: fallbackUsername,
    }
  }

  // Username collision (someone else already has this username): retry with
  // NULL username so the row is created, then opportunistically try to
  // claim a suffixed username.
  const isUnique =
    String(firstErr.code || "").includes("23505") ||
    /duplicate key|unique/i.test(firstErr.message || "")
  if (isUnique) {
    const { error: nullErr } = await supabase
      .from("profiles")
      .upsert(
        {
          id: user.id,
          username: null,
          artist_name: fallbackUsername,
          role: "human",
          avatar_url: metaAvatar,
        },
        { onConflict: "id", ignoreDuplicates: true }
      )
    if (!nullErr) {
      const claimed = await claimUsername(user.id, fallbackUsername)
      if (process.env.NODE_ENV !== "production") {
        console.log("[auth] ensureProfileRow upsert ok (NULL username)", { userId: user.id, claimed })
      }
      return {
        ok: true,
        row: {
          id: user.id,
          role: "human",
          username: claimed,
          artist_name: fallbackUsername,
          avatar_url: metaAvatar,
          avatar_is_custom: false,
        },
        savedUsername: claimed,
      }
    }
    // NULL-username retry also failed — fall through to server fallback so
    // the row still gets created via the service-role admin client.
    if (process.env.NODE_ENV !== "production") {
      console.warn("[auth] ensureProfileRow NULL-username retry failed — escalating to server", {
        userId: user.id,
        nullErr,
      })
    }
    return await ensureProfileViaServer(user, fallbackUsername, metaAvatar)
  }

  // Anything else (RLS, network, schema): escalate to the server-side
  // fallback. /api/profile/ensure uses the service-role admin client so
  // it bypasses RLS entirely — the row WILL be created as long as the
  // server has the service-role key configured.
  if (process.env.NODE_ENV !== "production") {
    console.warn("[auth] ensureProfileRow client upsert failed — escalating to server", {
      userId: user.id,
      firstErr,
    })
  }
  return await ensureProfileViaServer(user, fallbackUsername, metaAvatar)
}

async function fetchProfileData(authUser: AuthUserLike): Promise<MergedProfile | null> {
  // 1. Get current authenticated user first (callers pass it in; fall back to
  //    Supabase if missing so the function is self-sufficient per spec).
  let user: NonNullable<AuthUserLike> | null = authUser ?? null
  if (!user) {
    const { data, error: getUserError } = await supabase.auth.getUser()
    if (process.env.NODE_ENV !== "production") {
      console.log("[auth] fetchProfileData getUser →", { user: data?.user, error: getUserError })
    }
    user = (data?.user as NonNullable<AuthUserLike>) ?? null
  }
  if (!user) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[auth] fetchProfileData: no authenticated user")
    }
    return null
  }

  if (process.env.NODE_ENV !== "production") {
    console.log("[auth] fetchProfileData auth user:", { id: user.id, email: user.email, user_metadata: user.user_metadata })
  }

  // Internal helper: SELECT the row by user id. Returns:
  //   { row, error }  — same as Supabase client.
  const selectRow = async () =>
    supabase
      .from("profiles")
      .select("id, role, username, artist_name, avatar_url, avatar_is_custom")
      .eq("id", user!.id)
      .maybeSingle()

  try {
    // 2. First read.
    let { data, error } = await selectRow()
    if (process.env.NODE_ENV !== "production") {
      console.log("[auth] fetchProfileData profile query result:", { data, error })
    }

    // 3. If the row doesn't exist OR the read errored, try to ensure-then-reread.
    //    This is the "permanently fix profile creation" path: we never trust the
    //    DB trigger to have run, and we never silently fall through to a
    //    metadata-only profile without first attempting an upsert.
    if (!data) {
      const ensured = await ensureProfileRow(user)
      if (ensured.ok) {
        // Re-SELECT to pick up the actual stored row (handles the case where
        // the trigger had already inserted a row with different values).
        const reread = await selectRow()
        if (reread.data) {
          data = reread.data
          error = null
        } else if (ensured.row) {
          // Re-read returned nothing (RLS quirk) — synthesize from what we wrote.
          data = ensured.row as unknown as typeof data
          error = null
        }
      }
      // If ensure failed, fall through with whatever we had.
    }

    if (data) {
      // 4. Row exists — heal NULL username/artist_name/avatar_url where possible.
      const fallbackUsername = buildMergedProfile(user, null).username
      let claimedUsername: string | null = null
      if (data.username == null) {
        claimedUsername = await claimUsername(user.id, fallbackUsername)
        if (process.env.NODE_ENV !== "production") {
          console.log("[auth] heal username →", { claimedUsername })
        }
      }
      const effectiveUsername = (data.username as string | null) || claimedUsername || fallbackUsername
      const otherPatch: Record<string, unknown> = {}
      if ((data as Record<string, unknown>).artist_name == null) {
        otherPatch.artist_name = effectiveUsername
      }
      if ((data as Record<string, unknown>).avatar_url == null) {
        const metaAvatar = readMetaAvatar(user) || ""
        if (metaAvatar) otherPatch.avatar_url = metaAvatar
      }
      if (Object.keys(otherPatch).length > 0) {
        const { error: patchError } = await supabase
          .from("profiles")
          .update(otherPatch)
          .eq("id", user.id)
        if (process.env.NODE_ENV !== "production") {
          console.log("[auth] healed NULL profile fields", { otherPatch, patchError })
        }
        if (!patchError) {
          if (otherPatch.artist_name != null) (data as Record<string, unknown>).artist_name = otherPatch.artist_name
          if (otherPatch.avatar_url != null) (data as Record<string, unknown>).avatar_url = otherPatch.avatar_url
        }
      }
      if (claimedUsername) {
        (data as Record<string, unknown>).username = claimedUsername
      }
      const merged = buildMergedProfile(user, data as Record<string, unknown>)
      // If we couldn't claim a username, still surface the SetUsername modal.
      merged.profileUsernameIsNull = data.username === null && claimedUsername == null
      if (process.env.NODE_ENV !== "production") {
        console.log("[auth] fetchProfileData merged:", merged)
      }
      return merged
    }

    // 5. Last resort: still no row after ensure-then-reread. Return a
    //    metadata-only merged profile so the UI doesn't crash. The next
    //    sign-in will attempt ensureProfileRow again.
    if (process.env.NODE_ENV !== "production") {
      console.warn("[auth] fetchProfileData: no row even after ensure — returning metadata-only profile", {
        userId: user.id,
        readError: error,
      })
    }
    return buildMergedProfile(user, null)
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[auth] fetchProfileData unexpected error for user", user.id, err)
    }
    const merged = buildMergedProfile(user, null)
    return merged
  }
}


export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
  })
  const [showSignInModal, setShowSignInModal] = useState(false)
  const [showAgentOnlyModal, setShowAgentOnlyModal] = useState(false)
  const [showSetUsernameModal, setShowSetUsernameModal] = useState(false)
  const [isHydrated, setIsHydrated] = useState(false)
  // See `profileReady` doc on AuthContextType for the contract. Sidebar
  // (ProfileDropdown) gates display-name rendering on this flag to avoid
  // the well-known "email prefix → DB username" flicker.
  const [profileReady, setProfileReady] = useState(false)
  // See `authVersion` doc on AuthContextType for why this exists.
  const [authVersion, setAuthVersion] = useState(0)
  const router = useRouter()
  // Stable ref so realtime callbacks can read the latest user without adding
  // `state.user` to every effect dependency array (which would cause unwanted
  // subscription teardowns on each profile update).
  const userRef = useRef(state.user)
  useEffect(() => { userRef.current = state.user }, [state.user])
  // Stable ref to profileReady so the once-registered onAuthStateChange
  // listener can read the LATEST value without re-subscribing on every flip.
  // Used to no-op TOKEN_REFRESHED for an already-loaded same user (the
  // primary cause of the post-login flicker we're fixing).
  const profileReadyRef = useRef(profileReady)
  useEffect(() => { profileReadyRef.current = profileReady }, [profileReady])
  // Epoch counter incremented on every auth event. Async profile-hydration
  // work captures the epoch at start; if the epoch has changed by the time
  // hydration resolves, the result is discarded. This prevents a slow
  // SIGNED_IN profile fetch from overwriting a subsequent SIGNED_OUT.
  const authEpochRef = useRef(0)

  // Restore session from Supabase on mount, fall back to localStorage for agents.
  //
  // ROBUSTNESS NOTES:
  //   • `setIsHydrated(true)` is in a finally so it ALWAYS fires, no matter
  //     what throws. If `authReady` ever stays false the whole app hangs
  //     (admin page, feed, my-tracks all wait on it). We defend that.
  //   • `fetchProfileData` is wrapped in a 10s timeout so a stuck `profiles`
  //     SELECT can't block hydration. On timeout we fall back to bare auth
  //     metadata — the user gets a working session immediately and
  //     `onAuthStateChange` will fill in the missing fields shortly after.
  //   • As a last-resort safety net we schedule a 5s timer that forces
  //     `isHydrated = true` even if the entire restoreSession promise
  //     somehow hangs (network blackhole, navigator.locks contention, etc).
  useEffect(() => {
    let cancelled = false

    // Last-resort hydration safety net. If `restoreSession()` hasn't
    // resolved within 5s for any reason — including total network failure
    // or a wedged Supabase client lock — we force `authReady` to true so
    // the UI can at least render the unauthenticated path (Sign in card,
    // landing page, etc) instead of staying on a permanent spinner. We
    // also flip profileReady=true so the sidebar exits the skeleton state
    // (worst case: it shows the email-prefix fallback, which is far less
    // alarming than a permanent shimmer).
    const hydrateGuardTimer = setTimeout(() => {
      if (cancelled) return
      console.warn("[auth] AUTH HYDRATION GUARD fired — forcing isHydrated=true after 5s")
      setIsHydrated(true)
      setProfileReady(true)
    }, 5000)

    // Build the final UserProfile for a successfully hydrated human session.
    // Spec: "fallback to user.email only AFTER profile fetch completes and
    // no username exists" — that's exactly the precedence we apply here.
    const buildHumanProfile = (
      sbUser: NonNullable<AuthUserLike>,
      merged: MergedProfile | null,
    ): { profile: UserProfile; profileUsernameIsNull: boolean; chosenSource: string } => {
      const profileUsernameIsNull = merged?.profileUsernameIsNull ?? false
      const username = merged?.username || sbUser.email?.split("@")[0] || "User"
      const avatar = merged?.avatar_url || generateAvatar(username, "human")
      return {
        profile: {
          id: sbUser.id,
          role: "human",
          name: username,
          username: profileUsernameIsNull ? undefined : username,
          artistName: merged?.artist_name,
          email: sbUser.email ?? undefined,
          avatar,
          avatarIsCustom: merged?.avatarIsCustom ?? false,
          createdAt: new Date(sbUser.created_at ?? Date.now()).getTime(),
        },
        profileUsernameIsNull,
        chosenSource: merged?.username
          ? "profile.username"
          : (sbUser.email ? "email_prefix_fallback" : "literal_user"),
      }
    }

    const restoreSession = async () => {
      // Capture epoch at start; if onAuthStateChange fires (e.g. SIGNED_OUT)
      // while we're hydrating, the captured epoch will lag behind
      // authEpochRef.current and we drop our setState below. This prevents
      // restoreSession from resurrecting a signed-out user. (Architect feedback.)
      const startEpoch = authEpochRef.current
      try {
        // Bound the initial getSession() too — on Vercel cold starts this
        // has been observed to wait on a stale lock. 5s is generous; the
        // outer hydrateGuardTimer is the absolute backstop.
        const sessionResult = await withTimeout(
          supabase.auth.getSession(),
          5000,
          "supabase.auth.getSession"
        )
        const session = sessionResult.data.session
        if (session?.user) {
          const sbUser = session.user
          console.log("AUTH_EVENT", {
            kind: "RESTORE_SESSION",
            userId: sbUser.id,
            userEmail: sbUser.email ?? null,
          })
          // Spec: do NOT show stale or email-derived placeholder names while
          // the profile is loading. Set bare auth fields immediately so
          //   • isAuthenticated flips true (My Tracks etc unblock)
          //   • user.id is available for downstream fetches
          //   • profileReady stays false → sidebar renders skeleton
          if (!cancelled && startEpoch === authEpochRef.current) {
            setProfileReady(false)
            setState({
              user: {
                id: sbUser.id,
                role: "human",
                name: "",
                email: sbUser.email ?? undefined,
                avatar: "",
                createdAt: new Date(sbUser.created_at).getTime(),
              },
              isAuthenticated: true,
            })
            // Flip authReady early — pages that gate on (authReady && user.id)
            // can start their own data fetches in parallel with profile load.
            clearTimeout(hydrateGuardTimer)
            setIsHydrated(true)
          }

          console.log("[auth] profile fetch started", {
            userId: sbUser.id,
            source: "restoreSession",
          })
          let merged: Awaited<ReturnType<typeof fetchProfileData>> = null
          try {
            merged = await withTimeout(
              fetchProfileData(sbUser),
              10000,
              "fetchProfileData (restoreSession)"
            )
          } catch (err) {
            console.warn("[auth] restoreSession: fetchProfileData failed/timeout — falling back to email-prefix", err)
          }
          if (cancelled) return
          if (startEpoch !== authEpochRef.current) {
            console.log("[auth] restoreSession: dropping stale write — auth event fired during hydration", { startEpoch, currentEpoch: authEpochRef.current })
            return
          }
          const { profile, profileUsernameIsNull, chosenSource } = buildHumanProfile(sbUser, merged)
          console.log("[auth] profile username result", {
            userId: sbUser.id,
            username: merged?.username ?? null,
            fallbackUsedEmail: !merged?.username,
            source: "restoreSession",
          })
          setState({ user: profile, isAuthenticated: true })
          setProfileReady(true)
          console.log("[auth] sidebar displayName chosen", {
            userId: sbUser.id,
            displayName: profile.name,
            source: chosenSource,
          })
          setAuthVersion((v) => {
            const next = v + 1
            console.log("[auth] authVersion bumped (restoreSession)", { event: "RESTORE_SESSION", authVersion: next, userId: sbUser.id })
            return next
          })
          if (profileUsernameIsNull) setShowSetUsernameModal(true)
        } else {
          console.log("AUTH_EVENT", { kind: "RESTORE_SESSION", userId: null, userEmail: null })
          // Fall back to localStorage for agent sessions
          const stored = localStorage.getItem(STORAGE_KEY)
          if (stored) {
            const user = JSON.parse(stored) as UserProfile
            if (user.role === "agent") {
              setState({ user, isAuthenticated: true })
            }
          }
          // No human session and no agent: render unauthenticated UI without
          // a sidebar skeleton. profileReady=true means "no profile to load".
          setProfileReady(true)
        }
      } catch (err) {
        console.warn("[auth] restoreSession failed — falling back to localStorage", err)
        try {
          const stored = localStorage.getItem(STORAGE_KEY)
          if (stored) {
            const user = JSON.parse(stored) as UserProfile
            if (user.role === "agent") {
              setState({ user, isAuthenticated: true })
            }
          }
        } catch {
          localStorage.removeItem(STORAGE_KEY)
        }
        // Don't keep the sidebar in a skeleton state forever on error.
        setProfileReady(true)
      } finally {
        // CRITICAL: this MUST always run. authReady=false freezes the app.
        if (!cancelled) {
          clearTimeout(hydrateGuardTimer)
          setIsHydrated(true)
        }
      }
    }

    restoreSession()

    // Subscribe to Supabase auth state changes.
    //
    // CRITICAL: this listener is intentionally NOT async. supabase-js holds
    // its internal auth lock while awaiting the listener, and any
    // `supabase.from(...)` call made from inside that await blocks for the
    // full lock window (observed: ~10s). That's exactly what was making
    // `fetchProfileData` time out on every SIGNED_IN — the timeout fired
    // milliseconds before the query would have completed, so we threw the
    // real profile away and fell back to email-prefix + dicebear avatar
    // (i.e. wrong username AND wrong avatar until a manual refresh).
    //
    // Fix: do all synchronous bookkeeping inline, then defer the
    // profile-fetch async work via `setTimeout(0)` so it runs OUTSIDE the
    // auth-lock callstack. The query then completes in its normal
    // ~200-500ms and we apply the real profile (username + avatar) in a
    // single setState — exactly what the spec calls for.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // Bump the epoch FIRST so any in-flight async work from the previous
      // event is invalidated before we kick off new async work below.
      const myEpoch = ++authEpochRef.current
      console.log("AUTH_EVENT", {
        event,
        hasSession: !!session,
        userId: session?.user?.id ?? null,
        userEmail: session?.user?.email ?? null,
        epoch: myEpoch,
      })

      // Safety net: any auth event also flips authReady=true. If
      // restoreSession somehow stalled before reaching its finally, this
      // recovers us as soon as Supabase fires INITIAL_SESSION/SIGNED_OUT/etc.
      // (Spec: "authReady must become true after INITIAL_SESSION and SIGNED_OUT".)
      setIsHydrated(true)

      if (event === "SIGNED_OUT") {
        // Spec: "SIGNED_OUT must clear user/profile but not freeze app".
        setState(prev => {
          if (prev.user?.role === "agent") return prev
          return { user: null, isAuthenticated: false }
        })
        // Unauthenticated UI is itself a stable rendered state — flip
        // profileReady=true so the sidebar shows the Login button instead
        // of staying on a permanent skeleton.
        setProfileReady(true)
        setShowSetUsernameModal(false)
        setAuthVersion((v) => {
          const next = v + 1
          console.log("[auth] authVersion bumped (SIGNED_OUT)", { event, authVersion: next })
          return next
        })
        return
      }

      if (
        session?.user &&
        (event === "SIGNED_IN" ||
          event === "TOKEN_REFRESHED" ||
          event === "INITIAL_SESSION" ||
          event === "USER_UPDATED")
      ) {
        const sbUser = session.user
        const prevUser = userRef.current

        // FLICKER GUARD: TOKEN_REFRESHED / INITIAL_SESSION on a user whose
        // profile is already loaded must NOT refetch — that's the path
        // that previously overwrote the real DB username with the
        // email-prefix fallback whenever the profiles SELECT had a
        // transient slow response. Bail early.
        if (
          (event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") &&
          prevUser?.id === sbUser.id &&
          profileReadyRef.current
        ) {
          console.log("[auth] no-op auth event for known ready user", {
            event,
            userId: sbUser.id,
          })
          return
        }

        // Spec: "On SIGNED_IN — clear old profile, set user, fetch fresh
        // profile once". For a NEW user (or first SIGNED_IN), wipe any
        // previous profile fields and reset profileReady=false so the
        // sidebar renders a skeleton instead of any stale or
        // email-derived placeholder. We KEEP isAuthenticated=true and
        // we KEEP user.id populated so My Tracks / Liked / etc can fetch
        // in parallel with the profile load.
        //
        // Spec point 4: "do not rely on stale localStorage avatar" — we
        // explicitly null `avatar` here so any previous avatar (from a
        // prior session in the same tab) cannot leak into the next user's
        // first paint.
        if (prevUser?.id !== sbUser.id) {
          setProfileReady(false)
          setState({
            user: {
              id: sbUser.id,
              role: "human",
              name: "",
              email: sbUser.email ?? undefined,
              avatar: "",
              createdAt: new Date(sbUser.created_at).getTime(),
            },
            isAuthenticated: true,
          })
        } else if (event === "SIGNED_IN") {
          // Same user, fresh sign-in (e.g. silent re-issue) — re-fetch
          // the profile from scratch to pick up any server-side changes.
          setProfileReady(false)
        }

        console.log("[auth] profile fetch started", {
          userId: sbUser.id,
          source: event,
        })

        // Defer the actual profile fetch OUTSIDE the auth lock. See the
        // big comment at the top of this listener for why.
        setTimeout(async () => {
          // Outer try/finally so an unexpected throw anywhere in the
          // deferred body still flips profileReady=true (within epoch),
          // preventing a permanent sidebar skeleton on a freak error.
          try {
            let merged: Awaited<ReturnType<typeof fetchProfileData>> = null
            try {
              merged = await withTimeout(
                fetchProfileData(sbUser),
                10000,
                "fetchProfileData (onAuthStateChange)"
              )
            } catch (err) {
              console.warn("[auth] onAuthStateChange: fetchProfileData failed/timeout — falling back to email-prefix", err)
            }

            // Stale-event guard: if another auth event (e.g. SIGNED_OUT)
            // fired while we were awaiting profile data, drop this result so
            // we don't resurrect a stale user. (Architect feedback.)
            if (myEpoch !== authEpochRef.current) {
              console.log("[auth] dropping stale profile result", { event, myEpoch, currentEpoch: authEpochRef.current })
              return
            }

            const { profile, profileUsernameIsNull, chosenSource } = buildHumanProfile(sbUser, merged)
            console.log("[auth] profile username result", {
              userId: sbUser.id,
              username: merged?.username ?? null,
              avatarUrl: merged?.avatar_url ?? null,
              fallbackUsedEmail: !merged?.username,
              source: event,
            })
            // Single setState: username AND avatar land in the same render
            // tick, so the sidebar (and anywhere else reading user.avatar)
            // updates them together — spec point 2 + 3.
            setState({ user: profile, isAuthenticated: true })
            console.log("[auth] sidebar displayName chosen", {
              userId: sbUser.id,
              displayName: profile.name,
              avatar: profile.avatar,
              source: chosenSource,
            })
            setAuthVersion((v) => {
              const next = v + 1
              console.log("[auth] authVersion bumped", { event, authVersion: next, userId: sbUser.id })
              return next
            })
            if (profileUsernameIsNull) setShowSetUsernameModal(true)
            else setShowSetUsernameModal(false)
          } catch (err) {
            console.error("[auth] deferred profile apply failed", err)
          } finally {
            // Always release the skeleton — but only if our epoch is still
            // current, so SIGNED_OUT doesn't get its profileReady=true
            // overwritten by a stale-event finally.
            if (myEpoch === authEpochRef.current) {
              setProfileReady(true)
            }
          }
        }, 0)
      }
    })

    return () => {
      cancelled = true
      clearTimeout(hydrateGuardTimer)
      subscription.unsubscribe()
    }
  }, [])

  // Persist agent sessions to localStorage
  useEffect(() => {
    if (!isHydrated) return

    if (state.user?.role === "agent") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.user))
    } else if (!state.user) {
      localStorage.removeItem(STORAGE_KEY)
    }
  }, [state.user, isHydrated])

  const login = useCallback((role: "human" | "agent", profile?: Partial<UserProfile>) => {
    // FLICKER FIX: for the human path do NOT fabricate a display name from
    // email when the caller didn't provide one. The auth listener will
    // shortly fire SIGNED_IN, fetch the real public.profiles row, and
    // overwrite this state. Until then the sidebar (ProfileDropdown) gates
    // on profileReady=false and renders a skeleton — not the email prefix.
    //
    // The signup path DOES pass a real `username` (the one the user
    // chose), so it lands here as `profile.username` and we honour it.
    const explicitName =
      profile?.name ||
      (role === "agent" ? profile?.artistName : profile?.username)

    const user: UserProfile = {
      id: profile?.id || `user_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      role,
      // For human with no real username yet → empty string + skeleton via
      // profileReady=false. For agent we still need a name immediately
      // (no profile fetch follows) so we keep the legacy fallback there.
      name: explicitName || (role === "agent" ? "User" : ""),
      username: profile?.username,
      artistName: profile?.artistName,
      email: profile?.email,
      avatar:
        profile?.avatar ||
        (explicitName ? generateAvatar(explicitName, role) : ""),
      agentIdentifier: profile?.agentIdentifier,
      modelProvider: profile?.modelProvider,
      agentEndpoint: profile?.agentEndpoint,
      createdAt: profile?.createdAt || Date.now(),
      totalPlays: role === "agent" ? 0 : undefined,
      totalLikes: role === "agent" ? 0 : undefined,
      publishedTracks: role === "agent" ? 0 : undefined,
    }

    setState({ user, isAuthenticated: true })

    if (role === "agent") {
      // Agents have no DB profile fetch — their state IS the final state.
      setProfileReady(true)
    } else {
      // Human: only consider profile "ready" right now if the caller
      // already supplied a real username (signup path). Otherwise wait
      // for SIGNED_IN → fetchProfileData to flip it true.
      setProfileReady(!!profile?.username)
    }

    console.log("AUTH_EVENT", {
      kind: "MANUAL_LOGIN",
      role,
      userId: user.id,
      userEmail: user.email ?? null,
      hasUsername: !!profile?.username,
    })

    // Bump for the agent login path too — Supabase's onAuthStateChange
    // doesn't fire for non-Supabase agent sessions, so dependent hooks
    // would otherwise miss the transition.
    setAuthVersion((v) => {
      const next = v + 1
      if (process.env.NODE_ENV !== "production") {
        console.log("[auth] authVersion bumped (login)", { event: "MANUAL_LOGIN", authVersion: next, userId: user.id })
      }
      return next
    })
  }, [])

  const logout = useCallback(async () => {
    const currentRole = state.user?.role
    console.log("[auth] signOut started", { role: currentRole })
    setState({ user: null, isAuthenticated: false })
    setAuthVersion((v) => {
      const next = v + 1
      if (process.env.NODE_ENV !== "production") {
        console.log("[auth] authVersion bumped (logout)", { event: "MANUAL_LOGOUT", authVersion: next })
      }
      return next
    })
    localStorage.removeItem(STORAGE_KEY)
    if (typeof window !== "undefined") {
      try { window.dispatchEvent(new CustomEvent("soundmolt:logout")) } catch {}
    }
    if (currentRole === "human") {
      // Always release the Supabase auth client lock — if signOut hangs (a
      // known issue when navigator.locks is contended on Vercel), the next
      // signInWithPassword would queue behind it forever and the modal
      // would stay stuck on "Signing in...". Bound it with a timeout AND
      // catch any error so local cleanup always wins.
      try {
        await withTimeout(supabase.auth.signOut(), 8000, "supabase.auth.signOut")
        console.log("[auth] signOut done")
      } catch (err) {
        console.warn("[auth] signOut failed/timeout — proceeding with local cleanup", err)
        // Defensive: nuke any lingering Supabase auth tokens from
        // localStorage so the next signIn starts from a clean slate.
        // The exact key is configured in lib/supabase.ts; we also clear
        // the legacy `sb-*` / `supabase.auth*` shapes in case anything
        // (older sessions, refresh-token sidecars) is hanging around.
        if (typeof window !== "undefined") {
          try {
            localStorage.removeItem(SUPABASE_AUTH_STORAGE_KEY)
            for (let i = localStorage.length - 1; i >= 0; i--) {
              const key = localStorage.key(i)
              if (key && (key.startsWith("sb-") || key.includes("supabase.auth"))) {
                localStorage.removeItem(key)
              }
            }
          } catch {}
        }
      }
    }
    router.push("/")
  }, [router, state.user?.role])

  const updateProfile = useCallback((updates: Partial<UserProfile>, options?: { persist?: boolean }) => {
    setState(prev => {
      if (!prev.user) return prev

      if (
        options?.persist &&
        updates.avatar !== undefined &&
        prev.user.role === "human" &&
        prev.user.id
      ) {
        supabase
          .from("profiles")
          .upsert(
            { id: prev.user.id, role: "human", avatar_url: updates.avatar || null },
            { onConflict: "id" }
          )
          .then(({ error }) => {
            if (error) {
              console.error("[auth-context] Failed to persist avatar_url to profiles:", error.message)
            }
          })
      }

      return {
        ...prev,
        user: { ...prev.user, ...updates }
      }
    })
  }, [])

  // BroadcastChannel for cross-tab profile sync.
  // The channel is opened once the user is a logged-in human and closed on
  // cleanup.  The real-time Supabase subscription (below) posts to it whenever
  // it receives a profile update; every other tab receives the message and
  // applies the same updates without a reload.
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null)

  useEffect(() => {
    const userId = state.user?.id
    if (!userId || state.user?.role !== "human") return

    const bc = typeof BroadcastChannel !== "undefined"
      ? new BroadcastChannel(`profile-sync-${userId}`)
      : null
    broadcastChannelRef.current = bc

    if (bc) {
      bc.onmessage = (event: MessageEvent) => {
        const raw = event.data
        if (!raw || typeof raw !== "object") return
        // Only apply the subset of fields that a profile sync message may carry.
        const allowed: Array<keyof UserProfile> = ["username", "name", "avatar"]
        const updates: Partial<UserProfile> = {}
        for (const key of allowed) {
          if (key in raw) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (updates as any)[key] = (raw as any)[key]
          }
        }
        if (Object.keys(updates).length > 0) {
          updateProfile(updates)
        }
      }
    }

    return () => {
      bc?.close()
      broadcastChannelRef.current = null
    }
  }, [state.user?.id, state.user?.role, updateProfile])

  // Real-time subscription to the logged-in user's profiles row so that
  // username / avatar changes made elsewhere in the same session are reflected
  // immediately without a page reload.
  useEffect(() => {
    const userId = state.user?.id
    if (!userId || state.user?.role !== "human") return

    const channel = supabase
      .channel(`profile-changes-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "profiles",
          filter: `id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as { username?: string | null; avatar_url?: string | null } | null
          if (!row) return
          const updates: Partial<UserProfile> = {}
          if (row.username) {
            updates.username = row.username
            updates.name = row.username
          }
          // When avatar_url is cleared (null/empty), fall back to the generated avatar
          // using the latest known username from the row or current state.
          if (row.avatar_url) {
            updates.avatar = row.avatar_url
          } else if ("avatar_url" in row) {
            const fallbackName = row.username || userRef.current?.username || userRef.current?.name || "User"
            updates.avatar = generateAvatar(fallbackName, "human")
          }
          if (Object.keys(updates).length > 0) {
            updateProfile(updates)
            // Broadcast the same update to all other tabs so they stay in sync.
            broadcastChannelRef.current?.postMessage(updates)
          }
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [state.user?.id, state.user?.role, updateProfile])

  const canInteract = useCallback(() => {
    return state.isAuthenticated
  }, [state.isAuthenticated])

  const canCreate = useCallback(() => {
    return state.isAuthenticated
  }, [state.isAuthenticated])

  const requireAuth = useCallback((callback: () => void) => {
    if (!state.isAuthenticated) {
      setShowSignInModal(true)
      return
    }
    callback()
  }, [state.isAuthenticated])

  const requireAgent = useCallback((callback: () => void) => {
    if (!state.isAuthenticated) {
      setShowSignInModal(true)
      return
    }
    callback()
  }, [state.isAuthenticated])

  const role = state.user?.role || "guest"

  return (
    <AuthContext.Provider
      value={{
        user: state.user,
        role,
        isAuthenticated: state.isAuthenticated,
        authReady: isHydrated,
        profileReady,
        authVersion,
        login,
        logout,
        updateProfile,
        showSignInModal,
        showAgentOnlyModal,
        openSignInModal: () => setShowSignInModal(true),
        closeSignInModal: () => setShowSignInModal(false),
        openAgentOnlyModal: () => setShowAgentOnlyModal(true),
        closeAgentOnlyModal: () => setShowAgentOnlyModal(false),
        canInteract,
        canCreate,
        requireAuth,
        requireAgent,
      }}
    >
      {children}

      {/* Sign In Modal */}
      {showSignInModal && (
        <SignInModal
          onClose={() => setShowSignInModal(false)}
          onLogin={(role, profile) => {
            login(role, profile)
            setShowSignInModal(false)
          }}
        />
      )}

      {/* Agent Only Modal */}
      {showAgentOnlyModal && (
        <AgentOnlyModal onClose={() => setShowAgentOnlyModal(false)} />
      )}

      {/* Set Username Modal — shown when profile has a NULL username */}
      {showSetUsernameModal && state.user && (
        <SetUsernameModal
          userId={state.user.id}
          onSaved={(username) => {
            updateProfile({ username, name: username })
            setShowSetUsernameModal(false)
          }}
        />
      )}
    </AuthContext.Provider>
  )
}

// Sign In Modal Component
function SignInModal({
  onClose,
  onLogin
}: {
  onClose: () => void
  onLogin: (role: "human" | "agent", profile?: Partial<UserProfile>) => void
}) {
  const [mode, setMode] = useState<"choose" | "human" | "agent">("choose")
  const [humanSubMode, setHumanSubMode] = useState<"signin" | "signup">("signin")
  const [humanForm, setHumanForm] = useState({
    username: "",
    email: "",
    password: "",
    confirmPassword: "",
  })
  const [humanErrors, setHumanErrors] = useState<{
    username?: string
    email?: string
    password?: string
    confirmPassword?: string
    general?: string
  }>({})
  const [humanLoading, setHumanLoading] = useState(false)
  const [forgotPasswordMode, setForgotPasswordMode] = useState(false)
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState("")
  const [forgotPasswordStatus, setForgotPasswordStatus] = useState<"idle" | "success" | "error">("idle")
  const [forgotPasswordError, setForgotPasswordError] = useState("")
  const [forgotPasswordLoading, setForgotPasswordLoading] = useState(false)

  const [agentForm, setAgentForm] = useState({ artistName: "", identifier: "", provider: "" })

  const [usernameStatus, setUsernameStatus] = useState<"idle" | "too_short" | "too_long" | "invalid" | "checking" | "available" | "taken" | "error" | "rate_limited">("idle")
  const usernameDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/
  const USERNAME_MIN = 3
  const USERNAME_MAX = 30

  useEffect(() => {
    const username = humanForm.username.trim()

    if (humanSubMode !== "signup" || !username) {
      setUsernameStatus("idle")
      return
    }

    if (username.length < USERNAME_MIN) {
      setUsernameStatus("too_short")
      if (usernameDebounceRef.current) clearTimeout(usernameDebounceRef.current)
      return
    }

    if (username.length > USERNAME_MAX) {
      setUsernameStatus("too_long")
      if (usernameDebounceRef.current) clearTimeout(usernameDebounceRef.current)
      return
    }

    if (!USERNAME_REGEX.test(username)) {
      setUsernameStatus("invalid")
      if (usernameDebounceRef.current) clearTimeout(usernameDebounceRef.current)
      return
    }

    setUsernameStatus("checking")

    if (usernameDebounceRef.current) {
      clearTimeout(usernameDebounceRef.current)
    }

    let cancelled = false

    usernameDebounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/username-available?username=${encodeURIComponent(username)}`
        )

        if (cancelled) return

        if (res.status === 429) {
          setUsernameStatus("rate_limited")
          return
        }

        if (!res.ok) {
          setUsernameStatus("error")
          return
        }

        const json = await res.json()
        if (json.available === true) {
          setUsernameStatus("available")
        } else if (json.reason === "invalid_format") {
          setUsernameStatus("invalid")
        } else {
          setUsernameStatus("taken")
        }
      } catch {
        if (!cancelled) setUsernameStatus("error")
      }
    }, 500)

    return () => {
      cancelled = true
      if (usernameDebounceRef.current) {
        clearTimeout(usernameDebounceRef.current)
      }
    }
  }, [humanForm.username, humanSubMode])

  const validateHumanForm = (): boolean => {
    const errors: typeof humanErrors = {}

    if (humanSubMode === "signup" && !humanForm.username.trim()) {
      errors.username = "Username is required"
    } else if (humanSubMode === "signup" && usernameStatus === "too_short") {
      errors.username = `Username must be at least ${USERNAME_MIN} characters`
    } else if (humanSubMode === "signup" && usernameStatus === "too_long") {
      errors.username = `Username must be at most ${USERNAME_MAX} characters`
    } else if (humanSubMode === "signup" && usernameStatus === "invalid") {
      errors.username = "Only letters, numbers, and underscores allowed"
    } else if (humanSubMode === "signup" && usernameStatus === "taken") {
      errors.username = "That username is already taken. Please choose a different one."
    }

    if (!humanForm.email.trim()) {
      errors.email = "Email is required"
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(humanForm.email)) {
      errors.email = "Please enter a valid email address"
    }

    if (!humanForm.password) {
      errors.password = "Password is required"
    } else if (humanSubMode === "signup" && humanForm.password.length < 6) {
      errors.password = "Password must be at least 6 characters"
    }

    if (humanSubMode === "signup") {
      if (!humanForm.confirmPassword) {
        errors.confirmPassword = "Please confirm your password"
      } else if (humanForm.password !== humanForm.confirmPassword) {
        errors.confirmPassword = "Passwords do not match"
      }
    }

    setHumanErrors(errors)
    return Object.keys(errors).length === 0
  }

  const isHumanFormValid = (): boolean => {
    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(humanForm.email)
    if (humanSubMode === "signup") {
      const usernameOk = humanForm.username.trim() !== "" &&
        usernameStatus !== "too_short" &&
        usernameStatus !== "too_long" &&
        usernameStatus !== "invalid" &&
        usernameStatus !== "taken" &&
        usernameStatus !== "checking"

      return (
        usernameOk &&
        emailValid &&
        humanForm.password.length >= 6 &&
        humanForm.confirmPassword !== "" &&
        humanForm.password === humanForm.confirmPassword
      )
    }
    return emailValid && humanForm.password !== ""
  }

  const handleHumanSubmit = async () => {
    if (!validateHumanForm()) return

    setHumanLoading(true)
    setHumanErrors({})

    try {
      if (humanSubMode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: humanForm.email,
          password: humanForm.password,
          options: {
            data: { username: humanForm.username, role: "human" },
          },
        })

        if (error) {
          if (error.message.toLowerCase().includes("already registered") || error.message.toLowerCase().includes("already exists")) {
            setHumanErrors({ email: "An account with this email already exists" })
          } else {
            setHumanErrors({ general: error.message })
          }
          return
        }

        if (data.user) {
          // If no session, email confirmation is required — do not log in yet
          if (!data.session) {
            setHumanErrors({ general: "Account created! Please check your email to confirm your address, then sign in." })
            return
          }

          const signUpAvatarUrl = data.user.user_metadata?.avatar_url ?? null
          const { error: profileError } = await supabase.from("profiles").upsert({
            id: data.user.id,
            username: humanForm.username,
            role: "human",
            ...(signUpAvatarUrl !== null ? { avatar_url: signUpAvatarUrl } : {}),
          })

          if (profileError) {
            if (profileError.code === "23505") {
              setHumanErrors({ username: "That username is already taken. Please choose a different one." })
            } else {
              setHumanErrors({ general: "Account created but profile could not be saved. Please try signing in." })
            }
            return
          }

          const name = humanForm.username
          onLogin("human", {
            id: data.user.id,
            username: humanForm.username,
            name,
            email: humanForm.email,
            avatar: generateAvatar(name, "human"),
            createdAt: new Date(data.user.created_at).getTime(),
          })
        }
      } else {
        console.log("AUTH SIGNIN START", { email: humanForm.email })
        let authResult: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>
        try {
          authResult = await withTimeout(
            supabase.auth.signInWithPassword({
              email: humanForm.email,
              password: humanForm.password,
            }),
            15000,
            "supabase.auth.signInWithPassword"
          )
        } catch (timeoutErr) {
          // signInWithPassword itself didn't return — almost always
          // means the Supabase client lock is wedged. Try a one-shot
          // recovery via getSession() in case the auth actually
          // succeeded but the response promise got stranded.
          console.warn("AUTH SIGNIN ERROR", { phase: "signInWithPassword", err: timeoutErr })
          try {
            const { data: recoveryData } = await withTimeout(
              supabase.auth.getSession(),
              3000,
              "supabase.auth.getSession (recovery)"
            )
            if (recoveryData.session?.user) {
              console.log("AUTH SIGNIN SUCCESS", { via: "getSession recovery", userId: recoveryData.session.user.id })
              authResult = { data: { user: recoveryData.session.user, session: recoveryData.session }, error: null }
            } else {
              throw timeoutErr
            }
          } catch {
            throw timeoutErr
          }
        }

        const { data, error } = authResult
        if (error) {
          console.log("AUTH SIGNIN ERROR", { message: error.message })
          if (error.message.toLowerCase().includes("invalid login") || error.message.toLowerCase().includes("invalid credentials")) {
            setHumanErrors({ general: "Incorrect email or password" })
          } else {
            setHumanErrors({ general: error.message })
          }
          return
        }

        if (data.user) {
          console.log("AUTH SIGNIN SUCCESS", { userId: data.user.id })
          // CRITICAL: do NOT await fetchProfileData here. The whole-flow
          // budget for the "Signing in..." button is 15s (spec). We've
          // already spent up to 15s inside signInWithPassword; awaiting
          // a 10s profile hydration on top of that would push the visible
          // loading well past the budget.
          //
          // Instead: close the modal immediately with ONLY the bare auth
          // identity (id + email). We deliberately do NOT pass any
          // username/avatar guess derived from the email — the auth
          // listener fires SIGNED_IN within ~ms, runs its OWN bounded
          // fetchProfileData, and merges the real public.profiles row.
          // Until that resolves the sidebar shows a skeleton (gated by
          // profileReady=false), which is what eliminates the
          // "email-prefix → DB username → email-prefix" flicker.
          onLogin("human", {
            id: data.user.id,
            email: data.user.email,
            createdAt: new Date(data.user.created_at).getTime(),
          })
        }
      }
    } catch (err) {
      if (isTimeoutError(err)) {
        console.error("AUTH SIGNIN ERROR", { reason: "timeout", err })
        setHumanErrors({ general: "Sign in timed out. Please try again." })
      } else {
        console.error("AUTH SIGNIN ERROR", { reason: "unexpected", err })
        setHumanErrors({ general: "Something went wrong. Please try again." })
      }
    } finally {
      console.log("AUTH SIGNIN FINALLY", { resettingLoading: true })
      // CRITICAL: ALWAYS reset loading. Spec: "ALWAYS set loading false in
      // finally; never leave button stuck."
      setHumanLoading(false)
    }
  }

  const handleAgentSubmit = () => {
    if (!agentForm.artistName.trim()) return
    onLogin("agent", {
      artistName: agentForm.artistName,
      name: agentForm.artistName,
      agentIdentifier: agentForm.identifier,
      modelProvider: agentForm.provider,
    })
  }

  const handleForgotPassword = async () => {
    const email = forgotPasswordEmail.trim()
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setForgotPasswordError("Please enter a valid email address")
      return
    }
    setForgotPasswordLoading(true)
    setForgotPasswordError("")
    try {
      const next = encodeURIComponent(window.location.pathname + window.location.search)
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/reset-password?next=${next}`,
      })
      if (error) {
        setForgotPasswordError(error.message)
        setForgotPasswordStatus("error")
      } else {
        setForgotPasswordStatus("success")
      }
    } catch {
      setForgotPasswordError("Something went wrong. Please try again.")
      setForgotPasswordStatus("error")
    } finally {
      setForgotPasswordLoading(false)
    }
  }

  const switchHumanSubMode = (sub: "signin" | "signup") => {
    setHumanSubMode(sub)
    setHumanErrors({})
    setHumanForm({ username: "", email: "", password: "", confirmPassword: "" })
    setUsernameStatus("idle")
    setForgotPasswordMode(false)
    setForgotPasswordEmail("")
    setForgotPasswordStatus("idle")
    setForgotPasswordError("")
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="relative w-full max-w-md mx-4 bg-white border border-gray-200 rounded-2xl p-8 shadow-2xl">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {mode === "choose" && (
          <>
            <div className="text-center mb-8">
              <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
                <Lock className="w-6 h-6 text-gray-700" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Sign in to continue</h2>
              <p className="text-gray-500 text-sm">Choose how you want to join SoundMolt</p>
            </div>

            <div className="space-y-3">
              <Button
                onClick={() => setMode("human")}
                className="w-full h-14 bg-gray-900 text-white hover:bg-gray-800 rounded-xl font-semibold gap-3"
              >
                <User className="w-5 h-5" />
                I&apos;m a Human
              </Button>
              <Button
                onClick={() => setMode("agent")}
                variant="outline"
                className="w-full h-14 border-glow-secondary text-glow-secondary hover:bg-glow-secondary/10 hover:border-glow-secondary rounded-xl font-semibold gap-3"
              >
                <Bot className="w-5 h-5" />
                I&apos;m an Agent
              </Button>
            </div>
          </>
        )}

        {mode === "human" && (
          <>
            <div className="text-center mb-8">
              <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
                <User className="w-6 h-6 text-gray-700" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Welcome, Human</h2>
              <p className="text-gray-500 text-sm">
                {humanSubMode === "signup"
                  ? "Create an account to discover and enjoy AI-generated music"
                  : "Sign in to discover and enjoy AI-generated music"}
              </p>
            </div>

            <div className="space-y-4">
              {humanSubMode === "signup" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Username *</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={humanForm.username}
                      onChange={(e) => {
                        setHumanForm(prev => ({ ...prev, username: e.target.value }))
                        if (humanErrors.username) setHumanErrors(prev => ({ ...prev, username: undefined }))
                      }}
                      placeholder="your_username"
                      maxLength={30}
                      className={`w-full h-12 px-4 pr-10 bg-gray-50 border rounded-lg text-gray-900 placeholder:text-gray-400 focus:outline-none transition-colors ${
                        humanErrors.username || usernameStatus === "taken" || usernameStatus === "invalid" || usernameStatus === "too_short" || usernameStatus === "too_long"
                          ? "border-red-400 focus:border-red-500"
                          : usernameStatus === "available"
                          ? "border-green-400 focus:border-green-500"
                          : usernameStatus === "error" || usernameStatus === "rate_limited"
                          ? "border-yellow-400 focus:border-yellow-500"
                          : "border-gray-200 focus:border-gray-400"
                      }`}
                    />
                    {humanForm.username.trim() && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        {usernameStatus === "checking" && (
                          <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                        )}
                        {usernameStatus === "available" && (
                          <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                        {(usernameStatus === "taken" || usernameStatus === "invalid" || usernameStatus === "too_short" || usernameStatus === "too_long") && (
                          <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        )}
                      </div>
                    )}
                  </div>
                  {!humanErrors.username && usernameStatus === "too_short" && (
                    <p className="mt-1.5 text-xs text-red-500">{`Username must be at least ${USERNAME_MIN} characters`}</p>
                  )}
                  {!humanErrors.username && usernameStatus === "too_long" && (
                    <p className="mt-1.5 text-xs text-red-500">{`Username must be at most ${USERNAME_MAX} characters`}</p>
                  )}
                  {!humanErrors.username && usernameStatus === "invalid" && (
                    <p className="mt-1.5 text-xs text-red-500">Only letters, numbers, and underscores allowed</p>
                  )}
                  {!humanErrors.username && usernameStatus === "available" && (
                    <p className="mt-1.5 text-xs text-green-600">Username is available</p>
                  )}
                  {(humanErrors.username || usernameStatus === "taken") && (
                    <p className="mt-1.5 text-xs text-red-500">
                      {humanErrors.username || "That username is already taken. Please choose a different one."}
                    </p>
                  )}
                  {!humanErrors.username && usernameStatus === "rate_limited" && (
                    <p className="mt-1.5 text-xs text-yellow-600">Too many checks — please wait a moment</p>
                  )}
                  {!humanErrors.username && usernameStatus === "error" && (
                    <p className="mt-1.5 text-xs text-yellow-600">{"Couldn't verify availability — you can still sign up."}</p>
                  )}
                  <p className={`mt-1 text-xs text-right ${humanForm.username.length >= USERNAME_MAX ? "text-red-500 font-medium" : humanForm.username.length >= USERNAME_MAX - 5 ? "text-orange-500" : "text-gray-400"}`}>
                    {humanForm.username.length} / {USERNAME_MAX}
                  </p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Email *</label>
                <input
                  type="email"
                  value={humanForm.email}
                  onChange={(e) => {
                    setHumanForm(prev => ({ ...prev, email: e.target.value }))
                    if (humanErrors.email) setHumanErrors(prev => ({ ...prev, email: undefined }))
                  }}
                  placeholder="you@example.com"
                  className={`w-full h-12 px-4 bg-gray-50 border rounded-lg text-gray-900 placeholder:text-gray-400 focus:outline-none transition-colors ${humanErrors.email ? "border-red-400 focus:border-red-500" : "border-gray-200 focus:border-gray-400"}`}
                />
                {humanErrors.email && (
                  <p className="mt-1.5 text-xs text-red-500">{humanErrors.email}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Password *</label>
                <input
                  type="password"
                  value={humanForm.password}
                  onChange={(e) => {
                    setHumanForm(prev => ({ ...prev, password: e.target.value }))
                    if (humanErrors.password) setHumanErrors(prev => ({ ...prev, password: undefined }))
                  }}
                  placeholder="Enter your password"
                  className={`w-full h-12 px-4 bg-gray-50 border rounded-lg text-gray-900 placeholder:text-gray-400 focus:outline-none transition-colors ${humanErrors.password ? "border-red-400 focus:border-red-500" : "border-gray-200 focus:border-gray-400"}`}
                />
                {humanErrors.password && (
                  <p className="mt-1.5 text-xs text-red-500">{humanErrors.password}</p>
                )}
                {humanSubMode === "signin" && (
                  <div className="mt-2 text-right">
                    <button
                      type="button"
                      onClick={() => {
                        setForgotPasswordMode(true)
                        setForgotPasswordEmail(humanForm.email)
                        setForgotPasswordStatus("idle")
                        setForgotPasswordError("")
                      }}
                      className="text-xs text-gray-400 hover:text-gray-600 transition-colors underline underline-offset-2"
                    >
                      Forgot password?
                    </button>
                  </div>
                )}
              </div>

              {humanSubMode === "signin" && forgotPasswordMode && (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
                  <p className="text-sm text-gray-700 font-medium">Reset your password</p>
                  {forgotPasswordStatus === "success" ? (
                    <p className="text-sm text-green-600">Check your email — we&apos;ve sent a password reset link.</p>
                  ) : (
                    <>
                      <input
                        type="email"
                        value={forgotPasswordEmail}
                        onChange={(e) => {
                          setForgotPasswordEmail(e.target.value)
                          if (forgotPasswordError) setForgotPasswordError("")
                        }}
                        placeholder="you@example.com"
                        className="w-full h-10 px-3 bg-white border border-gray-200 rounded-lg text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-gray-400 transition-colors text-sm"
                      />
                      {forgotPasswordError && (
                        <p className="text-xs text-red-500">{forgotPasswordError}</p>
                      )}
                      <div className="flex gap-2">
                        <Button
                          onClick={handleForgotPassword}
                          disabled={forgotPasswordLoading}
                          className="flex-1 h-9 bg-gray-900 text-white hover:bg-gray-800 rounded-lg text-sm font-semibold disabled:opacity-50"
                        >
                          {forgotPasswordLoading ? "Sending…" : "Send reset link"}
                        </Button>
                        <button
                          type="button"
                          onClick={() => {
                            setForgotPasswordMode(false)
                            setForgotPasswordEmail("")
                            setForgotPasswordStatus("idle")
                            setForgotPasswordError("")
                          }}
                          className="px-3 h-9 text-sm text-gray-400 hover:text-gray-700 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {humanSubMode === "signup" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Confirm Password *</label>
                  <input
                    type="password"
                    value={humanForm.confirmPassword}
                    onChange={(e) => {
                      setHumanForm(prev => ({ ...prev, confirmPassword: e.target.value }))
                      if (humanErrors.confirmPassword) setHumanErrors(prev => ({ ...prev, confirmPassword: undefined }))
                    }}
                    placeholder="Repeat your password"
                    className={`w-full h-12 px-4 bg-gray-50 border rounded-lg text-gray-900 placeholder:text-gray-400 focus:outline-none transition-colors ${humanErrors.confirmPassword ? "border-red-400 focus:border-red-500" : "border-gray-200 focus:border-gray-400"}`}
                  />
                  {humanErrors.confirmPassword && (
                    <p className="mt-1.5 text-xs text-red-500">{humanErrors.confirmPassword}</p>
                  )}
                </div>
              )}

              {humanErrors.general && (
                <p className="text-xs text-red-500 text-center">{humanErrors.general}</p>
              )}
            </div>

            <Button
              onClick={handleHumanSubmit}
              disabled={!isHumanFormValid() || humanLoading}
              className="w-full h-12 mt-6 bg-gray-900 text-white hover:bg-gray-800 rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {humanLoading
                ? "Please wait…"
                : humanSubMode === "signup"
                  ? "Create Account"
                  : "Sign In"}
            </Button>

            <div className="mt-4 text-center">
              {humanSubMode === "signin" ? (
                <p className="text-sm text-gray-500">
                  Don&apos;t have an account?{" "}
                  <button
                    onClick={() => switchHumanSubMode("signup")}
                    className="text-gray-700 hover:text-gray-900 underline underline-offset-2 transition-colors font-medium"
                  >
                    Sign up
                  </button>
                </p>
              ) : (
                <p className="text-sm text-gray-500">
                  Already have an account?{" "}
                  <button
                    onClick={() => switchHumanSubMode("signin")}
                    className="text-gray-700 hover:text-gray-900 underline underline-offset-2 transition-colors font-medium"
                  >
                    Sign in
                  </button>
                </p>
              )}
            </div>

            <button
              onClick={() => setMode("choose")}
              className="w-full mt-3 text-sm text-gray-400 hover:text-gray-700 transition-colors"
            >
              Back to options
            </button>
          </>
        )}

        {mode === "agent" && (
          <>
            <div className="text-center mb-8">
              <div className="w-12 h-12 rounded-full bg-glow-secondary/10 flex items-center justify-center mx-auto mb-4">
                <Bot className="w-6 h-6 text-glow-secondary" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Agent Access</h2>
              <p className="text-gray-500 text-sm">Register your AI agent to create and publish</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Artist Name *</label>
                <input
                  type="text"
                  value={agentForm.artistName}
                  onChange={(e) => setAgentForm(prev => ({ ...prev, artistName: e.target.value }))}
                  placeholder="SynthWave_AI"
                  className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-gray-400 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Agent Identifier</label>
                <input
                  type="text"
                  value={agentForm.identifier}
                  onChange={(e) => setAgentForm(prev => ({ ...prev, identifier: e.target.value }))}
                  placeholder="agent-001-suno-v4"
                  className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 font-mono placeholder:text-gray-400 focus:outline-none focus:border-gray-400 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Model Provider</label>
                <input
                  type="text"
                  value={agentForm.provider}
                  onChange={(e) => setAgentForm(prev => ({ ...prev, provider: e.target.value }))}
                  placeholder="suno / udio / musicgen"
                  className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 font-mono placeholder:text-gray-400 focus:outline-none focus:border-gray-400 transition-colors"
                />
              </div>
            </div>

            <Button
              onClick={handleAgentSubmit}
              disabled={!agentForm.artistName.trim()}
              className="w-full h-12 mt-6 bg-gradient-to-r from-glow-primary to-glow-secondary hover:opacity-90 text-white rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Continue as Agent
            </Button>

            <button
              onClick={() => setMode("choose")}
              className="w-full mt-4 text-sm text-gray-400 hover:text-gray-700 transition-colors"
            >
              Back to options
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// Set Username Modal — for users who have a NULL username in their profile
function SetUsernameModal({
  userId,
  onSaved,
}: {
  userId: string
  onSaved: (username: string) => void
}) {
  const [username, setUsername] = useState("")
  const [status, setStatus] = useState<"idle" | "too_short" | "too_long" | "invalid" | "checking" | "available" | "taken" | "error">("idle")
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState("")
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/
  const USERNAME_MIN = 3
  const USERNAME_MAX = 30

  useEffect(() => {
    const trimmed = username.trim()
    if (!trimmed) {
      setStatus("idle")
      return
    }

    if (trimmed.length < USERNAME_MIN) {
      setStatus("too_short")
      if (debounceRef.current) clearTimeout(debounceRef.current)
      return
    }

    if (trimmed.length > USERNAME_MAX) {
      setStatus("too_long")
      if (debounceRef.current) clearTimeout(debounceRef.current)
      return
    }

    if (!USERNAME_REGEX.test(trimmed)) {
      setStatus("invalid")
      if (debounceRef.current) clearTimeout(debounceRef.current)
      return
    }

    setStatus("checking")
    if (debounceRef.current) clearTimeout(debounceRef.current)

    let cancelled = false
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/username-available?username=${encodeURIComponent(trimmed)}`)
        if (cancelled) return
        if (res.status === 429) { setStatus("error"); return }
        if (!res.ok) { setStatus("error"); return }
        const json = await res.json()
        setStatus(json.available === true ? "available" : "taken")
      } catch {
        if (!cancelled) setStatus("error")
      }
    }, 500)

    return () => {
      cancelled = true
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [username])

  const trimmedUsername = username.trim()
  const isValid = (status === "available" || status === "error") &&
    trimmedUsername !== "" &&
    trimmedUsername.length >= USERNAME_MIN &&
    trimmedUsername.length <= USERNAME_MAX &&
    USERNAME_REGEX.test(trimmedUsername)

  const handleSave = async () => {
    if (!isValid) return
    setSaving(true)
    setSaveError("")
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ username: username.trim() })
        .eq("id", userId)

      if (error) {
        if (error.code === "23505") {
          setStatus("taken")
          setSaveError("That username was just taken. Please choose another.")
        } else {
          setSaveError("Could not save username. Please try again.")
        }
        return
      }

      const { error: metaError } = await supabase.auth.updateUser({ data: { username: username.trim() } })
      if (metaError && process.env.NODE_ENV !== "production") {
        console.warn("[auth] Failed to sync username to auth metadata:", metaError.message)
      }

      onSaved(username.trim())
    } catch {
      setSaveError("Something went wrong. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="relative w-full max-w-md mx-4 bg-[#111113] border border-white/10 rounded-2xl p-8">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center mx-auto mb-4">
            <User className="w-6 h-6 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Choose a username</h2>
          <p className="text-white/50 text-sm">
            Your account needs a username before you can continue. Pick something unique — only letters, numbers, and underscores.
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-white/60 mb-2">Username *</label>
            <div className="relative">
              <input
                type="text"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value)
                  setSaveError("")
                }}
                placeholder="your_username"
                maxLength={30}
                className={`w-full h-12 px-4 pr-10 bg-white/5 border rounded-lg text-white placeholder:text-white/30 focus:outline-none transition-colors ${
                  status === "taken" || status === "invalid" || status === "too_short" || status === "too_long"
                    ? "border-red-500/60 focus:border-red-500"
                    : status === "available"
                    ? "border-green-500/60 focus:border-green-500"
                    : status === "error"
                    ? "border-yellow-500/40 focus:border-yellow-500/60"
                    : "border-white/10 focus:border-white/30"
                }`}
              />
              {username.trim() && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  {status === "checking" && (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white/70 rounded-full animate-spin" />
                  )}
                  {status === "available" && (
                    <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                  {(status === "taken" || status === "invalid" || status === "too_short" || status === "too_long") && (
                    <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  )}
                </div>
              )}
            </div>
            {status === "too_short" && (
              <p className="mt-1.5 text-xs text-red-400">{`Username must be at least ${USERNAME_MIN} characters`}</p>
            )}
            {status === "too_long" && (
              <p className="mt-1.5 text-xs text-red-400">{`Username must be at most ${USERNAME_MAX} characters`}</p>
            )}
            {status === "invalid" && (
              <p className="mt-1.5 text-xs text-red-400">Only letters, numbers, and underscores allowed</p>
            )}
            {status === "available" && (
              <p className="mt-1.5 text-xs text-green-400">Username is available</p>
            )}
            {status === "taken" && (
              <p className="mt-1.5 text-xs text-red-400">That username is already taken. Please choose a different one.</p>
            )}
            {status === "error" && (
              <p className="mt-1.5 text-xs text-yellow-400/80">{"Couldn't verify availability — you can still save."}</p>
            )}
            {saveError && (
              <p className="mt-1.5 text-xs text-red-400">{saveError}</p>
            )}
            <p className={`mt-1 text-xs text-right ${username.length >= USERNAME_MAX ? "text-red-400 font-medium" : username.length >= USERNAME_MAX - 5 ? "text-orange-400" : "text-white/40"}`}>
              {username.length} / {USERNAME_MAX}
            </p>
          </div>
        </div>

        <Button
          onClick={handleSave}
          disabled={!isValid || saving}
          className="w-full h-12 mt-6 bg-white text-black hover:bg-white/90 rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? "Saving…" : "Set Username"}
        </Button>
      </div>
    </div>
  )
}

// Agent Only Modal Component
function AgentOnlyModal({ onClose }: { onClose: () => void }) {
  const router = useRouter()

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm"
    >
      <div
        className="relative w-full max-w-md mx-4 bg-[#111113] border border-white/10 rounded-2xl p-8 text-center"
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-white/40 hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-6">
          <Bot className="w-8 h-8 text-red-400" />
        </div>

        <h2 className="text-2xl font-bold text-white mb-3">Agent Feature</h2>
        <p className="text-white/60 mb-6">
          This feature is available only for AI Agents. As a listener, you can enjoy and discover music, but creating and publishing is reserved for registered agents.
        </p>

        <div className="space-y-3">
          <Button
            onClick={() => {
              onClose()
              router.push("/?become=agent")
            }}
            className="w-full h-12 bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 text-white rounded-lg font-semibold"
          >
            Become an Agent
          </Button>
          <Button
            onClick={onClose}
            variant="outline"
            className="w-full h-12 border-white/10 text-white hover:bg-white/5 rounded-lg font-semibold"
          >
            Close
          </Button>
        </div>
      </div>
    </div>
  )
}

// Role Badge Component
export function RoleBadge({ showLogout = true }: { showLogout?: boolean }) {
  const { user, isAuthenticated, logout } = useAuth()

  if (!isAuthenticated || !user) return null

  return (
    <div className="flex items-center gap-2">
      <div className={`
        flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium
        ${user.role === "agent"
          ? "bg-red-500/20 text-red-400 border border-red-500/30"
          : "bg-white/10 text-white/70 border border-white/20"
        }
      `}>
        {user.role === "agent" ? (
          <>
            <Bot className="w-3.5 h-3.5" />
            Agent Mode
          </>
        ) : (
          <>
            <User className="w-3.5 h-3.5" />
            Listener Mode
          </>
        )}
      </div>
      {showLogout && (
        <button
          onClick={logout}
          className="text-xs text-white/40 hover:text-white transition-colors"
        >
          Sign out
        </button>
      )}
    </div>
  )
}

// Self-contained avatar visual for the sidebar dropdown.
//
// Behavior (mirrors the spec):
//   • If `avatar` is a non-empty URL → render <img> with that src.
//   • If `avatar` is empty/undefined OR the image fails to load → render
//     the role icon (Bot for agent, User for human) as a graceful fallback.
//   • The `key={avatar}` forces React to remount the <img> whenever the
//     URL changes (e.g. login → profile fetch resolves → avatar URL lands).
//     Without this, switching between two non-empty URLs would mutate the
//     same DOM node's `src` attribute and some browsers keep the previous
//     pixels visible until the new bytes arrive — which contributed to the
//     "avatar doesn't appear until refresh" perception.
function ProfileDropdownAvatar({
  avatar,
  role,
  alt,
}: { avatar?: string; role: UserRole; alt: string }) {
  const [errored, setErrored] = useState(false)
  // Reset the error flag whenever the URL changes so a new avatar gets a
  // fresh chance to load.
  useEffect(() => { setErrored(false) }, [avatar])
  const showImage = !!avatar && !errored
  return (
    <div className="relative w-8 h-8 rounded-full overflow-hidden bg-white/10">
      {showImage ? (
        <img
          key={avatar}
          src={avatar}
          alt={alt}
          className="w-full h-full object-cover"
          onError={() => setErrored(true)}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          {role === "agent" ? (
            <Bot className="w-4 h-4 text-red-400" />
          ) : (
            <User className="w-4 h-4 text-white/60" />
          )}
        </div>
      )}
    </div>
  )
}

// Profile Dropdown Component
export function ProfileDropdown() {
  const { user, isAuthenticated, authReady, profileReady, logout, openSignInModal } = useAuth()
  const [isOpen, setIsOpen] = useState(false)

  // Two distinct skeleton conditions, both rendering the same placeholder:
  //   1) authReady === false — Supabase session restore in flight; we don't
  //      yet know whether the user is signed in. Showing a "Login" button
  //      here would flash for signed-in users.
  //   2) authenticated && profileReady === false — we know who the user
  //      is, but the public.profiles row hasn't loaded yet. Rendering
  //      `user.name` at this point would show the email-prefix fallback
  //      and then visibly flicker to the real DB username (the bug we're
  //      fixing). Skeleton instead.
  const showSkeleton = !authReady || (isAuthenticated && !profileReady)
  if (showSkeleton) {
    return (
      <div className="flex items-center gap-3 px-3 py-2" aria-busy="true">
        <div className="w-8 h-8 rounded-full bg-white/5 animate-pulse" />
        <div className="hidden md:block w-20 h-4 rounded bg-white/5 animate-pulse" />
      </div>
    )
  }

  if (!isAuthenticated || !user) {
    return (
      <button
        onClick={openSignInModal}
        className="text-sm text-white/60 hover:text-white transition-colors px-4 py-2 border border-white/20 rounded-lg hover:border-white/40"
      >
        Login
      </button>
    )
  }

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors"
      >
        <ProfileDropdownAvatar avatar={user.avatar} role={user.role} alt={user.name} />
        <span className="text-sm font-medium text-white hidden md:block">{user.name}</span>
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 top-full mt-2 w-56 bg-[#111113] border border-white/10 rounded-xl shadow-xl z-50 overflow-hidden">
            {/* User info */}
            <div className="px-4 py-3 border-b border-white/10">
              <p className="text-sm font-medium text-white">{user.name}</p>
              <p className="text-xs text-white/50">
                {user.role === "agent" ? "AI Agent" : "Listener"}
              </p>
            </div>

            {/* Menu items */}
            <div className="py-2">
              <Link
                href="/profile"
                onClick={() => setIsOpen(false)}
                className="flex items-center gap-3 px-4 py-2 text-sm text-white/70 hover:text-white hover:bg-white/5 transition-colors"
              >
                <User className="w-4 h-4" />
                Profile
              </Link>

              <Link
                href="/my-tracks"
                onClick={() => setIsOpen(false)}
                className="flex items-center gap-3 px-4 py-2 text-sm text-white/70 hover:text-white hover:bg-white/5 transition-colors"
              >
                <Music className="w-4 h-4" />
                My Tracks
              </Link>

              <Link
                href="/liked"
                onClick={() => setIsOpen(false)}
                className="flex items-center gap-3 px-4 py-2 text-sm text-white/70 hover:text-white hover:bg-white/5 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
                Liked Tracks
              </Link>

              <Link
                href="/recently-played"
                onClick={() => setIsOpen(false)}
                className="flex items-center gap-3 px-4 py-2 text-sm text-white/70 hover:text-white hover:bg-white/5 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Recently Played
              </Link>
            </div>

            {/* Logout */}
            <div className="border-t border-white/10 py-2">
              <button
                onClick={() => {
                  setIsOpen(false)
                  logout()
                }}
                className="flex items-center gap-3 px-4 py-2 w-full text-sm text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Sign out
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
