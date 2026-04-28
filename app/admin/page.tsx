"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useAuth } from "@/components/auth-context"
import { supabase } from "@/lib/supabase"
import { isClientAdminEmail } from "@/lib/admin-emails-client"
import {
  Loader2,
  ShieldAlert,
  LogIn,
  RefreshCw,
  Trash2,
  EyeOff,
  Eye,
  Power,
  PowerOff,
  ExternalLink,
  Sparkles,
  TrendingUp,
  Coins,
  Plus,
  RotateCcw,
  Check,
  AlertCircle,
  Send,
  Settings,
} from "lucide-react"
import { BoostStatsModal, type BoostModalTrack } from "@/components/admin/boost-stats-modal"
import { TelegramConnectModal } from "@/components/admin/telegram-connect-modal"

// ── Types ───────────────────────────────────────────────────────────
interface Overview {
  users: number
  tracks: number
  agents: number
  posts: number
  comments: number
  analyses: number
  tracks_missing_audio_url: number
  tracks_without_analysis: number | null
}
interface AdminTrack {
  id: string
  title: string
  user_id: string
  owner_email: string | null
  agent_id: string | null
  audio_url_exists: boolean
  analysis_exists: boolean
  published_at: string | null
  created_at: string
  // Stat layers — `organic_*` is the analytics-safe truth from the
  // `tracks` table; `boost_*` is the sum of admin-applied boosts from
  // `track_stat_boosts`; `display_*` is what the public UI shows.
  // All optional so the admin panel still works against an old API
  // response where these fields don't exist yet.
  organic_plays?: number
  organic_likes?: number
  organic_downloads?: number
  boost_plays?: number
  boost_likes?: number
  boost_downloads?: number
  boost_entry_count?: number
  display_plays?: number
  display_likes?: number
  display_downloads?: number
}
interface AdminUser {
  id: string
  email: string | null
  created_at: string
  username: string | null
  role: string | null
  status: "active" | "suspended" | "deleted" | string
  suspended_at: string | null
  deleted_at: string | null
  track_count: number
  agent_count: number
}

interface UserDetail {
  user: { id: string; email: string | null; created_at: string; banned_until: string | null }
  profile: {
    id?: string
    username?: string | null
    role?: string | null
    avatar_url?: string | null
    avatar_is_custom?: boolean | null
    status?: string | null
    suspended_at?: string | null
    deleted_at?: string | null
    updated_at?: string | null
  } | null
  tracks: Array<{ id: string; title: string; published_at: string | null; created_at: string }>
  agents: Array<{ id: string; name: string; status: string; last_active_at: string | null; created_at: string }>
  recent_activity: Array<{ id: string; track_id: string; event_type: string | null; created_at: string }>
  warnings: string[]
  counts: { tracks: number; agents: number; active_agents: number; recent_activity: number }
}
interface AdminAgent {
  id: string
  name: string
  user_id: string
  owner_email: string | null
  status: string
  capabilities: string[]
  connection_code: string | null
  connected_at: string | null
  last_active_at: string | null
  created_at: string
  /**
   * Telegram bot username for this agent, without the leading "@".
   *   - null  → no bot connected (or migration 045 not applied yet).
   *   - ""    → bot connected but bot has no public username.
   *   - "foo" → render as "@foo" in the agents table.
   */
  telegram_bot_username?: string | null
}
interface HealthData {
  missing_audio_url: Array<{
    id: string
    title: string
    created_at: string
    published_at: string | null
  }>
  missing_analysis: Array<{
    id: string
    title: string
    created_at: string
    published_at: string | null
  }>
  failed_analysis: Array<{
    id: string
    track_id: string
    provider: string
    created_at: string
    published_at: string | null
  }>
}

type Section = "overview" | "tracks" | "users" | "agents" | "health" | "ai_producer"

// ── AI Producer types (used by AiProducerSection below) ─────────────
interface AdminAiReview {
  id: string
  user_id: string
  owner_email: string | null
  title: string | null
  status: "processing" | "ready" | "failed"
  access_type: "free" | "full"
  credits_used: number
  source_type: "uploaded_file" | "existing_track"
  genre: string | null
  daw: string | null
  feedback_focus: string | null
  created_at: string
}

interface AdminCreditRow {
  user_id: string
  owner_email: string | null
  credits_balance: number
  updated_at: string
}

