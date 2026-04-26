import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/admin-auth"

// GET  /api/admin/ai-producer/credits   → list every user_credits row
// POST /api/admin/ai-producer/credits   → adjust a user's balance
//
// Admin-only. Used by /admin/ai-producer "User Credits" block.
//
// POST body:
//   { user_id: uuid, action: "add" | "set" | "reset", amount?: number }
//
// Behaviour:
//   • "add"   — new_balance = max(0, current + amount).  amount required.
//   • "set"   — new_balance = max(0, amount).            amount required.
//   • "reset" — new_balance = 0.                          amount ignored.
//
// On every change we:
//   1. upsert user_credits with the new balance
//   2. insert a credit_transactions ledger row
//        type   = 'admin_gift'           (covers grants AND zero-outs in this admin-only path)
//        reason = 'admin manual adjustment'
//        amount = (new_balance - old_balance)   ← signed delta
//
// No payment integration. This is the single source of truth for
// manually adjusting credits during testing.

export const dynamic = "force-dynamic"

function isLikelyUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f-]{32,36}$/i.test(value)
}

function readInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Math.trunc(Number(value))
  }
  return null
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (!auth.ok) return auth.response
  const { admin } = auth

  const { data: rows, error } = await admin
    .from("user_credits")
    .select("user_id, credits_balance, updated_at")
    .order("updated_at", { ascending: false })
    .limit(500)

  if (error) {
    console.error("[admin/ai-producer/credits] list failed:", error)
    return NextResponse.json(
      { error: "list_failed", message: error.message ?? "Failed to load credits." },
      { status: 500 },
    )
  }

  // Best-effort email enrichment.
  const emailById = new Map<string, string | null>()
  try {
    const { data: usersPage } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
    for (const u of usersPage?.users ?? []) {
      emailById.set(u.id, u.email ?? null)
    }
  } catch (err) {
    console.warn("[admin/ai-producer/credits] listUsers enrichment failed:", err)
  }

  const enriched = (rows ?? []).map((r: any) => ({
    ...r,
    owner_email: emailById.get(r.user_id) ?? null,
  }))

  return NextResponse.json({ ok: true, credits: enriched })
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (!auth.ok) return auth.response
  const { admin } = auth

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 })
  }

  const userId = body?.user_id
  if (!isLikelyUuid(userId)) {
    return NextResponse.json(
      { error: "invalid_user_id", message: "user_id must be a UUID." },
      { status: 400 },
    )
  }

  const action = body?.action
  if (action !== "add" && action !== "set" && action !== "reset") {
    return NextResponse.json(
      { error: "invalid_action", message: "action must be 'add', 'set' or 'reset'." },
      { status: 400 },
    )
  }

  let amount: number | null = null
  if (action !== "reset") {
    amount = readInt(body?.amount)
    if (amount === null) {
      return NextResponse.json(
        { error: "invalid_amount", message: "amount must be an integer." },
        { status: 400 },
      )
    }
  }

  // Verify the auth user actually exists — protects against typo'd
  // UUIDs creating ghost user_credits rows.
  try {
    const { data: u, error: uErr } = await admin.auth.admin.getUserById(userId)
    if (uErr || !u?.user) {
      return NextResponse.json(
        { error: "user_not_found", message: "No auth user with that id." },
        { status: 404 },
      )
    }
  } catch (err) {
    console.error("[admin/ai-producer/credits] getUserById threw:", err)
    return NextResponse.json(
      { error: "user_lookup_failed", message: "Could not verify user." },
      { status: 500 },
    )
  }

  // ─── 1. Read current balance (treat missing row as 0) ──────────────
  let currentBalance = 0
  try {
    const { data: existing, error: readErr } = await admin
      .from("user_credits")
      .select("credits_balance")
      .eq("user_id", userId)
      .maybeSingle()
    if (readErr) {
      console.error("[admin/ai-producer/credits] read failed:", readErr)
      return NextResponse.json(
        { error: "read_failed", message: readErr.message },
        { status: 500 },
      )
    }
    if (existing && typeof existing.credits_balance === "number") {
      currentBalance = existing.credits_balance
    }
  } catch (err) {
    console.error("[admin/ai-producer/credits] read threw:", err)
    return NextResponse.json({ error: "read_threw" }, { status: 500 })
  }

  // ─── 2. Compute new balance per action ─────────────────────────────
  let newBalance: number
  if (action === "add") {
    newBalance = Math.max(0, currentBalance + (amount ?? 0))
  } else if (action === "set") {
    newBalance = Math.max(0, amount ?? 0)
  } else {
    newBalance = 0
  }

  const delta = newBalance - currentBalance

  // ─── 3. Upsert balance ─────────────────────────────────────────────
  const { error: upsertErr } = await admin
    .from("user_credits")
    .upsert(
      { user_id: userId, credits_balance: newBalance },
      { onConflict: "user_id" },
    )

  if (upsertErr) {
    console.error("[admin/ai-producer/credits] upsert failed:", upsertErr)
    return NextResponse.json(
      { error: "upsert_failed", message: upsertErr.message },
      { status: 500 },
    )
  }

  // ─── 4. Write ledger entry (skip if no actual change) ──────────────
  if (delta !== 0) {
    const { error: txErr } = await admin
      .from("credit_transactions")
      .insert({
        user_id: userId,
        amount: delta,
        type: "admin_gift",
        reason: "admin manual adjustment",
      })
    if (txErr) {
      console.error("[admin/ai-producer/credits] ledger insert failed:", txErr)
      // Don't fail the request — balance was updated and the mismatch
      // is observable in the logs. (Idempotency-friendly for retries.)
    }
  }

  return NextResponse.json({
    ok: true,
    user_id: userId,
    previous_balance: currentBalance,
    credits_balance: newBalance,
    delta,
  })
}
