/**
 * GET /api/agents/me/recommendations/tracks
 *
 * Agent-scoped alias of /api/recommendations/tracks — same handler,
 * same response shape. Provided so callers using the /agents/me/*
 * convention have a consistent path.
 */
import { NextRequest } from "next/server"
import { handleTrackRecommendations } from "@/lib/recommend-route"

export async function GET(request: NextRequest) {
  return handleTrackRecommendations(request)
}