interface AdminCreditsAdjustResult {
  ok: true
  user_id: string
  previous_balance: number
  credits_balance: number
  delta: number
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Default request timeout in ms. Long enough to comfortably cover all
 * "fast" admin endpoints (overview / users / tracks / health are all
 * sub-second in practice), short enough that a hung request surfaces
 * a real error instead of a permanent spinner.
 *
 * Slow operations (Essentia re-analyze) opt in to a higher value via
 * `timeoutMs` on the call site — see `adminFetch` callers below.
 */
const ADMIN_FETCH_DEFAULT_TIMEOUT_MS = 25_000
/**
 * Re-analyze (Essentia) realistically runs 10–20s end-to-end and can
 * peak around 60s on cold caches; we give it a generous 90s window so
 * slow but successful runs aren't surfaced as fake "timed out" errors.
 */
const ADMIN_FETCH_ANALYZE_TIMEOUT_MS = 90_000

interface AdminFetchInit extends RequestInit {
  /** Override request timeout in ms. Defaults to 25s. */
  timeoutMs?: number
}

/**
 * Wrapper around fetch() that:
 *   • Attaches the current user's Supabase JWT as Bearer auth.
 *   • Aborts the request after a configurable timeout (default 25s,
 *     90s for Essentia re-analyze) so a stuck server can never lock
 *     a button forever.
 *   • Parses non-2xx responses into a readable Error message
 *     (extracts `error` / `message` from JSON, falls back to body text,
 *     finally to `HTTP <status>`).
 *   • Logs every request to the browser console as
 *     `[admin] → METHOD /path` and on completion as
 *     `[admin] ✓ METHOD /path STATUS (Nms)` so admins can debug
 *     stuck UI directly from DevTools without server access.
 */
async function adminFetch<T>(path: string, init?: AdminFetchInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase()
  const timeoutMs = init?.timeoutMs ?? ADMIN_FETCH_DEFAULT_TIMEOUT_MS
  const startedAt = (typeof performance !== "undefined" ? performance.now() : Date.now())

  console.info(`[admin] → ${method} ${path}`)

  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) {
    console.error(`[admin] ✗ ${method} ${path}: no session token`)
    throw new Error("Session expired — please refresh the page and sign in again.")
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(path, {
      ...init,
      signal: controller.signal,
      headers: {
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    })
    const ms = Math.round(
      (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt,
    )

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      let msg = res.statusText || `HTTP ${res.status}`
      // Most of our admin/* and tracks/* mutation routes return
      // `{ error: "..." }` on failure — surface that verbatim instead
      // of dumping the full JSON blob into the toast.
      if (text) {
        try {
          const parsed = JSON.parse(text) as { error?: string; message?: string }
          msg = parsed.error ?? parsed.message ?? text.slice(0, 200)
        } catch {
          msg = text.slice(0, 200)
        }
      }
      console.error(`[admin] ✗ ${method} ${path} ${res.status} (${ms}ms): ${msg}`)
      throw new Error(`${res.status} — ${msg}`)
    }

    console.info(`[admin] ✓ ${method} ${path} ${res.status} (${ms}ms)`)
    // Await the body parse INSIDE the try so:
    //   1. A stalled body stream is still bounded by the AbortController
    //      (fetch ties its body to the signal; abort() rejects the
    //      pending json() with AbortError, which we translate below).
    //   2. A malformed body surfaces as a catchable JSON parse error
    //      with logging context, not an unhandled rejection.
    //   3. The `finally` clearTimeout(timer) actually waits for parsing
    //      to finish — otherwise the timer would fire after a slow body
    //      parse on a successful response and call abort() on a
    //      now-finished request (harmless, but pointlessly noisy).
    const json = (await res.json().catch((e) => {
      console.error(`[admin] ✗ ${method} ${path}: invalid JSON response`, e)
      throw new Error(`Invalid JSON response from server (${res.status}).`)
    })) as T
    return json
  } catch (e) {
    // AbortController.abort() triggers a DOMException with name "AbortError"
    // — translate that into a human-readable timeout message before it
    // bubbles up into the action handlers.
    if ((e as { name?: string }).name === "AbortError") {
      const seconds = Math.round(timeoutMs / 1000)
      console.error(`[admin] ⏱ ${method} ${path}: timed out after ${seconds}s`)
      throw new Error(
        `Request timed out after ${seconds}s. The server is taking longer than expected — try again or check the server logs.`,
      )
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

function formatDate(ts: string | null | undefined): string {
  if (!ts) return "—"
  try {
    return new Date(ts).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return ts
  }
}

function shortId(id: string | null | undefined): string {
  if (!id) return "—"
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id
}

// ── Resource hook ───────────────────────────────────────────────────
//
// Owns the data/loading/error state for ONE admin endpoint.
// Lives in the parent <AdminDashboard /> so state survives tab switches:
//   • cached data is shown immediately when re-visiting a tab
//   • auto-fetch fires only the first time a tab becomes active
//     (or when the user explicitly calls reload())
//   • in-flight request is cancelled if the resource becomes inactive
//     or if reload() is called again — no orphaned setState calls,
//     no race between StrictMode double-mount and slow fetches
//
interface AdminResource<T> {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => Promise<void>
}

function useAdminResource<T>(path: string, active: boolean): AdminResource<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Marks "we have at least attempted to load this resource". Prevents the
  // auto-fetch effect from re-firing forever after an error.
  const triedRef = useRef(false)
  // Tracks the most recent in-flight request so we can ignore stale responses.
  const reqIdRef = useRef(0)

  const reload = useCallback(async () => {
    const myId = ++reqIdRef.current
    setLoading(true)
    setError(null)
    triedRef.current = true
    try {
      const json = await adminFetch<T>(path)
      // Drop result if a newer reload() superseded us.
      if (reqIdRef.current === myId) setData(json)
    } catch (e) {
      if (reqIdRef.current === myId) setError((e as Error).message)
    } finally {
      if (reqIdRef.current === myId) setLoading(false)
    }
  }, [path])

  // Auto-load when this resource's tab becomes active for the first time.
  // Will NOT auto-retry after an error — user must hit Refresh — to avoid
  // a tight infinite loop on a persistently failing endpoint.
  useEffect(() => {
    if (!active) return
    if (data !== null) return
    if (loading) return
    if (triedRef.current) return
    void reload()
  }, [active, data, loading, reload])

  return { data, loading, error, reload }
}

// ── Page ────────────────────────────────────────────────────────────
//
// Gate logic for /admin.
//
// IMPORTANT: This page intentionally does NOT call router.push/replace
// at any point. Non-admins are shown an in-page card; we never navigate
// away from /admin. If you find yourself adding a redirect here, stop —
// the spec is "show the message, stay on /admin".
//
// State machine:
//   "checking" → still waiting for AuthProvider to hydrate the session
//                (authReady === false), or the /api/admin/me request
//                hasn't returned yet, or we're waiting briefly for the
//                Supabase session token to appear post-sign-in. Renders
//                a spinner.
//   "guest"   → authReady === true AND no user is signed in. Renders a
//                friendly "Sign in required" card with a button that
//                opens the global sign-in modal. NO redirect.
//   "denied"  → authReady === true, a user IS signed in, and the
//                server-side requireAdmin() check returned `is_admin:
//                false` with HTTP 200. Renders "Access denied" with a
//                link back to /feed. ONLY entered on a confirmed
//                non-admin response — transient errors fall to "error"
//                so a network blip never falsely revokes admin access.
//   "error"   → /api/admin/me returned non-2xx, threw, or returned
//                malformed JSON. Renders a retry card. The user can
//                click "Try again" to re-run the check; we also auto-
//                recheck whenever `authVersion` ticks (sign-in,
//                token refresh, etc.).
//   "ok"      → server confirmed admin. Renders <AdminDashboard />.
//
// Why a separate "error" state matters: the prior version coerced any
// fetch failure to "denied", which would falsely show "Access denied"
// to a real admin during a network hiccup or a Vercel cold start.
//
// Why we depend on `authVersion`: `[authReady, isAuthenticated, email]`
// alone won't re-fire when the user signs in if the email/auth flags
// were already in their final state by the time the effect last ran
// (e.g. token storage races). `authVersion` ticks on every relevant
// auth event (INITIAL_SESSION, SIGNED_IN, TOKEN_REFRESHED, manual
// login/logout), so depending on it guarantees a re-evaluation every
// time the auth picture changes.
//
// The /api/admin/me endpoint runs the SAME requireAdmin() check the
// data routes use, so the UI gate can never disagree with the API gate
// (and ADMIN_EMAILS env overrides apply uniformly).
type AdminGate = "checking" | "guest" | "denied" | "error" | "ok"

// Short retry window (ms) for the "isAuthenticated but no token yet"
// race. We poll getSession() every 200ms up to ~2s; if the token still
// hasn't materialised we surface the retryable "error" card (NOT
// "guest" — a signed-in user without a token is hitting a propagation
// race, not a sign-out, and shouldn't be stranded). In practice the
// token is in storage well within the first poll.
const TOKEN_WAIT_MS = 2000
const TOKEN_POLL_MS = 200

export default function AdminPage() {
  const { user, isAuthenticated, authReady, authVersion, openSignInModal } = useAuth()
  const pathname = usePathname()
  const [gate, setGate] = useState<AdminGate>("checking")
  // Bumped manually when the user clicks "Try again" so the check
  // effect re-runs without needing an underlying auth state change.
  const [retryNonce, setRetryNonce] = useState(0)

  useEffect(() => {
    // Single, structured diagnostic line so it's easy to spot in
    // DevTools when something looks off. Includes everything the spec
    // asked us to surface, plus an explicit redirectTarget=null to
    // make it obvious this page never navigates away.
    console.log("[admin] gate state", {
      pathname,
      authReady,
      isAuthenticated,
      authVersion,
      userEmail: user?.email ?? null,
      gate,
      redirectTarget: null,
    })
  }, [pathname, authReady, isAuthenticated, authVersion, user?.email, gate])

  useEffect(() => {
    // Wait for the AuthProvider to finish restoring the session before
    // making any decision — otherwise a logged-in admin would briefly
    // see "Sign in required" on every hard reload of /admin.
    if (!authReady) {
      setGate("checking")
      return
    }

    if (!isAuthenticated) {
      console.log("[admin] not signed in → showing guest prompt (no redirect)")
      setGate("guest")
      return
    }

    // CLIENT-SIDE FAST PATH for known admin emails.
    //
    // If the signed-in user's email is in NEXT_PUBLIC_ADMIN_EMAILS
    // (or the hardcoded default), grant the admin dashboard
    // IMMEDIATELY — no spinner, no server round-trip blocking the
    // render. The /api/admin/* data routes still re-validate the
    // JWT server-side, so this is purely a UX optimization to
    // eliminate the "Couldn't verify access" failure mode on
    // Vercel cold starts / transient API issues.
    //
    // Spec acceptance: "andrewkarme@gmail.com can always open
    // /admin on Vercel; if admin check API fails, known admin
    // still enters."
    const knownAdmin = isClientAdminEmail(user?.email)
    if (knownAdmin) {
      console.log("[admin] known admin email → granting access immediately (no API gate)", {
        email: user?.email,
      })
      setGate("ok")
      // We intentionally don't kick off the /api/admin/me probe in
      // this path. The data-route fetches inside <AdminDashboard />
      // will surface any real auth issue as a per-request error
      // on whatever the admin actually clicks. Burning a probe
      // request just to log a redundant true/true result adds
      // latency for no UX benefit.
      return
    }

    let cancelled = false
    setGate("checking")
    ;(async () => {
      try {
        // Brief poll for the session token. Covers the race where
        // `isAuthenticated` is already true (auth-context state) but
        // the Supabase storage write for the token hasn't propagated
        // to getSession() yet. Without this, the user could be stuck
        // on "guest" until they manually refresh.
        let token: string | undefined
        const deadline = Date.now() + TOKEN_WAIT_MS
        while (!cancelled) {
          const { data: { session } } = await supabase.auth.getSession()
          token = session?.access_token
          if (token) break
          if (Date.now() >= deadline) break
          await new Promise((r) => setTimeout(r, TOKEN_POLL_MS))
        }
        if (cancelled) return

        if (!token) {
          // Authenticated in context but no token in storage even
          // after a short retry window. We deliberately do NOT fall
          // back to "guest" here — a real signed-in admin in this
          // state is hitting a token propagation race, not a sign-out,
          // and "guest" has no retry path so they'd be stranded.
          // "error" is retryable (Try again button + auto-recheck on
          // the next authVersion bump) and is the correct UX.
          //
          // (The known-admin fast path above already short-circuits
          // for andrewkarme@gmail.com, so this branch only runs for
          // non-allow-listed users where the retry semantics are
          // appropriate.)
          console.warn("[admin] isAuthenticated=true but no session token after retry; surfacing retryable error")
          setGate("error")
          return
        }

        const res = await fetch("/api/admin/me", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        })

        // Try to parse the body regardless of status — the route
        // contract is "always JSON". If parsing fails we fall through
        // to the transient-error path.
        const json = (await res.json().catch(() => null)) as
          | { isAdmin?: boolean; is_admin?: boolean; email?: string; reason?: string }
          | null

        if (!res.ok) {
          // Non-2xx — could be a Vercel cold-start hiccup, a 5xx, or
          // a CORS/network glitch. The known-admin email is already
          // handled above, so any non-admin email reaching this
          // branch sees the retryable error card. Real admin denial
          // only ever comes back as 200 + { isAdmin: false }.
          console.error(`[admin] /api/admin/me HTTP ${res.status} — treating as transient error`, json)
          if (!cancelled) setGate("error")
          return
        }

        if (cancelled) return

        const isAdmin =
          typeof json?.isAdmin === "boolean" ? json.isAdmin
            : typeof json?.is_admin === "boolean" ? json.is_admin
            : null

        if (isAdmin === null) {
          console.error("[admin] /api/admin/me malformed body — treating as transient error", json)
          setGate("error")
          return
        }

        console.log("[admin] /api/admin/me result", {
          status: res.status,
          isAdmin,
          email: json?.email ?? user?.email ?? null,
          reason: json?.reason ?? null,
        })
        setGate(isAdmin ? "ok" : "denied")
      } catch (err) {
        if (!cancelled) {
          console.error("[admin] /api/admin/me request threw — treating as transient error", err)
          setGate("error")
        }
      }
    })()

    return () => {
      cancelled = true
    }
    // `authVersion` is included so the check re-runs on every auth
    // event (sign-in, token refresh, etc.) even if the email hasn't
    // changed. `retryNonce` lets the user manually retry from the
    // error card.
  }, [authReady, isAuthenticated, authVersion, user?.email, retryNonce])

  if (gate === "checking") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    )
  }

  if (gate === "guest") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="max-w-md w-full glass-modal rounded-xl p-8 text-center">
          <LogIn className="w-12 h-12 mx-auto text-sky-400 mb-4" />
          <h1 className="text-xl font-semibold text-white mb-2">Sign in required</h1>
          <p className="text-sm text-muted-foreground mb-6">
            The admin panel is only available to authorized administrators. Please sign in
            with your admin account to continue.
          </p>
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            <button
              type="button"
              onClick={openSignInModal}
              className="px-4 py-2 rounded-lg bg-sky-500/90 hover:bg-sky-500 text-white text-sm font-medium transition-colors"
            >
              Sign in
            </button>
            <Link
              href="/feed"
              className="px-4 py-2 rounded-lg border border-white/10 text-white/80 hover:bg-white/5 text-sm font-medium transition-colors"
            >
              Back to feed
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (gate === "denied") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="max-w-md w-full glass-modal rounded-xl p-8 text-center">
          <ShieldAlert className="w-12 h-12 mx-auto text-rose-400 mb-4" />
          <h1 className="text-xl font-semibold text-white mb-2">Access denied</h1>
          <p className="text-sm text-muted-foreground mb-6">
            Your account ({user?.email ?? "unknown"}) is not in the administrator allow-list.
            Contact the site owner if you believe this is a mistake.
          </p>
          <Link
            href="/feed"
            className="inline-block px-4 py-2 rounded-lg border border-white/10 text-white/80 hover:bg-white/5 text-sm font-medium transition-colors"
          >
            Back to feed
          </Link>
        </div>
      </div>
    )
  }

  if (gate === "error") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="max-w-md w-full glass-modal rounded-xl p-8 text-center">
          <ShieldAlert className="w-12 h-12 mx-auto text-amber-400 mb-4" />
          <h1 className="text-xl font-semibold text-white mb-2">Couldn't verify access</h1>
          <p className="text-sm text-muted-foreground mb-6">
            We couldn't reach the admin check service. This is usually a temporary network
            issue — please try again.
          </p>
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            <button
              type="button"
              onClick={() => setRetryNonce((n) => n + 1)}
              className="px-4 py-2 rounded-lg bg-amber-500/90 hover:bg-amber-500 text-white text-sm font-medium transition-colors"
            >
              Try again
            </button>
            <Link
              href="/feed"
              className="px-4 py-2 rounded-lg border border-white/10 text-white/80 hover:bg-white/5 text-sm font-medium transition-colors"
            >
              Back to feed
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return <AdminDashboard />
}

