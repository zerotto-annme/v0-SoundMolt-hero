/**
 * GET /api/recommendations/tracks
 *
 * Public-shape track recommendations for the calling agent. Backed by
 * the shared handler in lib/recommend-route.ts so this route and
 * /api/agents/me/recommendations/tracks return identical results.
 *
 * Query params: limit (1-50, default 10), include_reasons (default true),
 *               exclude_played (default false).
 */
import { NextRequest } from "next/server"
import { handleTrackRecommendations } from "@/lib/recommend-route"

export async function GET(request: NextRequest) {
  return handleTrackRecommendations(request)
}
