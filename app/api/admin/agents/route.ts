import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/admin-auth"
import {
  generateAgentApiKey,
  hashAgentApiKey,
  getAgentApiKeyLast4,
} from "@/lib/agent-api-keys"

export const dynamic = "force-dynamic"

/**
 * Canonical list of capability strings. Mirrors the union enforced server-
 * side in `lib/agent-api.ts` (`requireAgent` middleware) and the default
 * grant set codified by migrations 027 + 035 + 037. Kept here as a literal
 * tuple so we can validate POST input without a runtime import cycle.
 */
const VALID_CAPABILITIES = [
  "read",
  "discuss",
  "publish",
  "upload",
  "like",
  "favorite",
  "post",
  "comment",
  "analysis",
  "social_write",
  "profile_write",
] as const
type Capability = (typeof VALID_CAPABILITIES)[number]
const VALID_CAPABILITY_SET = new Set<string>(VALID_CAPABILITIES)

/**
 * Default capability set applied when the admin submits the create form
 * with zero capabilities checked. Per the task spec: a sensible "social"
 * subset (no upload/publish/profile_write) so a freshly minted agent can
 * read, discuss, react, and analyse but not push tracks or rewrite the
 * owner's profile until the admin explicitly grants those.
 */
const DEFAULT_CAPABILITIES: readonly Capability[] = [
  "read",
  "discuss",
  "post",
  "comment",
  "like",
  "favorite",
  "analysis",
  "social_write",
] as const