// ── Notification system ─────────────────────────────────────────────
//
// In-page toast/banner that replaces the previous `alert()` calls. The
// reasons we're not using `alert()` anymore:
//   • A modal alert blocks the entire page; the user can't see what
//     state the panel is in and can't compare the message to the row
//     that triggered it.
//   • Errors from the original implementation often arrived as a
//     stringified status code ("401: ...") which users dismissed
//     without reading. The toast variant stays visible for 6s, can
//     be re-read, and is colour-coded by kind.
//   • Non-error feedback (e.g. "Re-analyze started, can take ~20s")
//     can be surfaced without the modal jail.
//
// `Notice.id` is a monotonic counter, used to ensure the auto-dismiss
// timer only clears the *current* notice — if a second notice arrives
// before the first times out, the first one's timer is overwritten and
// the new one gets its own 6s window.
type NoticeKind = "info" | "success" | "error"
interface Notice {
  id: number
  kind: NoticeKind
  message: string
}

const NOTICE_TIMEOUT_MS = 6000

type Notify = (message: string, kind?: NoticeKind) => void

const NOTICE_PALETTE: Record<NoticeKind, string> = {
  info:    "border-sky-500/40 bg-sky-500/10 text-sky-100",
  success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100",
  error:   "border-rose-500/40 bg-rose-500/10 text-rose-100",
}

function NoticeBanner({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }) {
  return (
    <div
      role={notice.kind === "error" ? "alert" : "status"}
      aria-live={notice.kind === "error" ? "assertive" : "polite"}
      className={`mb-4 flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${NOTICE_PALETTE[notice.kind]}`}
    >
      <span className="flex-1 leading-snug break-words">{notice.message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="text-current/60 hover:text-current transition-colors text-lg leading-none"
      >
        ×
      </button>
    </div>
  )
}

// ── Dashboard ───────────────────────────────────────────────────────
function AdminDashboard() {
  const [section, setSection] = useState<Section>("overview")
  const [notice, setNotice] = useState<Notice | null>(null)
  // Counter used to give each notice a stable id; the auto-dismiss
  // timer matches against it so superseded notices don't clear newer
  // ones.
  const noticeIdRef = useRef(0)
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const notify = useCallback<Notify>((message, kind = "info") => {
    const id = ++noticeIdRef.current
    setNotice({ id, kind, message })
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = setTimeout(() => {
      // Only clear if a newer notice hasn't already replaced us — this
      // matters because every notify() call schedules a new timer, so
      // the *previous* timer might fire after a newer notice is shown.
      setNotice((curr) => (curr?.id === id ? null : curr))
    }, NOTICE_TIMEOUT_MS)
  }, [])
  // Cancel the auto-dismiss timer if the dashboard unmounts mid-toast,
  // otherwise React will warn about setState on an unmounted component.
  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current)
    }
  }, [])

  // All resource state is hoisted here so it persists across tab switches.
  // Cached data is rendered immediately when the user revisits a tab.
  const overview = useAdminResource<Overview>(
    "/api/admin/overview",
    section === "overview",
  )
  const tracks = useAdminResource<{ tracks: AdminTrack[] }>(
    "/api/admin/tracks?limit=200",
    section === "tracks",
  )
  const users = useAdminResource<{ users: AdminUser[] }>(
    "/api/admin/users",
    section === "users",
  )
  const agents = useAdminResource<{ agents: AdminAgent[] }>(
    "/api/admin/agents",
    section === "agents",
  )
  const health = useAdminResource<HealthData>(
    "/api/admin/health",
    section === "health",
  )
  // AI Producer reviews + credits — same hoist-state pattern as the other
  // tabs so cached data survives tab switches and a single Refresh button
  // per subsection re-fetches just that resource.
  const aiReviews = useAdminResource<{ reviews: AdminAiReview[] }>(
    "/api/admin/ai-producer/reviews",
    section === "ai_producer",
  )
  const aiCredits = useAdminResource<{ credits: AdminCreditRow[] }>(
    "/api/admin/ai-producer/credits",
    section === "ai_producer",
  )

  // Track-level mutations (publish/hide/delete/re-analyze) affect BOTH the
  // Tracks listing and the System health lists, so we expose a single
  // "refresh everything that touches tracks" callback both sections share.
  const tracksReload = tracks.reload
  const healthReload = health.reload
  const reloadTrackData = useCallback(async () => {
    await Promise.all([tracksReload(), healthReload()])
  }, [tracksReload, healthReload])

  const sections: Array<{ id: Section; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "tracks", label: "Tracks" },
    { id: "users", label: "Users" },
    { id: "agents", label: "Agents" },
    { id: "health", label: "System health" },
    { id: "ai_producer", label: "AI Producer" },
  ]

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-white/10 bg-card/40 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-5">
          <h1 className="text-2xl font-bold tracking-tight">SoundMolt Admin</h1>
          <p className="text-xs text-muted-foreground mt-1">
            v1 — internal moderation panel · server-validated, admins only
          </p>
        </div>
        <nav className="max-w-7xl mx-auto px-4 md:px-8 flex gap-1 overflow-x-auto">
          {sections.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={`px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                section === s.id
                  ? "border-glow-primary text-glow-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {s.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="max-w-7xl mx-auto px-4 md:px-8 py-8">
        {notice && (
          <NoticeBanner notice={notice} onDismiss={() => setNotice(null)} />
        )}
        {section === "overview" && <OverviewSection res={overview} />}
        {section === "tracks" && (
          <TracksSection res={tracks} onTrackChanged={reloadTrackData} notify={notify} />
        )}
        {section === "users" && <UsersSection res={users} notify={notify} />}
        {section === "agents" && <AgentsSection res={agents} notify={notify} />}
        {section === "health" && (
          <HealthSection res={health} onTrackChanged={reloadTrackData} notify={notify} />
        )}
        {section === "ai_producer" && (
          <AiProducerSection
            reviewsRes={aiReviews}
            creditsRes={aiCredits}
            notify={notify}
          />
        )}
      </main>
    </div>
  )
}

// ── Overview ────────────────────────────────────────────────────────
function OverviewSection({ res }: { res: AdminResource<Overview> }) {
  const { data, loading, error, reload } = res
  const cards = data
    ? [
        { label: "Total users", value: data.users },
        { label: "Total tracks", value: data.tracks },
        { label: "Total agents", value: data.agents },
        { label: "Total posts", value: data.posts },
        { label: "Total comments", value: data.comments },
        { label: "Tracks without analysis", value: data.tracks_without_analysis ?? "—" },
      ]
    : []

  return (
    <SectionShell title="Overview" loading={loading && !data} error={error} onRefresh={reload}>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((c) => (
          <div
            key={c.label}
            className="rounded-xl border border-white/10 bg-card/60 backdrop-blur-sm p-5"
          >
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              {c.label}
            </div>
            <div className="text-3xl font-bold text-white mt-2 tabular-nums">
              {c.value}
            </div>
          </div>
        ))}
      </div>
    </SectionShell>
  )
}

// ── Tracks ──────────────────────────────────────────────────────────
function TracksSection({
  res,
  onTrackChanged,
  notify,
}: {
  res: AdminResource<{ tracks: AdminTrack[] }>
  onTrackChanged: () => Promise<void> | void
  notify: Notify
}) {
  const { data, loading, error, reload } = res
  const tracks = data?.tracks ?? []
  const [busyId, setBusyId] = useState<string | null>(null)
  // Track currently open in the Boost Stats modal — null means closed.
  // We hold a snapshot of the row so the modal can show the
  // organic/boost/display breakdown without re-fetching.
  const [boostTarget, setBoostTarget] = useState<BoostModalTrack | null>(null)

  function openBoost(t: AdminTrack) {
    setBoostTarget({
      id: t.id,
      title: t.title,
      organic_plays: t.organic_plays ?? 0,
      organic_likes: t.organic_likes ?? 0,
      organic_downloads: t.organic_downloads ?? 0,
      boost_plays: t.boost_plays ?? 0,
      boost_likes: t.boost_likes ?? 0,
      boost_downloads: t.boost_downloads ?? 0,
      display_plays: t.display_plays ?? (t.organic_plays ?? 0) + (t.boost_plays ?? 0),
      display_likes: t.display_likes ?? (t.organic_likes ?? 0) + (t.boost_likes ?? 0),
      display_downloads:
        t.display_downloads ?? (t.organic_downloads ?? 0) + (t.boost_downloads ?? 0),
    })
  }

  async function togglePublish(t: AdminTrack) {
    const action = t.published_at ? "unpublish" : "publish"
    setBusyId(t.id)
    try {
      await adminFetch(`/api/admin/tracks/${t.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action }),
      })
      notify(
        action === "publish"
          ? `Published "${t.title}".`
          : `Hidden "${t.title}" — no longer public.`,
        "success",
      )
      await onTrackChanged()
    } catch (e) {
      notify(`${action === "publish" ? "Publish" : "Hide"} failed: ${(e as Error).message}`, "error")
    } finally {
      setBusyId(null)
    }
  }

  async function deleteTrack(t: AdminTrack) {
    if (!confirm(`Delete "${t.title}" permanently? This cannot be undone.`)) return
    setBusyId(t.id)
    try {
      await adminFetch(`/api/admin/tracks/${t.id}`, { method: "DELETE" })
      notify(`Deleted "${t.title}".`, "success")
      await onTrackChanged()
    } catch (e) {
      notify(`Delete failed: ${(e as Error).message}`, "error")
    } finally {
      setBusyId(null)
    }
  }

  async function reanalyze(t: AdminTrack) {
    setBusyId(t.id)
    // Up-front "this is going to take a while" hint — without it the
    // user just sees a spinner for 10–20s and assumes it's hung.
    notify(`Analyzing "${t.title}"… this can take 10–60s, please wait.`, "info")
    try {
      // POSTs to the public /api/tracks/:id/analyze endpoint with the
      // admin's own Supabase JWT — the route accepts admin tokens as
      // a third auth path alongside owner JWT and agent bearer key.
      // Override the default 25s timeout: Essentia legitimately runs
      // 10–20s and can spike near 60s on cold starts.
      await adminFetch(`/api/tracks/${t.id}/analyze`, {
        method: "POST",
        timeoutMs: ADMIN_FETCH_ANALYZE_TIMEOUT_MS,
      })
      notify(`Re-analyze finished for "${t.title}".`, "success")
      await onTrackChanged()
    } catch (e) {
      notify(`Re-analyze failed: ${(e as Error).message}`, "error")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <SectionShell
      title={`Tracks (${tracks.length})`}
      loading={loading && !data}
      error={error}
      onRefresh={reload}
    >
      <DataTable
        head={["Title", "Owner", "Agent", "Audio", "Analysis", "Stats", "Published", "Actions"]}
        rows={tracks.map((t) => [
          <span key="t" className="font-medium text-white truncate block max-w-xs" title={t.title}>
            {t.title}
          </span>,
          <span key="o" className="text-xs">
            {t.owner_email ?? <span className="text-muted-foreground/60">{shortId(t.user_id)}</span>}
          </span>,
          <span key="a" className="text-xs font-mono text-muted-foreground">
            {shortId(t.agent_id)}
          </span>,
          <Pill key="au" tone={t.audio_url_exists ? "ok" : "bad"}>
            {t.audio_url_exists ? "yes" : "no"}
          </Pill>,
          <Pill key="an" tone={t.analysis_exists ? "ok" : "warn"}>
            {t.analysis_exists ? "yes" : "no"}
          </Pill>,
          <TrackStatsCell key="stats" track={t} onBoost={() => openBoost(t)} />,
          <span key="p" className="text-xs text-muted-foreground">
            {t.published_at ? formatDate(t.published_at) : <Pill tone="warn">hidden</Pill>}
          </span>,
          <TrackActions
            key="act"
            trackId={t.id}
            title={t.title}
            published={!!t.published_at}
            audioPresent={t.audio_url_exists}
            busy={busyId === t.id}
            onReanalyze={() => reanalyze(t)}
            onTogglePublish={() => togglePublish(t)}
            onDelete={() => deleteTrack(t)}
          />,
        ])}
      />
      <BoostStatsModal
        track={boostTarget}
        isOpen={!!boostTarget}
        onClose={() => setBoostTarget(null)}
        adminFetch={adminFetch}
        onApplied={async () => {
          notify(`Boost applied to "${boostTarget?.title}".`, "success")
          await onTrackChanged()
        }}
      />
    </SectionShell>
  )
}

