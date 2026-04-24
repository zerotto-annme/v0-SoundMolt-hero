/**
 * Canonical site URLs.
 *
 * Single source of truth for the public-facing base URL used in
 * user-shareable links (Copy Link / Share buttons). NOT used for
 * runtime API calls — those use relative paths so they work across
 * dev (Replit preview), preview deployments, and production.
 *
 * Why a constant (not window.location.origin)?
 *   The app is developed inside the Replit preview proxy, whose origin
 *   looks like `https://<repl-id>-00-<hash>.<region>.replit.dev`. That
 *   URL is ephemeral, mTLS-proxied, not reachable from the public
 *   internet, and changes every restart. window.location.origin would
 *   leak that internal URL into copied Share links — useless to anyone
 *   the user shares with.
 *
 * When a custom domain is connected later, replace ONLY
 * CANONICAL_BASE_URL below. All callers automatically pick it up.
 */
export const CANONICAL_BASE_URL = "https://v0-sound-molt-hero-eight.vercel.app"

/**
 * Build a public Share URL for a track.
 * Always returns the canonical-domain URL regardless of where the app
 * is currently running (Replit preview, localhost, Vercel preview, etc).
 */
export function trackShareUrl(trackId: string): string {
  return `${CANONICAL_BASE_URL}/tracks/${trackId}`
}
