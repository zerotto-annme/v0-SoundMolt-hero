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

  // ─── Direct service-role adjustment (no RPC, no migration) ─────────
  // The SECURITY DEFINER admin_adjust_credits RPC from migration 044
  // is intentionally NOT used here — that migration was never applied
  // to the live Supabase project, and the spec requires this endpoint
  // to work without it.
  //
  // Concurrency strategy: we compare-and-swap on user_credits.updated_at.
  // The user_credits_updated_at trigger bumps updated_at to now() on
  // every UPDATE, so it acts as a natural row version token. For "add"
  // this prevents lost updates (two simultaneous +10 grants land as
  // +20, not +10). For "set"/"reset" the same loop guarantees that the
  // ledger's signed delta accurately reflects the actual balance
  // transition (not a stale read).
  //
  // Sequence per attempt:
  //   1. Read current row (null → balance 0).
  //   2. Compute new_balance (clamped to ≥ 0 to satisfy the CHECK).
  //   3a. If row exists → UPDATE … WHERE updated_at = readVersion.
  //       0 rows updated ⇒ another admin moved it; retry.
  //   3b. If row missing → INSERT. Unique-violation on user_id ⇒ a
  //       concurrent insert won; retry (which will hit the UPDATE path).
  //   4. On success, INSERT credit_transactions with signed delta.

  const MAX_ATTEMPTS = 5
  let previousBalance = 0
  let newBalance = 0
  let committed = false

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // 1. Read current row.
    const { data: existing, error: readErr } = await admin
      .from("user_credits")
      .select("credits_balance, updated_at")
      .eq("user_id", userId)
      .maybeSingle()
    if (readErr) {
      console.error("[admin/ai-producer/credits] read balance failed:", readErr)
      return NextResponse.json(
        { error: "adjust_failed", message: readErr.message },
        { status: 500 },
      )
    }

    const currentBalance = existing?.credits_balance ?? 0
    const currentVersion = existing?.updated_at ?? null

    // 2. Compute new_balance.
    let nextBalance: number
    if (action === "reset") {
      nextBalance = 0
    } else if (action === "set") {
      nextBalance = Math.max(0, amount as number)
    } else {
      // "add"
      nextBalance = Math.max(0, currentBalance + (amount as number))
    }

    if (existing) {
      // 3a. CAS UPDATE — guarded by updated_at matching what we read.
      // The trigger then writes a new updated_at, so the next CAS by
      // another admin will see a different version.
      const { data: updRows, error: updErr } = await admin
        .from("user_credits")
        .update({ credits_balance: nextBalance })
        .eq("user_id", userId)
        .eq("updated_at", currentVersion as string)
        .select("user_id")
      if (updErr) {
        console.error("[admin/ai-producer/credits] update failed:", updErr)
        return NextResponse.json(
          { error: "adjust_failed", message: updErr.message },
          { status: 500 },
        )
      }
      if (!updRows || updRows.length === 0) {
        // Lost the race — another admin updated this row first.
        // Loop and re-read.
        continue
      }
    } else {
      // 3b. INSERT a fresh row. If another admin concurrently created
      // one, the user_id PK constraint will reject us — retry to take
      // the UPDATE path.
      const { error: insErr } = await admin
        .from("user_credits")
        .insert({ user_id: userId, credits_balance: nextBalance })
      if (insErr) {
        // 23505 = unique_violation in Postgres. Anything else is fatal.
        const code = (insErr as { code?: string }).code
        if (code === "23505") continue
        console.error("[admin/ai-producer/credits] insert failed:", insErr)
        return NextResponse.json(
          { error: "adjust_failed", message: insErr.message },
          { status: 500 },
        )
      }
    }

    previousBalance = currentBalance
    newBalance = nextBalance
    committed = true
    break
  }

  // If we exhausted retries, surface a clear error so the admin can
  // click again rather than getting silent corruption. In practice 5
  // attempts is plenty for a single-admin panel; this branch only
  // trips under pathological contention.
  if (!committed) {
    return NextResponse.json(
      {
        error: "adjust_failed",
        message: "Could not commit credit adjustment after retries — please try again.",
      },
      { status: 500 },
    )
  }

  // 4. Append ledger row. We log even zero-delta no-ops so an admin
  // can audit every click; the ledger is the source of truth for
  // *what was attempted*, the balance for *what is*.
  const delta = newBalance - previousBalance
  const { error: ledgerErr } = await admin
    .from("credit_transactions")
    .insert({
      user_id: userId,
      amount: delta,
      type: "admin_gift",
      reason: "admin manual adjustment",
      review_id: null,
    })
  if (ledgerErr) {
    // Balance has already moved — surface the failure so the admin
    // knows the ledger is out of sync, but don't try to "undo" the
    // upsert (that itself can fail and make things worse).
    console.error("[admin/ai-producer/credits] ledger insert failed:", ledgerErr)
    return NextResponse.json(
      {
        error: "ledger_write_failed",
        message: `Balance updated to ${newBalance} but ledger insert failed: ${ledgerErr.message}`,
      },
      { status: 500 },
    )
  }

  return NextResponse.json({
    ok: true,
    user_id: userId,
    previous_balance: previousBalance,
    credits_balance: newBalance,
    delta,
  })
}
