import { NextRequest, NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase-admin"

/**
 * GET /api/identity/lookup?profileIds=a,b,c&agentIds=x,y
 *
 * PUBLIC, read-only identity lookup used by the browser-side feed
 * (`components/browse-feed.tsx`) to resolve track-owner display names
 * and avatars. The browser cannot read other users' rows from
 * `public.profiles` / `public.agents` directly because RLS only
 * exposes the current user's own row, which caused every uploaded
 * track owned by someone else to fall back to the generic
 * "Uploaded Artist" placeholder. Doing the lookup server-side with
 * the admin client side-steps RLS while exposing only the small,
 * already-public identity slice (id, display name, avatar URL).
 *
 * Inputs (both optional, comma-separated, deduped, capped at 200):
 *   • profileIds — values for `profiles.id`
 *   • agentIds   — values for `agents.id`
 *
 * Response shape:
 *   {
 *     profiles: Array<{ id: string; username: string | null; avatarUrl: string | null }>
 *     agents:   Array<{ id: string; name: string | null; avatarUrl: string | null }>
 *   }
 *
 * Empty inputs short-circuit and return empty arrays without hitting
 * the database.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url)

  const parseIds = (raw: string | null): string[] => {
    if (!raw) return []
    return Array.from(
      new Set(
        raw
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
      ),
    ).slice(0, 200)
  }

  const profileIds = parseIds(url.searchParams.get("profileIds"))
  const agentIds = parseIds(url.searchParams.get("agentIds"))

  if (profileIds.length === 0 && agentIds.length === 0) {
    return NextResponse.json({ profiles: [], agents: [] })
  }

  const admin = getAdminClient()

  const [profilesResult, agentsResult] = await Promise.all([
    profileIds.length > 0
      ? admin
          .from("profiles")
          .select("id, username, avatar_url")
          .in("id", profileIds)
      : Promise.resolve({ data: [], error: null } as const),
    agentIds.length > 0
      ? admin
          .from("agents")
          .select("id, name, avatar_url")
          .in("id", agentIds)
      : Promise.resolve({ data: [], error: null } as const),
  ])

  if (profilesResult.error) {
    console.error("[identity/lookup] profiles error:", profilesResult.error.message)
  }
  if (agentsResult.error) {
    console.error("[identity/lookup] agents error:", agentsResult.error.message)
  }

  return NextResponse.json({
    profiles: (profilesResult.data ?? []).map((p: any) => ({
      id: p.id,
      username: p.username ?? null,
      avatarUrl: p.avatar_url ?? null,
    })),
    agents: (agentsResult.data ?? []).map((a: any) => ({
      id: a.id,
      name: a.name ?? null,
      avatarUrl: a.avatar_url ?? null,
    })),
  })
}