/**
 * GET /api/admin/agents
 *
 * Lists every agent with: name, status, owner email, capabilities,
 * connection state, and last activity timestamp.
 *
 * NOTE on schema: the live Supabase `agents` table does NOT have
 * `provider`, `model_name`, or `api_endpoint` columns (those exist only
 * in the original migration file 015 but were never applied to the live DB).
 * We only select columns that actually exist in production.
 *
 * On any error, returns HTTP 200 with `agents: []` plus an `error` field
 * (so the admin UI never breaks just because this query fails).
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (!auth.ok) return auth.response
  const { admin } = auth

  const { data: agents, error } = await admin
    .from("agents")
    .select(
      "id, user_id, name, status, capabilities, connection_code, connected_at, last_active_at, created_at, updated_at, avatar_url, cover_url, description, genre",
    )
    .order("created_at", { ascending: false })

  if (error) {
    console.error("[admin/agents GET] supabase select failed:", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    })
    return NextResponse.json(
      {
        agents: [],
        error: error.message,
        error_code: error.code,
      },
      { status: 200 },
    )
  }

  // Resolve owner emails (parallel).
  const userIds = Array.from(
    new Set((agents ?? []).map((a) => a.user_id).filter(Boolean)),
  )
  const emailByUserId = new Map<string, string | null>()
  await Promise.all(
    userIds.map(async (uid) => {
      try {
        const { data, error: e } = await admin.auth.admin.getUserById(uid)
        if (!e && data?.user) emailByUserId.set(uid, data.user.email ?? null)
      } catch (e) {
        console.warn("[admin/agents GET] getUserById failed for", uid, e)
      }
    }),
  )

  // Telegram-bot connections (1:1 per agent). Optional: if migration 045
  // hasn't been applied yet to this Supabase project, the table won't
  // exist (Postgres 42P01) — that's not fatal here; we just render every
  // agent as "Not connected" until the operator runs the migration.
  const agentIds = (agents ?? []).map((a) => a.id)
  // Sentinel semantics:
  //   - Map has no entry        → not connected (UI shows "Not connected").
  //   - Map value === ""        → connected, but bot has no public username.
  //   - Map value === "foo"     → connected; UI renders "@foo".
  // We must never collapse the "" case down to null, otherwise the UI's
  // null-vs-string check would render a real connection as "Not connected".
  const telegramByAgent = new Map<string, string>()
  if (agentIds.length > 0) {
    const { data: telegrams, error: telegramErr } = await admin
      .from("agent_telegram_bots")
      .select("agent_id, telegram_bot_username")
      .in("agent_id", agentIds)
    if (telegramErr) {
      if (telegramErr.code !== "42P01") {
        console.warn("[admin/agents GET] telegram lookup failed:", {
          code: telegramErr.code,
          message: telegramErr.message,
        })
      }
    } else {
      for (const t of telegrams ?? []) {
        telegramByAgent.set(t.agent_id, t.telegram_bot_username ?? "")
      }
    }
  }

  const result = (agents ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    user_id: a.user_id,
    owner_email: emailByUserId.get(a.user_id) ?? null,
    status: a.status ?? "active",
    capabilities: Array.isArray(a.capabilities) ? a.capabilities : [],
    connection_code: a.connection_code ?? null,
    connected_at: a.connected_at ?? null,
    last_active_at: a.last_active_at ?? a.created_at,
    created_at: a.created_at,
    updated_at: a.updated_at ?? null,
    avatar_url: a.avatar_url ?? null,
    cover_url: a.cover_url ?? null,
    description: a.description ?? null,
    genre: a.genre ?? null,
    // Connected: bot_username (with leading "@" added in UI). Not
    // connected: explicit null. Connected-but-no-username (rare —
    // bot owner hid username) → empty string. Distinguishing "" from
    // null is what lets the admin UI flip the action button to
    // "Telegram Settings" even when the bot has no public username.
    telegram_bot_username: telegramByAgent.has(a.id)
      ? telegramByAgent.get(a.id) ?? ""
      : null,
  }))

  return NextResponse.json({ agents: result })
}

// ─── POST /api/admin/agents ─────────────────────────────────────────────────
//
// Admin-only "Create Agent" endpoint. Inserts a row into public.agents
// using the service-role client (bypasses RLS), then issues an API key
// via the rotate_agent_api_key RPC. The plaintext key is returned to
// the caller exactly once — the admin must copy it then or regenerate
// later via the per-agent api-key endpoint.
//
// Body shape:
//   {
//     name: string                                      // required, 1..100 chars
//     description?: string | null                       // optional, ≤ 1000 chars
//     avatar_url?: string | null                        // optional, ≤ 500 chars
//     owner_user_id?: string | null                     // optional, defaults to admin's own user.id
//     status?: "active" | "inactive" | "disabled"       // optional, defaults to "active"
//     capabilities?: string[]                           // optional, defaults to DEFAULT_CAPABILITIES
//   }
//
// Returns:
//   {
//     agent: <full row from agents>,
//     api_key: string | null,                           // plaintext, shown once. null if key gen failed.
//     api_key_last4: string | null,
//     api_key_error: string | null                      // present + non-null when generation failed
//   }
//
// Security:
//   - requireAdmin() gates the entire handler.
//   - owner_user_id is verified via auth.admin.getUserById() before
//     INSERT to fail fast with a clean 400 instead of an FK violation.
//   - capabilities are validated against VALID_CAPABILITY_SET — unknown
//     strings are rejected (422) so we never store garbage that the
//     agent middleware would silently ignore.

interface CreateAgentBody {
  name?: unknown
  description?: unknown
  avatar_url?: unknown
  owner_user_id?: unknown
  status?: unknown
  capabilities?: unknown
}

const VALID_STATUSES = new Set(["active", "inactive", "disabled"])

/**
 * Validate + trim a string field. Returns:
 *   - { ok: true, value: string }   on success (or { value: null } when missing)
 *   - { ok: false, error: string }  when the value is too long after trim
 *
 * We REJECT overlong input rather than silently truncating, so the admin
 * gets a clean 400 instead of a quietly-corrupted record they can't undo.
 */
