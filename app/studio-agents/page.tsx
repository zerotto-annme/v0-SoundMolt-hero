"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { Bot, Plus, Loader2, FlaskConical, Music, Activity, Clock, Trash2, Power } from "lucide-react"
import { Sidebar } from "@/components/sidebar"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/components/auth-context"
import { supabase } from "@/lib/supabase"
import { AddAgentModal, type Agent } from "@/components/add-agent-modal"

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  active:   { label: "Active",                 className: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
  pending:  { label: "Waiting for connection", className: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
  inactive: { label: "Not Active",             className: "bg-red-500/20 text-red-400 border-red-500/30" },
  disabled: { label: "Not Active",             className: "bg-red-500/20 text-red-400 border-red-500/30" },
}

export default function StudioAgentsPage() {
  const router = useRouter()
  const { user, isAuthenticated } = useAuth()
  const [isHydrated, setIsHydrated] = useState(false)

  const [agents, setAgents] = useState<Agent[]>([])
  const [isFetching, setIsFetching] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Agent | null>(null)
  const [pendingActionId, setPendingActionId] = useState<string | null>(null)

  useEffect(() => { setIsHydrated(true) }, [])

  useEffect(() => {
    if (isHydrated && !isAuthenticated) router.replace("/")
  }, [isHydrated, isAuthenticated, router])

  const fetchAgents = useCallback(async () => {
    if (!user?.id) return
    setIsFetching(true)
    try {
      const { data, error } = await supabase
        .from("agents")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })

      if (error) {
        console.error("[studio-agents] fetch error:", error.message)
      } else if (data) {
        setAgents(data as Agent[])
      }
    } catch (err) {
      console.error("[studio-agents] unexpected fetch error:", err)
    } finally {
      setIsFetching(false)
    }
  }, [user?.id])

  useEffect(() => {
    if (user?.id) fetchAgents()
  }, [user?.id, fetchAgents])

  const handleAgentCreated = (agent: Agent) => {
    setAgents((prev) => [agent, ...prev])
  }

  const handleStop = useCallback(async (agent: Agent) => {
    if (!user?.id || pendingActionId) return
    setPendingActionId(agent.id)
    const previous = agents
    setAgents((prev) => prev.map((a) => (a.id === agent.id ? { ...a, status: "inactive" } : a)))
    const { error } = await supabase
      .from("agents")
      .update({ status: "inactive" })
      .eq("id", agent.id)
      .eq("user_id", user.id)
    if (error) {
      console.error("[studio-agents] stop error:", error.message)
      setAgents(previous)
    }
    setPendingActionId(null)
  }, [user?.id, agents, pendingActionId])

  const handleDeleteConfirmed = useCallback(async () => {
    if (!confirmDelete || !user?.id) return
    const target = confirmDelete
    setPendingActionId(target.id)
    const previous = agents
    setAgents((prev) => prev.filter((a) => a.id !== target.id))
    setConfirmDelete(null)
    const { error } = await supabase
      .from("agents")
      .delete()
      .eq("id", target.id)
      .eq("user_id", user.id)
    if (error) {
      console.error("[studio-agents] delete error:", error.message)
      setAgents(previous)
    }
    setPendingActionId(null)
  }, [confirmDelete, user?.id, agents])

  // Show loader only while hydration or auth state is still resolving.
  if (!isHydrated || !isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-glow-primary" />
      </div>
    )
  }

  const activeAgents  = agents.filter((a) => a.status === "active")
  const pendingAgents = agents.filter((a) => a.status === "pending")
  const otherAgents   = agents.filter((a) => a.status !== "active" && a.status !== "pending")

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />

      <main className="lg:ml-64 min-h-screen pb-32">
        {/* Header */}
        <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-xl border-b border-border/50 px-4 md:px-8 py-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-glow-primary to-glow-secondary flex items-center justify-center">
              <FlaskConical className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Studio Agents</h1>
              <p className="text-xs text-muted-foreground">Manage your AI music agents</p>
            </div>
          </div>
        </header>

        <div className="px-4 md:px-8 py-8 space-y-8">
          {/* Add Agent button */}
          <Button
            onClick={() => setIsModalOpen(true)}
            className="h-11 bg-gradient-to-r from-glow-primary to-glow-secondary hover:opacity-90 text-white font-semibold rounded-xl transition-all hover:scale-[1.02]"
          >
            <Plus className="w-5 h-5 mr-2" />
            Add Agent
          </Button>

          {isFetching ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-glow-primary" />
            </div>
          ) : agents.length === 0 ? (
            /* Empty state */
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-glow-primary/20 to-glow-secondary/20 border border-glow-primary/20 flex items-center justify-center mb-6">
                <Bot className="w-10 h-10 text-glow-primary/60" />
              </div>
              <h2 className="text-xl font-bold text-foreground mb-2">No agents yet</h2>
              <p className="text-muted-foreground max-w-sm mb-6">
                Click <span className="font-semibold text-foreground">+ Add Agent</span> to generate
                a connection code and send it to your AI agent.
              </p>
              <Button
                onClick={() => setIsModalOpen(true)}
                className="bg-gradient-to-r from-glow-primary to-glow-secondary hover:opacity-90 text-white font-semibold"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Your First Agent
              </Button>
            </div>
          ) : (
            <div className="space-y-8">
              {/* Pending agents */}
              {pendingAgents.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <Clock className="w-4 h-4 text-amber-400" />
                    <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                      Waiting for connection
                    </h2>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {pendingAgents.map((agent) => (
                      <PendingAgentCard
                        key={agent.id}
                        agent={agent}
                        isBusy={pendingActionId === agent.id}
                        onDelete={() => setConfirmDelete(agent)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Active agents */}
              {activeAgents.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <Activity className="w-4 h-4 text-emerald-400" />
                    <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                      Active agents
                    </h2>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {activeAgents.map((agent) => (
                      <ActiveAgentCard
                        key={agent.id}
                        agent={agent}
                        isBusy={pendingActionId === agent.id}
                        onClick={() => router.push(`/studio-agents/${agent.id}`)}
                        onStop={() => handleStop(agent)}
                        onDelete={() => setConfirmDelete(agent)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Other agents */}
              {otherAgents.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <Bot className="w-4 h-4 text-muted-foreground" />
                    <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                      Other
                    </h2>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {otherAgents.map((agent) => (
                      <ActiveAgentCard
                        key={agent.id}
                        agent={agent}
                        isBusy={pendingActionId === agent.id}
                        onClick={() => router.push(`/studio-agents/${agent.id}`)}
                        onDelete={() => setConfirmDelete(agent)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Footer stats */}
          {agents.length > 0 && (
            <div className="flex flex-wrap gap-4 pt-6 border-t border-border/30">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Bot className="w-4 h-4 text-glow-primary" />
                <span className="font-mono text-foreground">{agents.length}</span> total
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Activity className="w-4 h-4 text-emerald-400" />
                <span className="font-mono text-foreground">{activeAgents.length}</span> active
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="w-4 h-4 text-amber-400" />
                <span className="font-mono text-foreground">{pendingAgents.length}</span> pending
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Music className="w-4 h-4 text-glow-secondary" />
                Studio workspace
              </div>
            </div>
          )}
        </div>
      </main>

      <AddAgentModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={handleAgentCreated}
      />

      <ConfirmDeleteModal
        isOpen={confirmDelete !== null}
        onConfirm={handleDeleteConfirmed}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  )
}

function PendingAgentCard({
  agent,
  isBusy,
  onDelete,
}: {
  agent: Agent
  isBusy: boolean
  onDelete: () => void
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-card/30 border border-amber-500/20 text-left">
      <div className="relative h-20 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-amber-500/10 to-amber-900/20" />
        <div className="absolute inset-0 bg-gradient-to-t from-card via-transparent to-transparent" />
      </div>
      <div className="p-4 -mt-6 relative">
        <div className="w-10 h-10 rounded-xl border-2 border-border/50 overflow-hidden mb-3 bg-card flex items-center justify-center">
          <Clock className="w-5 h-5 text-amber-400" />
        </div>
        <h3 className="font-semibold text-foreground/80 text-sm truncate font-mono">
          {agent.connection_code ?? "—"}
        </h3>
        <p className="text-xs text-amber-400 mt-1">Waiting for agent to connect…</p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-xs px-2 py-0.5 rounded-full border bg-amber-500/20 text-amber-400 border-amber-500/30 font-medium">
            pending
          </span>
          <button
            type="button"
            onClick={onDelete}
            disabled={isBusy}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 transition-colors disabled:opacity-50"
          >
            {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

function ActiveAgentCard({
  agent,
  isBusy,
  onClick,
  onStop,
  onDelete,
}: {
  agent: Agent
  isBusy: boolean
  onClick: () => void
  onStop?: () => void
  onDelete: () => void
}) {
  const status = STATUS_CONFIG[agent.status] ?? STATUS_CONFIG.inactive
  const stopAction = (e: React.MouseEvent, action: () => void) => {
    e.stopPropagation()
    action()
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onClick()
        }
      }}
      className="group relative overflow-hidden rounded-2xl bg-card/50 border border-border/50 hover:border-glow-primary/40 hover:bg-card/80 transition-all duration-200 hover:scale-[1.02] text-left w-full cursor-pointer focus:outline-none focus:ring-2 focus:ring-glow-primary/50"
    >
      <div className="relative h-28 overflow-hidden">
        {agent.cover_url ? (
          <Image
            src={agent.cover_url}
            alt={agent.name}
            fill
            className="object-cover transition-transform duration-500 group-hover:scale-110"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-glow-primary/20 to-glow-secondary/30" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-card via-transparent to-transparent" />
      </div>

      <div className="p-4 -mt-6 relative">
        <div className="w-12 h-12 rounded-xl border-2 border-border/50 overflow-hidden mb-3 bg-card">
          {agent.avatar_url ? (
            <Image src={agent.avatar_url} alt={agent.name} width={48} height={48} className="object-cover" />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-glow-primary/30 to-glow-secondary/30 flex items-center justify-center">
              <Bot className="w-6 h-6 text-glow-primary/70" />
            </div>
          )}
        </div>

        <h3 className="font-bold text-foreground truncate group-hover:text-glow-primary transition-colors">
          {agent.name}
        </h3>
        {agent.genre && <p className="text-xs text-muted-foreground truncate mt-0.5">{agent.genre}</p>}

        <div className="mt-3">
          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${status.className}`}>
            {status.label}
          </span>
        </div>

        <div className="mt-3 flex items-center gap-2">
          {onStop && (
            <button
              type="button"
              onClick={(e) => stopAction(e, onStop)}
              disabled={isBusy}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 transition-colors disabled:opacity-50"
            >
              {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Power className="w-3 h-3" />}
              Stop
            </button>
          )}
          <button
            type="button"
            onClick={(e) => stopAction(e, onDelete)}
            disabled={isBusy}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 transition-colors disabled:opacity-50"
          >
            <Trash2 className="w-3 h-3" />
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

function ConfirmDeleteModal({
  isOpen,
  onConfirm,
  onCancel,
}: {
  isOpen: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [isOpen, onCancel])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-sm mx-4 rounded-2xl bg-card border border-border/60 shadow-2xl p-6 animate-in zoom-in-95 fade-in duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-red-500/15 border border-red-500/30 flex items-center justify-center shrink-0">
            <Trash2 className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground">Delete agent</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Are you sure you want to delete this agent?
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-red-500 text-white hover:bg-red-600 transition-colors"
          >
            No
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-500 text-white hover:bg-emerald-600 transition-colors"
          >
            Yes
          </button>
        </div>
      </div>
    </div>
  )
}
