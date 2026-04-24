import { NextRequest } from "next/server"
import { createClient, SupabaseClient } from "@supabase/supabase-js"
import { getServiceRoleKey } from "./supabase-admin"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
// Resolved via the central helper so the SUPABASE_SERVICE_KEY /
// SUPABASE_SERVICE_ROLE legacy aliases also work.
const supabaseServiceKey = getServiceRoleKey()

export interface RateLimitOptions {
  windowMs?: number
  maxRequests?: number
  label?: string
}

const DEFAULT_WINDOW_MS = 60_000
const DEFAULT_MAX_REQUESTS = 20

export function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  )
}

const ipBucketsFallback = new Map<string, number[]>()

function isRateLimitedFallback(
  ip: string,
  windowMs: number,
  maxRequests: number,
  label: string
): boolean {
  const now = Date.now()
  const windowStart = now - windowMs
  const key = `${label}:${ip}:${windowMs}:${maxRequests}`

  let timestamps = ipBucketsFallback.get(key) ?? []
  timestamps = timestamps.filter((t) => t > windowStart)

  if (timestamps.length >= maxRequests) {
    ipBucketsFallback.set(key, timestamps)
    return true
  }

  timestamps.push(now)
  ipBucketsFallback.set(key, timestamps)
  return false
}

async function isRateLimitedViaDb(
  supabase: SupabaseClient,
  ip: string,
  windowMs: number,
  maxRequests: number,
  label: string
): Promise<boolean> {
  try {
    const { data, error } = await (supabase.rpc as CallableFunction)(
      "check_rate_limit",
      { client_ip: ip, window_ms: windowMs, max_requests: maxRequests }
    ) as { data: boolean | null; error: { message: string } | null }

    if (error) {
      console.warn(
        `[rate-limit:${label}] DB check failed, using fallback:`,
        error.message
      )
      return isRateLimitedFallback(ip, windowMs, maxRequests, label)
    }

    return data === true
  } catch (err) {
    console.warn(
      `[rate-limit:${label}] DB check threw, using fallback:`,
      err
    )
    return isRateLimitedFallback(ip, windowMs, maxRequests, label)
  }
}

/**
 * Checks whether the incoming request should be rate-limited.
 *
 * Uses the shared DB-backed `check_rate_limit` RPC. Falls back to a
 * per-process in-memory store if the database is unavailable.
 *
 * Returns `true` if the caller has exceeded the limit (respond with 429).
 * Returns `false` if the request is within the allowed rate.
 */
export async function checkRateLimit(
  request: NextRequest,
  options: RateLimitOptions = {}
): Promise<boolean> {
  const {
    windowMs = DEFAULT_WINDOW_MS,
    maxRequests = DEFAULT_MAX_REQUESTS,
    label = "api",
  } = options

  if (!supabaseServiceKey) {
    console.warn(
      `[rate-limit:${label}] SUPABASE_SERVICE_ROLE_KEY not set — using in-memory fallback`
    )
    const ip = getClientIp(request)
    return isRateLimitedFallback(ip, windowMs, maxRequests, label)
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  })

  const ip = getClientIp(request)
  return isRateLimitedViaDb(supabase, ip, windowMs, maxRequests, label)
}