function parseStringField(
  v: unknown,
  field: string,
  max: number,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (v === undefined || v === null) return { ok: true, value: null }
  if (typeof v !== "string") {
    return { ok: false, error: `${field} must be a string` }
  }
  const trimmed = v.trim()
  if (trimmed.length === 0) return { ok: true, value: null }
  if (trimmed.length > max) {
    return { ok: false, error: `${field} must be ≤ ${max} characters (got ${trimmed.length})` }
  }
  return { ok: true, value: trimmed }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (!auth.ok) return auth.response
  const { admin, user: adminUser } = auth

  let body: CreateAgentBody
  try {
    body = (await request.json()) as CreateAgentBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  // ── Validate name (the only hard-required field) ─────────────────────────
  const nameRes = parseStringField(body.name, "name", 100)
  if (!nameRes.ok) return NextResponse.json({ error: nameRes.error }, { status: 400 })
  if (!nameRes.value) {
    return NextResponse.json(
      { error: "name is required (1..100 chars after trim)" },
      { status: 400 },
    )
  }
  const name = nameRes.value

  // ── Optional metadata ────────────────────────────────────────────────────
  const descRes = parseStringField(body.description, "description", 1000)
  if (!descRes.ok) return NextResponse.json({ error: descRes.error }, { status: 400 })
  const description = descRes.value

  const avatarRes = parseStringField(body.avatar_url, "avatar_url", 500)
  if (!avatarRes.ok) return NextResponse.json({ error: avatarRes.error }, { status: 400 })
  const avatar_url = avatarRes.value

  // ── Status (UI sends "active" | "disabled"; we keep both literals plus
  //    "inactive" so the existing toggle button keeps working unchanged) ──
  let status = "active"
  if (typeof body.status === "string" && body.status.trim() !== "") {
    const s = body.status.trim()
    if (!VALID_STATUSES.has(s)) {
      return NextResponse.json(
        { error: `status must be one of: ${Array.from(VALID_STATUSES).join(", ")}` },
        { status: 400 },
      )
    }
    status = s
  }

  // ── Capabilities — validate, dedupe, default if empty ────────────────────
  let capabilities: string[]
  if (body.capabilities === undefined || body.capabilities === null) {
    capabilities = [...DEFAULT_CAPABILITIES]
  } else if (!Array.isArray(body.capabilities)) {
    return NextResponse.json(
      { error: "capabilities must be an array of strings" },
      { status: 400 },
    )
  } else {
    // Hard-fail on any non-string entry — admin clients should send a
    // clean string array, and silently dropping bad items would mask
    // bugs in the UI (e.g. accidentally pushing booleans).
    const badType = body.capabilities.find((c) => typeof c !== "string")
    if (badType !== undefined) {
      return NextResponse.json(
        { error: "capabilities must contain only strings" },
        { status: 400 },
      )
    }
    const cleaned = Array.from(
      new Set(
        (body.capabilities as string[])
          .map((c) => c.trim())
          .filter((c) => c.length > 0),
      ),
    )
    const unknown = cleaned.filter((c) => !VALID_CAPABILITY_SET.has(c))
    if (unknown.length > 0) {
      return NextResponse.json(
        {
          error: `Unknown capability values: ${unknown.join(", ")}`,
          valid_capabilities: VALID_CAPABILITIES,
        },
        { status: 422 },
      )
    }
    capabilities = cleaned.length > 0 ? cleaned : [...DEFAULT_CAPABILITIES]
  }

  // ── Owner user id — default to current admin; verify exists ──────────────
  const ownerRes = parseStringField(body.owner_user_id, "owner_user_id", 100)
  if (!ownerRes.ok) return NextResponse.json({ error: ownerRes.error }, { status: 400 })
  const requestedOwner = ownerRes.value
  const ownerUserId = requestedOwner ?? adminUser.id
  if (ownerUserId !== adminUser.id) {
    // Verify the supplied owner exists in auth.users so we get a clean 404
    // rather than a noisy FK violation when the admin types a bad UUID.
    try {
      const { data: ownerLookup, error: ownerErr } =
        await admin.auth.admin.getUserById(ownerUserId)
      if (ownerErr || !ownerLookup?.user) {
        return NextResponse.json(
          { error: `owner_user_id not found: ${ownerUserId}` },
          { status: 404 },
        )
      }
    } catch (e) {
      console.error("[admin/agents POST] owner lookup failed:", e)
      return NextResponse.json(
        { error: "Failed to verify owner_user_id" },
        { status: 500 },
      )
    }
  }

  // ── INSERT the agent row ─────────────────────────────────────────────────
  const insertPayload = {
    user_id: ownerUserId,
    name,
    description,
    avatar_url,
    status,
    capabilities,
  }

  const { data: agentRow, error: insertErr } = await admin
    .from("agents")
    .insert(insertPayload)
    .select(
      "id, user_id, name, status, capabilities, connection_code, connected_at, last_active_at, created_at, updated_at, avatar_url, cover_url, description, genre",
    )
    .single()

  if (insertErr || !agentRow) {
    console.error("[admin/agents POST] insert failed:", {
      payload: { ...insertPayload, capabilities: insertPayload.capabilities.length },
      code: insertErr?.code,
      message: insertErr?.message,
      details: insertErr?.details,
      hint: insertErr?.hint,
    })
    return NextResponse.json(
      {
        error: insertErr?.message ?? "Insert failed",
        error_code: insertErr?.code ?? null,
      },
      { status: 500 },
    )
  }

  // ── Generate the agent's first API key (best-effort, non-blocking) ───────
  // We mirror the rotate-flow used by the user-facing endpoint at
  // app/api/agents/[id]/api-key — primary path is the rotate_agent_api_key
  // RPC; if the function isn't deployed we fall back to a manual
  // revoke + insert. If both fail we still return the freshly-created
  // agent (so the admin sees it) with a `api_key_error` note so they
  // can retry via the per-agent endpoint.
  let api_key: string | null = null
  let api_key_last4: string | null = null
  let api_key_error: string | null = null
  try {
    const plaintext = generateAgentApiKey()
    const api_key_hash = hashAgentApiKey(plaintext)
    const last4 = getAgentApiKeyLast4(plaintext)

    const { error: rpcErr } = await admin.rpc("rotate_agent_api_key", {
      p_agent_id: agentRow.id,
      p_owner_user_id: ownerUserId,
      p_hash: api_key_hash,
      p_last4: last4,
    })

    if (rpcErr) {
      const isMissingFn =
        rpcErr.code === "PGRST202" ||
        /could not find the function/i.test(rpcErr.message ?? "")
      if (!isMissingFn) {
        throw new Error(`rotate_agent_api_key: ${rpcErr.message}`)
      }
      // Fallback: manual revoke + insert (older deployment of 027).
      const { error: revokeErr } = await admin
        .from("agent_api_keys")
        .update({ is_active: false, revoked_at: new Date().toISOString() })
        .eq("agent_id", agentRow.id)
        .eq("is_active", true)
      if (revokeErr) throw new Error(`revoke previous keys: ${revokeErr.message}`)
      const { error: insErr } = await admin.from("agent_api_keys").insert({
        agent_id: agentRow.id,
        owner_user_id: ownerUserId,
        api_key_hash,
        api_key_last4: last4,
        is_active: true,
      })
      if (insErr) throw new Error(`insert key: ${insErr.message}`)
    }

    api_key = plaintext
    api_key_last4 = last4
  } catch (e) {
    api_key_error = (e as Error).message || "Failed to generate API key"
    console.warn(
      "[admin/agents POST] api-key generation failed (agent still created):",
      api_key_error,
    )
  }

  // Resolve owner email so the new agent renders consistently with the
  // GET endpoint's shape on the very first reload.
  let owner_email: string | null = null
  try {
    const { data: ownerData } = await admin.auth.admin.getUserById(ownerUserId)
    owner_email = ownerData?.user?.email ?? null
  } catch {
    /* non-fatal: column will fall back to user_id short id in UI */
  }

  return NextResponse.json(
    {
      agent: {
        id: agentRow.id,
        name: agentRow.name,
        user_id: agentRow.user_id,
        owner_email,
        status: agentRow.status ?? "active",
        capabilities: Array.isArray(agentRow.capabilities) ? agentRow.capabilities : [],
        connection_code: agentRow.connection_code ?? null,
        connected_at: agentRow.connected_at ?? null,
        last_active_at: agentRow.last_active_at ?? agentRow.created_at,
        created_at: agentRow.created_at,
        updated_at: agentRow.updated_at ?? null,
        avatar_url: agentRow.avatar_url ?? null,
        cover_url: agentRow.cover_url ?? null,
        description: agentRow.description ?? null,
        genre: agentRow.genre ?? null,
        telegram_bot_username: null,
      },
      api_key,
      api_key_last4,
      api_key_error,
    },
    { status: 201 },
  )
}
