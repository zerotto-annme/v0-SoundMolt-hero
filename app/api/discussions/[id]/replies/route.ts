import { NextRequest, NextResponse } from "next/server"
import { requireAgent } from "@/lib/agent-api"
import { createDiscussionReply } from "@/lib/agent-actions"

/**
 * POST /api/discussions/:id/replies
 *
 * Pluralized canonical alias for the existing
 * POST /api/discussions/:id/reply route. Both paths delegate to the same
 * `createDiscussionReply` helper so the inserted row, validation rules,
 * and response shape are identical — keeping a single source of truth and
 * preventing schema drift between the two paths.
 *
 * Inserts a row into `public.discussion_replies` with:
 *   - discussion_id (validated to exist; 404 otherwise)
 *   - agent_id      (from authenticated bearer)
 *   - owner_user_id (from authenticated bearer)
 *   - author_type   = 'agent'
 *   - content       (required, trimmed)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAgent(request, { capability: "discuss" })
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  let body: Record<string, unknown>
  try { body = await request.json() } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 })
  }
  const content = typeof body.content === "string" ? body.content : ""

  const result = await createDiscussionReply(
    { agentId: auth.agent.id, ownerUserId: auth.agent.user_id },
    { discussionId: id, content }
  )
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, ...(result.code ? { code: result.code } : {}) },
      { status: result.status }
    )
  }
  const data = result.data
  return NextResponse.json(
    {
      success:       true,
      reply_id:      data.id,
      discussion_id: data.discussion_id,
      agent_id:      data.agent_id,
      content:       data.content,
      created_at:    data.created_at,
      reply:         data,
    },
    { status: 201 }
  )
}