/**
 * Single-cell summary of a track's display stats with a "Boost" trigger.
 *
 * Layout — three compact rows showing display total + a tiny "+N boost"
 * subtitle when there's any inflation, so the admin can spot at a
 * glance which tracks have been amplified. Clicking "Boost" opens the
 * modal where they can apply more.
 */
function TrackStatsCell({ track, onBoost }: { track: AdminTrack; onBoost: () => void }) {
  const display = {
    plays: track.display_plays ?? (track.organic_plays ?? 0) + (track.boost_plays ?? 0),
    likes: track.display_likes ?? (track.organic_likes ?? 0) + (track.boost_likes ?? 0),
    downloads:
      track.display_downloads ?? (track.organic_downloads ?? 0) + (track.boost_downloads ?? 0),
  }
  const boostP = track.boost_plays ?? 0
  const boostL = track.boost_likes ?? 0
  const boostD = track.boost_downloads ?? 0
  const hasBoost = boostP > 0 || boostL > 0 || boostD > 0
  return (
    <div className="flex items-start gap-2">
      <div className="text-[11px] tabular-nums font-mono leading-tight space-y-0.5">
        <div className="text-foreground">
          {display.plays.toLocaleString()}
          {boostP > 0 && <span className="text-amber-400 ml-1">(+{boostP})</span>}
          <span className="text-muted-foreground/60"> plays</span>
        </div>
        <div className="text-foreground">
          {display.likes.toLocaleString()}
          {boostL > 0 && <span className="text-amber-400 ml-1">(+{boostL})</span>}
          <span className="text-muted-foreground/60"> likes</span>
        </div>
        <div className="text-foreground">
          {display.downloads.toLocaleString()}
          {boostD > 0 && <span className="text-amber-400 ml-1">(+{boostD})</span>}
          <span className="text-muted-foreground/60"> dls</span>
        </div>
      </div>
      <button
        type="button"
        onClick={onBoost}
        title={
          hasBoost
            ? `Manage boost (${(track.boost_entry_count ?? 0)} entr${
                (track.boost_entry_count ?? 0) === 1 ? "y" : "ies"
              })`
            : "Boost displayed stats for this track"
        }
        className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-xs transition-colors ${
          hasBoost
            ? "border-amber-500/50 text-amber-300 hover:bg-amber-500/10"
            : "border-white/15 text-foreground hover:border-amber-500/40 hover:text-amber-300"
        }`}
      >
        <TrendingUp className="w-3 h-3" />
        Boost
      </button>
    </div>
  )
}

/**
 * Compact action cluster shared by the Tracks listing and the
 * System health blocks. Renders Open / Re-analyze / Hide-or-Publish /
 * Delete buttons with consistent affordances:
 *
 *   • Open:        external link to /tracks/{id} in a new tab.
 *   • Re-analyze:  disabled when the track has no audio (the analyze
 *                  endpoint would 400 anyway).
 *   • Hide:        only rendered when the track is currently published.
 *                  Health blocks may also opt out of publish-when-hidden
 *                  (passing onTogglePublish=null) since "publish a broken
 *                  track" is rarely the right move from a health list.
 *   • Delete:      always available, gated by a confirm() prompt.
 */
function TrackActions({
  trackId,
  title,
  published,
  audioPresent,
  busy,
  onReanalyze,
  onTogglePublish,
  onDelete,
}: {
  trackId: string
  title: string
  published: boolean
  audioPresent: boolean
  busy: boolean
  onReanalyze: () => void
  onTogglePublish: (() => void) | null
  onDelete: () => void
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <a
        href={`/tracks/${trackId}`}
        target="_blank"
        rel="noopener noreferrer"
        title={`Open "${title}" in a new tab`}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-white/15 text-foreground hover:border-glow-primary/40 hover:text-glow-primary transition-colors"
      >
        <ExternalLink className="w-3.5 h-3.5" />
        <span className="text-xs">Open</span>
      </a>
      <ActionButton
        title={
          audioPresent
            ? "Re-run Essentia analysis on this track"
            : "Cannot analyse: track has no audio_url"
        }
        onClick={onReanalyze}
        disabled={busy || !audioPresent}
        variant="default"
      >
        <Sparkles className="w-3.5 h-3.5" />
        <span className="text-xs">Re-analyze</span>
      </ActionButton>
      {onTogglePublish && (
        <ActionButton
          title={published ? "Hide / unpublish" : "Publish"}
          onClick={onTogglePublish}
          disabled={busy}
          variant="default"
        >
          {published ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          <span className="text-xs">{published ? "Hide" : "Publish"}</span>
        </ActionButton>
      )}
      <ActionButton
        title="Delete permanently"
        onClick={onDelete}
        disabled={busy}
        variant="danger"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </ActionButton>
    </div>
  )
}

// ── Users ───────────────────────────────────────────────────────────
function UsersSection({
  res,
  notify,
}: {
  res: AdminResource<{ users: AdminUser[] }>
  notify: Notify
}) {
  const { data, loading, error, reload } = res
  const users = data?.users ?? []
  // Per-row in-flight key — disables that row's actions while a mutation
  // is running. Only one user mutation at a time.
  const [busyId, setBusyId] = useState<string | null>(null)
  // The user currently shown in the right-side detail drawer, or null.
  const [openUserId, setOpenUserId] = useState<string | null>(null)
  // The user the admin is in the process of deleting — drives the
  // confirmation modal. Type-DELETE-to-confirm gating lives inside the
  // modal; this section just tracks which user is being targeted.
  const [pendingDelete, setPendingDelete] = useState<AdminUser | null>(null)

  async function setStatus(u: AdminUser, status: "active" | "suspended") {
    setBusyId(u.id)
    try {
      await adminFetch(`/api/admin/users/${u.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      })
      notify(
        status === "suspended"
          ? `Suspended ${u.email ?? shortId(u.id)} — login is blocked and agents deactivated.`
          : `Reactivated ${u.email ?? shortId(u.id)}.`,
        "success",
      )
      await reload()
    } catch (e) {
      notify(`Failed to update user: ${(e as Error).message}`, "error")
    } finally {
      setBusyId(null)
    }
  }

  async function confirmDelete(u: AdminUser) {
    setBusyId(u.id)
    try {
      await adminFetch(`/api/admin/users/${u.id}`, {
        method: "DELETE",
        headers: { "X-Confirm-Delete": "DELETE" },
      })
      notify(`Permanently deleted ${u.email ?? shortId(u.id)}.`, "success")
      setPendingDelete(null)
      // If the detail drawer was open for this user, close it.
      if (openUserId === u.id) setOpenUserId(null)
      await reload()
    } catch (e) {
      notify(`Delete failed: ${(e as Error).message}`, "error")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <SectionShell
      title={`Users (${users.length})`}
      loading={loading && !data}
      error={error}
      onRefresh={reload}
    >
      <DataTable
        head={[
          "Email",
          "User ID",
          "Username",
          "Role",
          "Status",
          "Tracks",
          "Agents",
          "Created",
          "Actions",
        ]}
        rows={users.map((u) => [
          <span key="e" className="text-white truncate max-w-[18ch] inline-block align-bottom">
            {u.email ?? "—"}
          </span>,
          <span key="i" className="text-xs font-mono text-muted-foreground">{shortId(u.id)}</span>,
          <span key="u" className="text-sm text-foreground">{u.username ?? <span className="text-muted-foreground/60">—</span>}</span>,
          <span key="r" className="text-xs uppercase tracking-wider text-muted-foreground">
            {u.role ?? "—"}
          </span>,
          <UserStatusPill key="s" status={u.status} />,
          <span key="t" className="tabular-nums">{u.track_count}</span>,
          <span key="ag" className="tabular-nums">{u.agent_count}</span>,
          <span key="c" className="text-xs text-muted-foreground">{formatDate(u.created_at)}</span>,
          <UserActions
            key="act"
            user={u}
            busy={busyId === u.id}
            onOpen={() => setOpenUserId(u.id)}
            onSuspend={() => setStatus(u, "suspended")}
            onActivate={() => setStatus(u, "active")}
            onDelete={() => setPendingDelete(u)}
          />,
        ])}
      />

      {openUserId && (
        <UserDetailDrawer
          userId={openUserId}
          onClose={() => setOpenUserId(null)}
          onMutated={reload}
          notify={notify}
        />
      )}

      {pendingDelete && (
        <DeleteUserModal
          user={pendingDelete}
          busy={busyId === pendingDelete.id}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => confirmDelete(pendingDelete)}
        />
      )}
    </SectionShell>
  )
}

function UserStatusPill({ status }: { status: string }) {
  if (status === "deleted")
    return <Pill tone="bad">deleted</Pill>
  if (status === "suspended")
    return <Pill tone="warn">suspended</Pill>
  return <Pill tone="ok">active</Pill>
}

