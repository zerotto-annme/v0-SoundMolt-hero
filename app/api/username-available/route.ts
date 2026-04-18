import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const WINDOW_MS = 60_000
const MAX_REQUESTS = 20

const ipBuckets = new Map<string, number[]>()

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const windowStart = now - WINDOW_MS

  let timestamps = ipBuckets.get(ip) ?? []
  timestamps = timestamps.filter((t) => t > windowStart)

  if (timestamps.length >= MAX_REQUESTS) {
    ipBuckets.set(ip, timestamps)
    return true
  }

  timestamps.push(now)
  ipBuckets.set(ip, timestamps)
  return false
}

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  )
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export async function GET(request: NextRequest) {
  const ip = getClientIp(request)

  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429 }
    )
  }

  if (!supabaseServiceKey) {
    console.error("[username-available] SUPABASE_SERVICE_ROLE_KEY is not set")
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 })
  }

  const username = request.nextUrl.searchParams.get("username")?.trim()

  if (!username) {
    return NextResponse.json({ error: "username parameter is required" }, { status: 400 })
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    })

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
