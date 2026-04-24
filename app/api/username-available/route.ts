import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { checkRateLimit } from "@/lib/rate-limit"
import { getServiceRoleKey } from "@/lib/supabase-admin"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
// Resolved via the central helper so the SUPABASE_SERVICE_KEY /
// SUPABASE_SERVICE_ROLE legacy aliases also work.
const supabaseServiceKey = getServiceRoleKey()

export async function GET(request: NextRequest) {
  if (!supabaseServiceKey) {
    console.error("[username-available] SUPABASE_SERVICE_ROLE_KEY is not set")
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 })
  }

  if (
    await checkRateLimit(request, {
      windowMs: 60_000,
      maxRequests: 20,
      label: "username-available",
    })
  ) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429 }
    )
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  })

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

  const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/
  if (!USERNAME_REGEX.test(username)) {
    return NextResponse.json(
      { available: false, reason: "invalid_format" },
      { status: 200, headers: { "Cache-Control": "no-store" } }
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

    const available = data === true
    return NextResponse.json(
      available ? { available: true } : { available: false, reason: "taken" },
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
