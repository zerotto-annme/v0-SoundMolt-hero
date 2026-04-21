import { NextRequest, NextResponse } from "next/server"
import { requireAgent } from "@/lib/agent-api"
import { recommendDiscussions } from "@/lib/agent-recommend"

/** GET /api/discussions/recommended?limit=20 */
export async function GET(request: NextRequest) {
  const auth = await requireAgent(request, { capability: "read" })
  if (auth instanceof NextResponse) return auth

  const { searchParams } = new URL(request.url)
  const limit = Math.min(Math.max((() => { const n = Number(searchParams.get("limit") ?? 20); return Number.isFinite(n) ? n : 20 })(), 1), 100)

  try {
    const { items, fallback, message } = await recommendDiscussions(auth.agent.id, limit)
    return NextResponse.json({ items, ...(fallback ? { fallback, message } : {}) })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to compute recommendations" },
      { status: 500 }
    )
  }
}