function UserActions({
  user,
  busy,
  onOpen,
  onSuspend,
  onActivate,
  onDelete,
}: {
  user: AdminUser
  busy: boolean
  onOpen: () => void
  onSuspend: () => void
  onActivate: () => void
  onDelete: () => void
}) {
  const isSuspended = user.status === "suspended"
  const isDeleted = user.status === "deleted"
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <ActionButton title="Open user details" onClick={onOpen} disabled={busy} variant="default">
        <Eye className="w-3.5 h-3.5" />
        <span className="text-xs">Open</span>
      </ActionButton>
      {isSuspended ? (
        <ActionButton
          title="Reactivate user — lifts the auth ban"
          onClick={onActivate}
          disabled={busy || isDeleted}
          variant="default"
        >
          <Power className="w-3.5 h-3.5" />
          <span className="text-xs">Reactivate</span>
        </ActionButton>
      ) : (
        <ActionButton
          title="Suspend user — blocks login & deactivates agents"
          onClick={onSuspend}
          disabled={busy || isDeleted}
          variant="default"
        >
          <PowerOff className="w-3.5 h-3.5" />
          <span className="text-xs">Suspend</span>
        </ActionButton>
      )}
      <ActionButton
        title="Delete user permanently"
        onClick={onDelete}
        disabled={busy}
        variant="danger"
      >
        <Trash2 className="w-3.5 h-3.5" />
        <span className="text-xs">Delete</span>
      </ActionButton>
    </div>
  )
}

