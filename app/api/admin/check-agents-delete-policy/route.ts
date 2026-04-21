import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

/**
 * GET /api/admin/check-agents-delete-policy
 *
 * Diagnostic. Reproduces the exact symptom the Studio Agents UI hit when
 * the DELETE policy was missing on `public.agents`:
 *
 *   1. Mints an admin magic-link for the caller's email.
 *   2. Exchanges it for a real authenticated JWT.
 *   3. Picks one of the caller's own agent rows and runs the same DELETE
 *      query the browser runs, but with `Prefer: count=exact` AND a
 *      sentinel filter (`id=eq.<row>` + `user_id=eq.<self>`) that should
 *      NEVER match more than one row — and we deliberately use a fake id
 *      so it matches ZERO rows by intent.
 *   4. Reads the response Content-Range. If the policy is healthy we
 *      get `*/0` (zero rows matched, by intent). If the policy is missing
 *      we'd still get `*/0` but for the wrong reason — so we ALSO run an
 *      explicit pg_policies probe via a SECURITY DEFINER RPC if available.
 *
 * Authentication: same admin model as /api/admin/migrations.
 */

const supabaseUrl       = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnon      = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabaseService   = process.env.SUPABASE_SERVICE_ROLE_KEY
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? "")
  .split(",").map(e => e.trim().toLowerCase()).filter(Boolean)

export async function GET(request: NextRequest) {
  if (!supabaseService) {
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 })
  }
  if (ADMIN_EMAILS.length === 0) {
    return NextResponse.json({ error: "ADMIN_EMAILS not configured" }, { status: 503 })
  }

  // 1. Auth the caller as an admin user.
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "")
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const userClient = createClient(supabaseUrl, supabaseAnon, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: { user }, error: uErr } = await userClient.auth.getUser()
  if (uErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const email = (user.email ?? "").toLowerCase()
  if (!ADMIN_EMAILS.includes(email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // 2. Service role: pick one row owned by the caller (any status). We will
  //    NOT delete it — we'll only attempt a DELETE filtered to a deliberately
  //    impossible id, so the response Content-Range tells us whether RLS is
  //    even letting DELETE matchmaking happen.
  const admin = createClient(supabaseUrl, supabaseService, { auth: { persistSession: false } })

  const { data: rows } = await admin
    .from("agents")
    .select("id, user_id, status")
    .eq("user_id", user.id)
    .limit(1)

  const sampleAgent = rows?.[0]
  if (!sampleAgent) {
    return NextResponse.json({
      ok: false,
      reason: "no agents owned by caller — create one first to run this probe",
    })
  }

  // 3. Mint a real JWT for the caller (admin magic link → verify GET).
  const linkRes = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey:          supabaseService,
      Authorization:   `Bearer ${supabaseService}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({ type: "magiclink", email: user.email }),
  })
  const linkJson = await linkRes.json()
  const hashedToken: string | undefined = linkJson?.hashed_token
  if (!hashedToken) {
    return NextResponse.json({ ok: false, reason: "could not mint magic link", linkJson }, { status: 500 })
  }

  const verifyRes = await fetch(
    `${supabaseUrl}/auth/v1/verify?token=${hashedToken}&type=magiclink`,
    { method: "GET", redirect: "manual", headers: { apikey: supabaseAnon } }
  )
  const loc = verifyRes.headers.get("location") ?? ""
  const accessToken = loc.match(/access_token=([^&]+)/)?.[1]
  if (!accessToken) {
    return NextResponse.json({ ok: false, reason: "could not exchange magic link", location: loc }, { status: 500 })
  }

  // 4. Run two probes:
  //    A) DELETE that should match the real row → tells us if RLS lets us delete.
  //       We use a transaction-style trick: filter by an impossible status so
  //       no row is actually deleted but PostgREST still evaluates the DELETE.
  //       (We cannot SAVEPOINT through PostgREST, so we use a guaranteed-empty
  //       filter `status=eq.__never__` that still requires the policy to apply.)
  const probeRes = await fetch(
    `${supabaseUrl}/rest/v1/agents?id=eq.${sampleAgent.id}&user_id=eq.${user.id}&status=eq.__never__`,
    {
      method: "DELETE",
      headers: {
        apikey:        supabaseAnon,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type":"application/json",
        Prefer:        "count=exact",
      },
    }
  )
  const probeRange = probeRes.headers.get("content-range")
  const probeStatus = probeRes.status
  const probeBody = await probeRes.text()

  //    B) Look up the policy via service role through pg_catalog (only works
  //       if a SECURITY DEFINER helper RPC is installed; otherwise we skip).
  let policyRowsViaRpc: unknown = "rpc not installed (optional)"
  const rpc = await admin.rpc("debug_pg_policies_for_agents")
  if (!rpc.error) policyRowsViaRpc = rpc.data

  // Interpretation:
  //   probeStatus 200 + probeRange "*/0" + no error → DELETE was *evaluated*
  //   by the database. If the policy is missing, you'd get the same shape but
  //   the policyRowsViaRpc check (if installed) shows zero DELETE policies.
  return NextResponse.json({
    sample_agent: sampleAgent,
    probe: {
      status:        probeStatus,
      content_range: probeRange,
      body:          probeBody,
    },
    policy_rows_via_rpc: policyRowsViaRpc,
    interpretation:
      probeStatus === 200 && probeRange === "*/0"
        ? "DELETE was accepted by PostgREST. To truly verify the policy: in Supabase SQL Editor run `select policyname, cmd from pg_policies where tablename='agents';` — you must see a row with cmd='DELETE' and policyname='agents_delete_own'."
        : `Unexpected probe result: status=${probeStatus} range=${probeRange}. Inspect body.`,
  })
}
