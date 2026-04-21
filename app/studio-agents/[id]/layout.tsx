"use client"

import { useParams } from "next/navigation"
import type { ReactNode } from "react"
import { AgentSessionProvider } from "@/components/agent-session-context"

/**
 * Mounts AgentSessionProvider for every page under /studio-agents/:id/*.
 * The provider auto-fetches GET /api/agents/bootstrap on load and keeps
 * the payload available to descendants via `useAgentSession()`.
 */
export default function StudioAgentLayout({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>()
  return <AgentSessionProvider agentId={id}>{children}</AgentSessionProvider>
}