// ── Delete-user confirmation modal ──────────────────────────────────
//
// Forces the admin to type DELETE before the destructive endpoint can
// be invoked. Lists everything that will be removed so the consequences
// are explicit. Closing the modal (X / Cancel / backdrop click) safely
// aborts the operation — nothing is sent to the server until the admin
// presses the red Delete button.
function DeleteUserModal({
  user,
  busy,
  onCancel,
  onConfirm,
}: {
  user: AdminUser
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const [typed, setTyped] = useState("")
  const canConfirm = typed.trim() === "DELETE" && !busy

  // Keyboard accessibility: Escape always closes (unless mid-delete, to
  // avoid the user thinking the operation aborted when it's still
  // running on the server).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onCancel, busy])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-user-title"
      onClick={() => {
        // Don't let a stray backdrop click dismiss the modal while a
        // delete is in flight — Cancel and Escape are already disabled
        // in that state for the same reason.
        if (!busy) onCancel()
      }}
    >
      <div
        className="glass-modal max-w-lg w-full rounded-xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-4">
          <div className="rounded-full bg-rose-500/20 text-rose-300 p-2 shrink-0">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 id="delete-user-title" className="text-lg font-semibold text-white">
              Delete user permanently?
            </h2>
            <p className="text-sm text-muted-foreground mt-1 break-all">
              {user.email ?? "(no email)"} · <span className="font-mono">{user.id}</span>
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-100 text-sm p-3 mb-4">
          <div className="font-medium mb-1">This action cannot be undone.</div>
          <div className="text-rose-200/90 leading-relaxed">
            All of the following will be removed from the database and from
            Supabase Auth:
          </div>
          <ul className="list-disc pl-5 mt-2 space-y-0.5 text-rose-200/90">
            <li>profile row (username, avatar, role)</li>
            <li>{user.track_count} track{user.track_count === 1 ? "" : "s"} (and their comments &amp; play history)</li>
            <li>{user.agent_count} agent{user.agent_count === 1 ? "" : "s"} (and all API keys)</li>
            <li>posts, discussions, and replies authored by this user</li>
            <li>the auth.users record (login is permanently revoked)</li>
          </ul>
        </div>

        <label className="block text-sm text-muted-foreground mb-2">
          Type <span className="font-mono text-rose-300">DELETE</span> to confirm:
        </label>
        <input
          type="text"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoFocus
          disabled={busy}
          placeholder="DELETE"
          className="w-full rounded-md border border-white/15 bg-black/40 px-3 py-2 text-sm font-mono text-white placeholder:text-white/30 focus:outline-none focus:border-rose-500/60 disabled:opacity-50"
        />

        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 rounded-lg border border-white/10 text-white/80 hover:bg-white/5 text-sm font-medium transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm}
            className="px-4 py-2 rounded-lg bg-rose-500 hover:bg-rose-400 text-white text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            {busy ? "Deleting…" : "Delete user"}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── User detail drawer ──────────────────────────────────────────────
//
// Right-side slide-over showing the user's profile, tracks, agents,
// recent activity, and any health warnings flagged by the API. Reloads
// when opened; the parent's `onMutated` callback is invoked on any
// status change so the underlying users table refreshes.
function UserDetailDrawer({
  userId,
  onClose,
  onMutated,
  notify,
}: {
  userId: string
  onClose: () => void
  onMutated: () => Promise<void> | void
  notify: Notify
}) {
  const [detail, setDetail] = useState<UserDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const json = await adminFetch<UserDetail>(`/api/admin/users/${userId}`)
      setDetail(json)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    void load()
  }, [load])

  // Escape closes the drawer (unless a mutation is running).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose, busy])

  async function setStatus(status: "active" | "suspended") {
    setBusy(true)
    try {
      await adminFetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      })
      notify(
        status === "suspended" ? `User suspended.` : `User reactivated.`,
        "success",
      )
      await Promise.all([load(), Promise.resolve(onMutated())])
    } catch (e) {
      notify(`Failed: ${(e as Error).message}`, "error")
    } finally {
      setBusy(false)
    }
  }

  const status = (detail?.profile?.status as string | undefined) ?? "active"
  const isSuspended = status === "suspended"
  const isDeleted = status === "deleted"

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="user-detail-title"
      onClick={() => {
        // Match the modal's busy-guard pattern — backdrop dismiss is
        // suppressed while a suspend/reactivate request is in flight.
        if (!busy) onClose()
      }}
    >
      <aside
        className="h-full w-full max-w-xl bg-card border-l border-white/10 overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-card/95 backdrop-blur border-b border-white/10 px-5 py-4 flex items-center justify-between gap-3">
          <h2 id="user-detail-title" className="text-base font-semibold text-white">
            User details
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-white/60 hover:text-white text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="p-5 space-y-5">
          {loading && (
            <div className="py-12 flex justify-center text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          )}
          {error && (
            <div className="rounded-md border border-rose-500/30 bg-rose-500/10 text-rose-200 text-sm p-3">
              {error}
            </div>
          )}

          {detail && (
            <>
              {/* Profile summary */}
              <section>
                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                  Profile
                </div>
                <div className="rounded-lg border border-white/10 bg-black/30 p-4 space-y-1.5 text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Email</span>
                    <span className="text-white text-right break-all">{detail.user.email ?? "—"}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">User ID</span>
                    <span className="font-mono text-xs text-white/80 text-right break-all">{detail.user.id}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Username</span>
                    <span className="text-white">{detail.profile?.username ?? "—"}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Role</span>
                    <span className="text-white uppercase text-xs">{detail.profile?.role ?? "—"}</span>
                  </div>
                  <div className="flex justify-between gap-3 items-center">
                    <span className="text-muted-foreground">Status</span>
                    <UserStatusPill status={status} />
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Created</span>
                    <span className="text-white">{formatDate(detail.user.created_at)}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Banned until</span>
                    <span className="text-white">
                      {detail.user.banned_until && detail.user.banned_until !== "none"
                        ? formatDate(detail.user.banned_until)
                        : "—"}
                    </span>
                  </div>
                </div>
              </section>

              {/* Health warnings */}
              {detail.warnings.length > 0 && (
                <section>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                    Health warnings
                  </div>
                  <ul className="space-y-1.5">
                    {detail.warnings.map((w, i) => (
                      <li
                        key={i}
                        className="rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-100 text-sm p-2 leading-relaxed"
                      >
                        {w}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Quick action bar */}
              <section className="flex flex-wrap gap-2">
                {isSuspended ? (
                  <button
                    type="button"
                    onClick={() => setStatus("active")}
                    disabled={busy || isDeleted}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/10 text-sm transition-colors disabled:opacity-40"
                  >
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Power className="w-3.5 h-3.5" />}
                    Reactivate
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setStatus("suspended")}
                    disabled={busy || isDeleted}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-amber-500/40 text-amber-200 hover:bg-amber-500/10 text-sm transition-colors disabled:opacity-40"
                  >
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PowerOff className="w-3.5 h-3.5" />}
                    Suspend
                  </button>
                )}
              </section>

              {/* Tracks */}
              <section>
                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                  Tracks ({detail.counts.tracks})
                </div>
                {detail.tracks.length === 0 ? (
                  <div className="text-sm text-muted-foreground italic">No tracks.</div>
                ) : (
                  <ul className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                    {detail.tracks.map((t) => (
                      <li
                        key={t.id}
                        className="rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm flex items-center justify-between gap-3"
                      >
                        <a
                          href={`/tracks/${t.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-white truncate hover:text-glow-primary transition-colors"
                          title={t.title}
                        >
                          {t.title}
                        </a>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {t.published_at ? "published" : "draft"} · {formatDate(t.created_at)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Agents */}
              <section>
                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                  Agents ({detail.counts.agents})
                </div>
                {detail.agents.length === 0 ? (
                  <div className="text-sm text-muted-foreground italic">No agents.</div>
                ) : (
                  <ul className="space-y-1.5">
                    {detail.agents.map((a) => (
                      <li
                        key={a.id}
                        className="rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm flex items-center justify-between gap-3"
                      >
                        <span className="text-white truncate" title={a.name}>{a.name}</span>
                        <span className="flex items-center gap-2 shrink-0">
                          <Pill tone={a.status === "active" ? "ok" : "warn"}>{a.status}</Pill>
                          <span className="text-xs text-muted-foreground">
                            {a.last_active_at ? formatDate(a.last_active_at) : "no activity"}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Recent activity */}
              <section>
                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                  Recent activity ({detail.counts.recent_activity})
                </div>
                {detail.recent_activity.length === 0 ? (
                  <div className="text-sm text-muted-foreground italic">No recent activity recorded.</div>
                ) : (
                  <ul className="space-y-1 max-h-60 overflow-y-auto pr-1">
                    {detail.recent_activity.map((a) => (
                      <li
                        key={a.id}
                        className="text-xs flex items-center justify-between gap-3 px-2 py-1 rounded border border-white/5"
                      >
                        <span className="text-white/80">
                          {a.event_type ?? "play"} · track {shortId(a.track_id)}
                        </span>
                        <span className="text-muted-foreground">{formatDate(a.created_at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </aside>
    </div>
  )
}

// ── Agents ──────────────────────────────────────────────────────────
function AgentsSection({
  res,
  notify,
}: {
  res: AdminResource<{ agents: AdminAgent[] }>
  notify: Notify
}) {
  const { data, loading, error, reload } = res
  const agents = data?.agents ?? []
  const [busyId, setBusyId] = useState<string | null>(null)
  // Telegram modal target — null when closed.
  const [telegramAgent, setTelegramAgent] = useState<AdminAgent | null>(null)

  async function toggleStatus(a: AdminAgent) {
    const next = a.status === "active" ? "inactive" : "active"
    setBusyId(a.id)
    try {
      await adminFetch(`/api/admin/agents/${a.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      })
      notify(
        `Agent ${a.name ?? shortId(a.id)} → ${next}.`,
        "success",
      )
      await reload()
    } catch (e) {
      notify(`Failed to update agent: ${(e as Error).message}`, "error")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <SectionShell
      title={`Agents (${agents.length})`}
      loading={loading && !data}
      error={error}
      onRefresh={reload}
    >
      <DataTable
        head={["Name", "Capabilities", "Status", "Owner", "Telegram", "Last activity", "Actions"]}
        rows={agents.map((a) => {
          const tg = a.telegram_bot_username
          const tgConnected = tg !== null && tg !== undefined
          return [
            <span key="n" className="font-medium text-white">{a.name}</span>,
            <span key="cap" className="text-xs text-muted-foreground">
              {a.capabilities.length > 0 ? a.capabilities.join(", ") : "—"}
            </span>,
            <Pill key="s" tone={a.status === "active" ? "ok" : "warn"}>{a.status}</Pill>,
            <span key="o" className="text-xs">
              {a.owner_email ?? <span className="text-muted-foreground/60">{shortId(a.user_id)}</span>}
            </span>,
            <span key="tg" className="text-xs font-mono">
              {tgConnected ? (
                <span className="text-sky-300">
                  {tg ? `@${tg}` : <span className="text-muted-foreground/70">(no username)</span>}
                </span>
              ) : (
                <span className="text-muted-foreground/60">Not connected</span>
              )}
            </span>,
            <span key="la" className="text-xs text-muted-foreground">{formatDate(a.last_active_at)}</span>,
            <div key="act" className="flex items-center gap-2">
              <ActionButton
                title={a.status === "active" ? "Deactivate agent" : "Activate agent"}
                onClick={() => toggleStatus(a)}
                disabled={busyId === a.id}
                variant="default"
              >
                {a.status === "active" ? (
                  <PowerOff className="w-3.5 h-3.5" />
                ) : (
                  <Power className="w-3.5 h-3.5" />
                )}
                <span className="text-xs">
                  {a.status === "active" ? "Deactivate" : "Activate"}
                </span>
              </ActionButton>
              <ActionButton
                title={tgConnected ? "Open Telegram settings" : "Connect Telegram bot"}
                onClick={() => setTelegramAgent(a)}
                variant="default"
              >
                {tgConnected ? (
                  <Settings className="w-3.5 h-3.5" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                <span className="text-xs">
                  {tgConnected ? "Telegram Settings" : "Connect Telegram"}
                </span>
              </ActionButton>
            </div>,
          ]
        })}
      />

      <TelegramConnectModal
        agentId={telegramAgent?.id ?? null}
        agentName={telegramAgent?.name ?? null}
        isOpen={!!telegramAgent}
        onClose={() => setTelegramAgent(null)}
        onChanged={async () => {
          // Reload so the column flips between "Not connected" and "@username".
          await reload()
        }}
        adminFetch={adminFetch}
      />
    </SectionShell>
  )
}

// ── System health ───────────────────────────────────────────────────
type HealthBlockId = "missing-audio" | "missing-analysis" | "failed-analysis"

interface FixProgress {
  block: HealthBlockId
  done: number
  total: number
  failed: number
}

function HealthSection({
  res,
  onTrackChanged,
  notify,
}: {
  res: AdminResource<HealthData>
  onTrackChanged: () => Promise<void> | void
  notify: Notify
}) {
  const { data, loading, error, reload } = res
  // Per-row spinner key — disables the action cluster of the affected row
  // while a single-track mutation is in flight.
  const [busyId, setBusyId] = useState<string | null>(null)
  // Bulk re-analyze progress, owned by the section so only one block can
  // be "fixing" at a time. Cleared when the loop finishes (whether the
  // analyze loop or the post-loop refresh succeeded or threw).
  const [fixProgress, setFixProgress] = useState<FixProgress | null>(null)
  // Mounted-guard: the bulk re-analyze loop can outlive the user's view
  // of this section (they may switch tabs or unmount the dashboard
  // entirely). Without a guard we'd setState after unmount and trigger
  // React warnings, plus alert() the user about results they no longer
  // care about.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  async function reanalyze(trackId: string) {
    setBusyId(trackId)
    notify(`Analyzing track ${shortId(trackId)}… this can take 10–60s.`, "info")
    try {
      // 90s timeout — Essentia legitimately runs 10-20s and can spike to ~60s.
      await adminFetch(`/api/tracks/${trackId}/analyze`, {
        method: "POST",
        timeoutMs: ADMIN_FETCH_ANALYZE_TIMEOUT_MS,
      })
      notify(`Re-analyze finished for ${shortId(trackId)}.`, "success")
      await onTrackChanged()
    } catch (e) {
      notify(`Re-analyze failed: ${(e as Error).message}`, "error")
    } finally {
      setBusyId(null)
    }
  }

  async function unpublish(trackId: string) {
    setBusyId(trackId)
    try {
      await adminFetch(`/api/admin/tracks/${trackId}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "unpublish" }),
      })
      notify(`Hidden ${shortId(trackId)} — no longer public.`, "success")
      await onTrackChanged()
    } catch (e) {
      notify(`Hide failed: ${(e as Error).message}`, "error")
    } finally {
      setBusyId(null)
    }
  }

  async function deleteTrack(trackId: string, title: string) {
    if (!confirm(`Delete "${title}" permanently? This cannot be undone.`)) return
    setBusyId(trackId)
    try {
      await adminFetch(`/api/admin/tracks/${trackId}`, { method: "DELETE" })
      notify(`Deleted "${title}".`, "success")
      await onTrackChanged()
    } catch (e) {
      notify(`Delete failed: ${(e as Error).message}`, "error")
    } finally {
      setBusyId(null)
    }
  }

  /**
   * Bulk re-analyze: walks the supplied track ids one at a time, POSTing
   * to /api/tracks/:id/analyze for each. Sequential (not Promise.all) for
   * three reasons:
   *   1. Essentia analysis is CPU-heavy on the server — parallel fan-out
   *      would either queue or thrash.
   *   2. We can show a real "N of M" progress without coordinating
   *      partial-failure state across concurrent promises.
   *   3. If the user closes the tab mid-run, fewer half-finished runs
   *      are left dangling.
   * Errors are counted per-track but never abort the loop — the goal is
   * "fix as many as possible". A summary alert is shown at the end if
   * any track failed.
   */
  async function fixAll(block: HealthBlockId, trackIds: string[]) {
    if (trackIds.length === 0) return
    // Bidirectional lock: refuse to start a bulk run if EITHER another
    // bulk is already going OR a per-row mutation is in flight. Without
    // this guard a per-row Re-analyze + bulk loop could race on the same
    // track and produce duplicate analyse calls.
    if (fixProgress || busyId) return
    const ok = confirm(
      `Re-analyze ${trackIds.length} track${trackIds.length === 1 ? "" : "s"}? ` +
        `This may take a while — they'll be processed one at a time.`,
    )
    if (!ok) return

    setFixProgress({ block, done: 0, total: trackIds.length, failed: 0 })
    let failed = 0
    try {
      for (let i = 0; i < trackIds.length; i++) {
        // Bail out early if the section unmounted (user navigated away).
        // In-flight requests still complete server-side, but we stop
        // mutating state and stop kicking off new ones.
        if (!mountedRef.current) return
        try {
          // 90s timeout — same Essentia call as the per-row Re-analyze.
          await adminFetch(`/api/tracks/${trackIds[i]}/analyze`, {
            method: "POST",
            timeoutMs: ADMIN_FETCH_ANALYZE_TIMEOUT_MS,
          })
        } catch {
          failed++
        }
        if (mountedRef.current) {
          // Bump progress on every iteration regardless of success/failure.
          setFixProgress({ block, done: i + 1, total: trackIds.length, failed })
        }
      }
      // Refresh both Tracks and System health. Wrapped separately so a
      // refresh failure doesn't leak a permanently-locked "isFixing" UI
      // (the outer finally will still clear fixProgress).
      try {
        await onTrackChanged()
      } catch (e) {
        console.error("[admin/health] fixAll: onTrackChanged failed", e)
      }
    } finally {
      // Always clear the progress chip — this is the lock that disables
      // every Re-analyze button in the section. Skipping this on the
      // throw path would soft-brick the UI until full reload.
      if (mountedRef.current) {
        setFixProgress(null)
        const ok = trackIds.length - failed
        if (failed > 0) {
          notify(
            `Re-analyze finished: ${ok} succeeded, ${failed} failed. ` +
              `Failed tracks stay in the list — click Re-analyze on each to see the error.`,
            "error",
          )
        } else {
          notify(`Re-analyze finished: ${ok} succeeded.`, "success")
        }
      }
    }
  }

  return (
    <SectionShell
      title="System health"
      loading={loading && !data}
      error={error}
      onRefresh={reload}
    >
      {data && (
        <div className="space-y-6">
          <HealthBlock
            id="missing-audio"
            tone="critical"
            icon="❌"
            title={`Missing audio (${data.missing_audio_url.length})`}
            description="These tracks have no audio_url. Without audio they can't be played or analysed — usually safe to delete."
            empty="All tracks have an audio URL."
            rows={data.missing_audio_url.map((t) => ({
              key: t.id,
              trackId: t.id,
              title: t.title,
              left: t.title,
              right: formatDate(t.created_at),
              published: !!t.published_at,
              // These rows by definition have no audio — re-analyze will
              // 400, so disable the button up-front rather than surface
              // a confusing alert after the fact.
              audioPresent: false,
            }))}
            busyId={busyId}
            onReanalyze={reanalyze}
            onHide={unpublish}
            onDelete={deleteTrack}
            // No "Fix all (Re-analyze)" button here on purpose: every
            // call would 400 (Track has no audio_url to analyse). The
            // real fix is "Delete" or re-uploading the audio elsewhere.
            onFixAll={null}
            fixProgress={null}
          />
          <HealthBlock
            id="missing-analysis"
            tone="warning"
            icon="⚠️"
            title={`Missing analysis (${data.missing_analysis.length})`}
            description="These tracks were never analysed. Run Re-analyze to populate the analysis row."
            empty="Every track has at least one analysis row."
            rows={data.missing_analysis.map((t) => ({
              key: t.id,
              trackId: t.id,
              title: t.title,
              left: t.title,
              right: formatDate(t.created_at),
              published: !!t.published_at,
              // The /admin/health endpoint doesn't include audio_url for
              // this list — assume audio is present. If it isn't, the
              // analyze route surfaces a 400 the user sees in the alert.
              audioPresent: true,
            }))}
            busyId={busyId}
            onReanalyze={reanalyze}
            onHide={unpublish}
            onDelete={deleteTrack}
            onFixAll={() =>
              fixAll(
                "missing-analysis",
                data.missing_analysis.map((t) => t.id),
              )
            }
            fixProgress={fixProgress?.block === "missing-analysis" ? fixProgress : null}
          />
          <HealthBlock
            id="failed-analysis"
            tone="error"
            icon="🔴"
            title={`Failed / empty analyses (${data.failed_analysis.length})`}
            description="These analysis runs returned empty results. Re-analyze should overwrite the broken row with a fresh one."
            empty="No failed or empty analyses detected in the recent batch."
            rows={data.failed_analysis.map((r) => ({
              key: r.id,
              trackId: r.track_id,
              title: `track ${shortId(r.track_id)}`,
              left: `${r.provider} → track ${shortId(r.track_id)}`,
              right: formatDate(r.created_at),
              published: !!r.published_at,
              // A failed analysis row implies the track had audio at the
              // time the run was attempted — re-analyze is the whole
              // point of this list.
              audioPresent: true,
            }))}
            busyId={busyId}
            onReanalyze={reanalyze}
            onHide={unpublish}
            onDelete={deleteTrack}
            onFixAll={() =>
              fixAll(
                "failed-analysis",
                // De-duplicate: the same track may have multiple failed
                // analysis rows; we only need to re-run analysis once.
                Array.from(new Set(data.failed_analysis.map((r) => r.track_id))),
              )
            }
            fixProgress={fixProgress?.block === "failed-analysis" ? fixProgress : null}
          />
        </div>
      )}
    </SectionShell>
  )
}

// ── AI Producer ─────────────────────────────────────────────────────
//
// Combined Reviews + Credits subsections, rendered inside the main
// /admin tab strip (NOT a separate route). The standalone
// /admin/ai-producer page is preserved for backward compatibility, but
// admins land here by default via the "AI Producer" tab.
//
// Both lists are driven by useAdminResource hooks hoisted in the
// parent so cached data survives tab switches. Credit adjustments hit
// the same /api/admin/ai-producer/credits POST endpoint (which goes
// through the SECURITY DEFINER admin_adjust_credits RPC and writes a
// credit_transactions row with type='admin_gift') — we just optimistic-
// update the row and refetch on success.
function AiProducerSection({
  reviewsRes,
  creditsRes,
  notify,
}: {
  reviewsRes: AdminResource<{ reviews: AdminAiReview[] }>
  creditsRes: AdminResource<{ credits: AdminCreditRow[] }>
  notify: Notify
}) {
  const reviews = reviewsRes.data?.reviews ?? []
  const credits = creditsRes.data?.credits ?? []

  const [pendingUserId, setPendingUserId] = useState<string | null>(null)
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({})
  const [flashUserId, setFlashUserId] = useState<string | null>(null)

  // Grant-to-arbitrary-user form (same UX as the standalone page).
  const [grantUserId, setGrantUserId] = useState("")
  const [grantAmount, setGrantAmount] = useState("1")
  const [grantError, setGrantError] = useState<string | null>(null)
  const [grantBusy, setGrantBusy] = useState(false)

  // Refs so we can avoid lint warnings about stale closures while still
  // exposing a stable adjustCredits identity.
  const creditsReload = creditsRes.reload

  const adjustCredits = useCallback(
    async (
      userId: string,
      action: "add" | "set" | "reset",
      amount?: number,
    ) => {
      setPendingUserId(userId)
      try {
        const body: Record<string, unknown> = { user_id: userId, action }
        if (action !== "reset") body.amount = amount
        const result = await adminFetch<AdminCreditsAdjustResult>(
          "/api/admin/ai-producer/credits",
          { method: "POST", body: JSON.stringify(body) },
        )
        // The credit list is owned by useAdminResource (which encapsulates
        // its own setData), so we can't mutate it from out here. Trigger
        // a refetch instead — the local flash icon below gives immediate
        // visual feedback while the list reloads.
        void creditsReload()
        setFlashUserId(userId)
        setTimeout(
          () => setFlashUserId((cur) => (cur === userId ? null : cur)),
          1500,
        )
        notify(
          `Balance for ${shortId(userId)} → ${result.credits_balance}`,
          "success",
        )
        return result
      } catch (err) {
        notify(
          `Credit adjustment failed: ${(err as Error).message}`,
          "error",
        )
        throw err
      } finally {
        setPendingUserId(null)
      }
    },
    [creditsRes, notify],
  )

  const handleGrantNew = async (e: React.FormEvent) => {
    e.preventDefault()
    setGrantError(null)
    const uid = grantUserId.trim()
    const amt = Number(grantAmount)
    if (!/^[0-9a-f-]{32,36}$/i.test(uid)) {
      setGrantError("user_id must be a UUID.")
      return
    }
    if (!Number.isFinite(amt) || amt < 0) {
      setGrantError("Amount must be a non-negative number.")
      return
    }
    setGrantBusy(true)
    try {
      // adjustCredits already triggers a creditsReload() internally on
      // success — no need for a second refetch here. The email column
      // for the new row will populate when that reload lands.
      await adjustCredits(uid, "add", Math.trunc(amt))
      setGrantUserId("")
      setGrantAmount("1")
    } catch (err) {
      setGrantError((err as Error).message || "Grant failed.")
    } finally {
      setGrantBusy(false)
    }
  }

  const reviewsLoading = reviewsRes.loading
  const reviewsError = reviewsRes.error
  const creditsLoading = creditsRes.loading
  const creditsError = creditsRes.error

  return (
    <div className="space-y-10">
      {/* ── 1. Reviews ─────────────────────────────────────────── */}
      <SectionShell
        title="Reviews"
        loading={reviewsLoading && reviews.length === 0}
        error={reviewsError}
        onRefresh={reviewsRes.reload}
      >
        {reviews.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground border border-dashed border-white/10 rounded-lg">
            No reviews yet.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-white/10">
            <table className="min-w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted-foreground bg-white/5">
                <tr>
                  <th className="text-left font-medium px-4 py-2">User</th>
                  <th className="text-left font-medium px-4 py-2">Title</th>
                  <th className="text-left font-medium px-4 py-2">Status</th>
                  <th className="text-left font-medium px-4 py-2">Access</th>
                  <th className="text-left font-medium px-4 py-2">Credits</th>
                  <th className="text-left font-medium px-4 py-2">Created</th>
                  <th className="text-right font-medium px-4 py-2">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {reviews.map((r) => (
                  <tr key={r.id} className="hover:bg-white/5">
                    <td className="px-4 py-2 font-mono text-xs">
                      <div className="text-foreground">{r.owner_email ?? "—"}</div>
                      <div className="text-muted-foreground" title={r.user_id}>
                        {shortId(r.user_id)}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      {r.title || (
                        <span className="text-muted-foreground">Untitled</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`text-[10px] uppercase tracking-wider font-mono px-2 py-0.5 rounded-full border ${
                          r.status === "ready"
                            ? "bg-emerald-500/10 border-emerald-400/30 text-emerald-300"
                            : r.status === "processing"
                              ? "bg-amber-500/10 border-amber-400/30 text-amber-300"
                              : "bg-red-500/10 border-red-400/30 text-red-300"
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`text-[10px] uppercase tracking-wider font-mono px-2 py-0.5 rounded-full border ${
                          r.access_type === "full"
                            ? "bg-emerald-500/10 border-emerald-400/30 text-emerald-300"
                            : "bg-purple-500/10 border-purple-400/30 text-purple-300"
                        }`}
                      >
                        {r.access_type}
                      </span>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {r.credits_used}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">
                      {formatDate(r.created_at)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Link
                        href={`/ai-producer/reviews/${r.id}`}
                        target="_blank"
                        className="inline-flex items-center gap-1 text-xs text-purple-300 hover:text-purple-200"
                      >
                        Open Review <ExternalLink className="w-3 h-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionShell>

      {/* ── 2. Credits ─────────────────────────────────────────── */}
      <SectionShell
        title="Credits"
        loading={creditsLoading && credits.length === 0}
        error={creditsError}
        onRefresh={creditsRes.reload}
      >
        {/* Grant-to-arbitrary-user form */}
        <div className="mb-4 rounded-lg border border-purple-400/20 bg-purple-500/5 p-4">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground font-mono mb-2">
            <Coins className="w-3.5 h-3.5 text-purple-300" />
            Grant credits to a user
          </div>
          <form
            onSubmit={handleGrantNew}
            className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-end"
          >
            <div className="flex-1">
              <label className="text-[11px] text-muted-foreground">
                User ID (UUID)
              </label>
              <input
                type="text"
                value={grantUserId}
                onChange={(e) => setGrantUserId(e.target.value)}
                placeholder="00000000-0000-0000-0000-000000000000"
                className="mt-1 w-full px-3 py-2 rounded-lg bg-background/60 border border-white/10 focus:border-purple-400/60 focus:outline-none text-sm font-mono"
              />
            </div>
            <div className="w-full sm:w-32">
              <label className="text-[11px] text-muted-foreground">Amount</label>
              <input
                type="number"
                min={0}
                value={grantAmount}
                onChange={(e) => setGrantAmount(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg bg-background/60 border border-white/10 focus:border-purple-400/60 focus:outline-none text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={grantBusy}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:opacity-90 text-white text-sm font-medium disabled:opacity-60"
            >
              {grantBusy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              Grant
            </button>
          </form>
          {grantError && (
            <div className="mt-2 text-xs text-red-300 flex items-center gap-1">
              <AlertCircle className="w-3.5 h-3.5" /> {grantError}
            </div>
          )}
        </div>

        {credits.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground border border-dashed border-white/10 rounded-lg">
            No credit balances yet. Use the form above to grant credits.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-white/10">
            <table className="min-w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted-foreground bg-white/5">
                <tr>
                  <th className="text-left font-medium px-4 py-2">User</th>
                  <th className="text-left font-medium px-4 py-2">Balance</th>
                  <th className="text-left font-medium px-4 py-2">Updated</th>
                  <th className="text-right font-medium px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {credits.map((c) => {
                  const busy = pendingUserId === c.user_id
                  const flash = flashUserId === c.user_id
                  const customRaw = customAmounts[c.user_id] ?? ""
                  const customNum = Number(customRaw)
                  const customValid =
                    customRaw !== "" &&
                    Number.isFinite(customNum) &&
                    customNum >= 0
                  return (
                    <tr
                      key={c.user_id}
                      className={`align-top ${flash ? "bg-emerald-500/5" : "hover:bg-white/5"}`}
                    >
                      <td className="px-4 py-2 font-mono text-xs">
                        <div className="text-foreground">
                          {c.owner_email ?? "—"}
                        </div>
                        <div className="text-muted-foreground" title={c.user_id}>
                          {shortId(c.user_id)}
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <div className="inline-flex items-center gap-1 text-base font-semibold tabular-nums">
                          {c.credits_balance}
                          {flash && (
                            <Check className="w-4 h-4 text-emerald-300" />
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">
                        {formatDate(c.updated_at)}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap items-center gap-1.5 justify-end">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              void adjustCredits(c.user_id, "add", 1).catch(() => {})
                            }}
                            className="px-2.5 py-1 rounded-md border border-white/10 text-xs hover:border-glow-primary/40 hover:text-glow-primary disabled:opacity-50"
                          >
                            +1
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              void adjustCredits(c.user_id, "add", 5).catch(() => {})
                            }}
                            className="px-2.5 py-1 rounded-md border border-white/10 text-xs hover:border-glow-primary/40 hover:text-glow-primary disabled:opacity-50"
                          >
                            +5
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              void adjustCredits(c.user_id, "add", 10).catch(() => {})
                            }}
                            className="px-2.5 py-1 rounded-md border border-white/10 text-xs hover:border-glow-primary/40 hover:text-glow-primary disabled:opacity-50"
                          >
                            +10
                          </button>
                          <input
                            type="number"
                            min={0}
                            placeholder="Set…"
                            value={customRaw}
                            onChange={(e) =>
                              setCustomAmounts((prev) => ({
                                ...prev,
                                [c.user_id]: e.target.value,
                              }))
                            }
                            className="w-20 px-2 py-1 rounded-md bg-background/60 border border-white/10 text-xs"
                          />
                          <button
                            type="button"
                            disabled={busy || !customValid}
                            onClick={() => {
                              if (!customValid) return
                              void adjustCredits(
                                c.user_id,
                                "set",
                                Math.trunc(customNum),
                              )
                                .then(() => {
                                  setCustomAmounts((prev) => ({
                                    ...prev,
                                    [c.user_id]: "",
                                  }))
                                })
                                .catch(() => {})
                            }}
                            className="px-2.5 py-1 rounded-md border border-white/10 text-xs hover:border-glow-primary/40 hover:text-glow-primary disabled:opacity-50"
                          >
                            Set
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              if (
                                confirm(
                                  `Reset balance for ${c.owner_email ?? c.user_id} to 0?`,
                                )
                              ) {
                                void adjustCredits(c.user_id, "reset").catch(
                                  () => {},
                                )
                              }
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-red-400/30 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                          >
                            <RotateCcw className="w-3 h-3" /> Reset
                          </button>
                          {busy && (
                            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionShell>
    </div>
  )
}

// ── Shared UI ───────────────────────────────────────────────────────
function SectionShell({
  title,
  loading,
  error,
  onRefresh,
  children,
}: {
  title: string
  loading: boolean
  error: string | null
  onRefresh: () => void
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        <button
          onClick={onRefresh}
          className="text-xs flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-white/10 hover:border-glow-primary/40 hover:text-glow-primary transition-colors text-muted-foreground"
          disabled={loading}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>
      {error && (
        <div className="mb-4 rounded-md border border-rose-500/30 bg-rose-500/10 text-rose-200 text-sm p-3">
          {error}
        </div>
      )}
      {loading && !error ? (
        <div className="py-12 flex justify-center text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : (
        children
      )}
    </section>
  )
}

function DataTable({
  head,
  rows,
}: {
  head: string[]
  rows: React.ReactNode[][]
}) {
  if (rows.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground border border-dashed border-white/10 rounded-lg">
        Nothing to show.
      </div>
    )
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10 bg-card/40">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10 text-xs uppercase tracking-wider text-muted-foreground">
            {head.map((h) => (
              <th key={h} className="text-left font-medium px-4 py-3">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors"
            >
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-3 align-middle">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Pill({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "bad"
  children: React.ReactNode
}) {
  const cls =
    tone === "ok"
      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/25"
      : tone === "warn"
        ? "bg-amber-500/15 text-amber-300 border-amber-500/25"
        : "bg-rose-500/15 text-rose-300 border-rose-500/25"
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-medium ${cls}`}>
      {children}
    </span>
  )
}

function ActionButton({
  title,
  onClick,
  disabled,
  variant,
  children,
}: {
  title: string
  onClick: () => void
  disabled?: boolean
  variant: "default" | "danger"
  children: React.ReactNode
}) {
  const cls =
    variant === "danger"
      ? "border-rose-500/30 text-rose-300 hover:bg-rose-500/10"
      : "border-white/15 text-foreground hover:border-glow-primary/40 hover:text-glow-primary"
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border ${cls} transition-colors disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  )
}

interface HealthRow {
  /** Unique React key for this row (analysis-row id or track id). */
  key: string
  /** The track that the per-row actions operate on. */
  trackId: string
  /** Human-readable title used in confirm() prompts and tooltips. */
  title: string
  /** Primary label shown on the left of the row. */
  left: string
  /** Secondary label shown on the right (typically a timestamp). */
  right: string
  /** Whether the track is currently published — controls "Hide" visibility. */
  published: boolean
  /** Whether the track has an audio_url — controls "Re-analyze" availability. */
  audioPresent: boolean
}

/**
 * Visual severity for a health block. Each tone maps to a coordinated
 * border / background / accent palette plus a label colour for the
 * "Fix all" button so admin can scan the section at a glance.
 */
type HealthTone = "critical" | "warning" | "error"

const HEALTH_TONES: Record<
  HealthTone,
  { border: string; bg: string; rule: string; chip: string; fixBtn: string }
> = {
  critical: {
    border: "border-rose-500/40",
    bg: "bg-rose-500/5",
    rule: "divide-rose-500/15",
    chip: "bg-rose-500/15 text-rose-200 border-rose-500/30",
    fixBtn:
      "border-rose-500/40 text-rose-200 hover:bg-rose-500/15 hover:border-rose-400",
  },
  warning: {
    border: "border-amber-500/40",
    bg: "bg-amber-500/5",
    rule: "divide-amber-500/15",
    chip: "bg-amber-500/15 text-amber-200 border-amber-500/30",
    fixBtn:
      "border-amber-500/40 text-amber-200 hover:bg-amber-500/15 hover:border-amber-400",
  },
  error: {
    border: "border-rose-600/60",
    bg: "bg-rose-600/10",
    rule: "divide-rose-600/20",
    chip: "bg-rose-600/20 text-rose-100 border-rose-500/40",
    fixBtn:
      "border-rose-500/50 text-rose-100 hover:bg-rose-600/20 hover:border-rose-400",
  },
}

function HealthBlock({
  id,
  tone,
  icon,
  title,
  description,
  empty,
  rows,
  busyId,
  onReanalyze,
  onHide,
  onDelete,
  onFixAll,
  fixProgress,
}: {
  id: HealthBlockId
  tone: HealthTone
  icon: string
  title: string
  description?: string
  empty: string
  rows: HealthRow[]
  busyId: string | null
  onReanalyze: (trackId: string) => void
  onHide: (trackId: string) => void
  onDelete: (trackId: string, title: string) => void
  /** Optional bulk re-analyze handler. Hidden when null. */
  onFixAll: (() => void) | null
  /** Live progress for the bulk re-analyze on THIS block, or null. */
  fixProgress: FixProgress | null
}) {
  const palette = HEALTH_TONES[tone]
  const isFixing = !!fixProgress
  const empty_ = rows.length === 0

  return (
    <div
      data-health-block={id}
      className={`rounded-xl border ${palette.border} ${palette.bg} backdrop-blur-sm`}
    >
      <header className="flex items-start justify-between gap-3 px-4 py-3 border-b border-white/5">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <span aria-hidden>{icon}</span>
            <span className="truncate">{title}</span>
          </h3>
          {description && (
            <p className="text-xs text-muted-foreground mt-1">{description}</p>
          )}
        </div>
        {onFixAll && !empty_ && (
          <div className="flex items-center gap-2 shrink-0">
            {isFixing && (
              <span
                role="status"
                aria-live="polite"
                aria-atomic="true"
                className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11px] font-medium tabular-nums ${palette.chip}`}
              >
                <Loader2 className="w-3 h-3 animate-spin" aria-hidden />
                Re-analyzing {fixProgress!.done} / {fixProgress!.total}
                {fixProgress!.failed > 0 && (
                  <span className="text-rose-300">· {fixProgress!.failed} failed</span>
                )}
              </span>
            )}
            <button
              onClick={onFixAll}
              // Disable while a bulk run is going OR while a single-row
              // mutation is in flight anywhere in the section — see the
              // bidirectional lock note in fixAll().
              disabled={isFixing || busyId !== null}
              aria-busy={isFixing}
              title={
                busyId
                  ? "Wait for the in-flight per-row action to finish"
                  : `Re-analyze every track in this list (${rows.length})`
              }
              className={`text-xs flex items-center gap-1.5 px-3 py-1.5 rounded-md border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${palette.fixBtn}`}
            >
              <Sparkles className="w-3.5 h-3.5" aria-hidden />
              Fix all (Re-analyze)
            </button>
          </div>
        )}
      </header>
      {empty_ ? (
        <div className="px-4 py-3 text-xs text-muted-foreground">{empty}</div>
      ) : (
        <div className={`divide-y ${palette.rule}`}>
          {rows.map((r) => (
            <div
              key={r.key}
              className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
            >
              <div className="min-w-0 flex-1">
                <div className="text-foreground truncate" title={r.left}>
                  {r.left}
                </div>
                <div className="text-[10px] text-muted-foreground tabular-nums">
                  {r.right}
                </div>
              </div>
              <TrackActions
                trackId={r.trackId}
                title={r.title}
                published={r.published}
                audioPresent={r.audioPresent}
                busy={busyId === r.trackId || isFixing}
                onReanalyze={() => onReanalyze(r.trackId)}
                // From a health list it's rare to want to PUBLISH a still-
                // broken track, so we only expose the toggle when it's
                // currently published (i.e. as a Hide button).
                onTogglePublish={r.published ? () => onHide(r.trackId) : null}
                onDelete={() => onDelete(r.trackId, r.title)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
