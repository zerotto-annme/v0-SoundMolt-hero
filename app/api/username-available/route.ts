import { NextRequest, NextResponse } from "next/server"
import { createClient, SupabaseClient } from "@supabase/supabase-js"

const WINDOW_MS = 60_000
const MAX_REQUESTS = 20

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  )
}

// In-memory fallback used only when the shared DB store is unavailable.
const ipBucketsFallback = new Map<string, number[]>()

function isRateLimitedFallback(ip: string): boolean {
  const now = Date.now()
  const windowStart = now - WINDOW_MS

  let timestamps = ipBucketsFallback.get(ip) ?? []
  timestamps = timestamps.filter((t) => t > windowStart)

  if (timestamps.length >= MAX_REQUESTS) {
    ipBucketsFallback.set(ip, timestamps)
    return true
  }

  timestamps.push(now)
  ipBucketsFallback.set(ip, timestamps)
  return false
}

async function isRateLimited(
  supabase: SupabaseClient,
  ip: string
): Promise<boolean> {
  try {
    // The check_rate_limit RPC is not in the generated schema types, so we
    // call it via the untyped overload. The function is service-role only
    // and the return type is a simple boolean.
    const { data, error } = await (supabase.rpc as CallableFunction)(
      "check_rate_limit",
      { client_ip: ip, window_ms: WINDOW_MS, max_requests: MAX_REQUESTS }
    ) as { data: boolean | null; error: { message: string } | null }

    if (error) {
      console.warn("[username-available] DB rate-limit check failed, using fallback:", error.message)
      return isRateLimitedFallback(ip)
    }

    return data === true
  } catch (err) {
    console.warn("[username-available] DB rate-limit check threw, using fallback:", err)
    return isRateLimitedFallback(ip)
  }
}

export async function GET(request: NextRequest) {
  if (!supabaseServiceKey) {
    console.error("[username-available] SUPABASE_SERVICE_ROLE_KEY is not set")
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 })
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  })

  const ip = getClientIp(request)

  if (await isRateLimited(supabase, ip)) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429 }
    )
  }

  const username = request.nextUrl.searchParams.get("username")?.trim()

  if (!username) {
    return NextResponse.json({ error: "username parameter is required" }, { status: 400 })
  }

  if (username.length < 3 || username.length > 30) {
    return NextResponse.json(
      { error: "Username must be between 3 and 30 characters." },
      { status: 400 }
    )
  }

  try {
    const { data, error } = await supabase.rpc("is_username_available", {
      check_username: username,
    })

    if (error) {
      console.error("[username-available] Supabase error:", error)
      return NextResponse.json({ error: "Failed to check username" }, { status: 500 })
    }

    return NextResponse.json(
      { available: data === true },
      {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      }
    )
  } catch (err) {
    console.error("[username-available] Unexpected error:", err)
    return NextResponse.json({ error: "Failed to check username" }, { status: 500 })
  }
}
