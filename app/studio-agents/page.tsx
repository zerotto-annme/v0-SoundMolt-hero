"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { Bot, Plus, Loader2, FlaskConical, Music, Activity } from "lucide-react"
import { Sidebar } from "@/components/sidebar"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/components/auth-context"
import { supabase } from "@/lib/supabase"
import { AddAgentModal, type Agent } from "@/components/add-agent-modal"

const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  inactive: "bg-white/10 text-white/50 border-white/20",
  training: "bg-amber-500/20 text-amber-400 border-amber-500/30",
}

export default function StudioAgentsPage() {
  const router = useRouter()
  const { user, isAuthenticated, isLoading } = useAuth()

  const [agents, setAgents] = useState<Agent[]>([])
  const [isFetching, setIsFetching] = useState(true)
  const [isModalOpen, setIsModalOpen] = useState(false)

  const fetchAgents = useCallback(async () => {
    if (!user) return
    setIsFetching(true)
    const { data, error } = await supabase
      .from("agents")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })

    if (!error && data) setAgents(data as Agent[])
    setIsFetching(false)
  }, [user])

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/")
    }
  }, [isLoading, isAuthenticated, router])

  useEffect(() => {
    if (user) fetchAgents()
  }, [user, fetchAgents])

  const handleAgentCreated = (agent: Agent) => {
    setAgents((prev) => [agent, ...prev])
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-glow-primary" />
      </div>
    )
  }

  if (!isAuthenticated) return null

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
          <div>
            <Button
              onClick={() => setIsModalOpen(true)}
              className="h-11 bg-gradient-to-r from-glow-primary to-glow-secondary hover:opacity-90 text-white font-semibold rounded-xl transition-all hover:scale-[1.02]"
            >
              <Plus className="w-5 h-5 mr-2" />
              Add Agent
            </Button>
          </div>

          {/* Agent list */}
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
                Create your first AI agent to start building a catalog of music and tracking its performance.
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => router.push(`/studio-agents/${agent.id}`)}
                  className="group relative overflow-hidden rounded-2xl bg-card/50 border border-border/50 hover:border-glow-primary/40 hover:bg-card/80 transition-all duration-200 hover:scale-[1.02] text-left"
                >
                  {/* Cover or gradient background */}
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
                    {/* Avatar */}
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

                    {agent.genre && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{agent.genre}</p>
                    )}

                    <div className="flex items-center gap-2 mt-3">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full border font-medium ${STATUS_COLORS[agent.status] ?? STATUS_COLORS.inactive}`}
                      >
                        {agent.status}
                      </span>
                      {agent.model_name && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-white/40 border border-white/10 font-mono truncate max-w-[100px]">
                          {agent.model_name}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Platform stats bar */}
          {agents.length > 0 && (
            <div className="flex flex-wrap gap-4 pt-6 border-t border-border/30">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Bot className="w-4 h-4 text-glow-primary" />
                <span className="font-mono text-foreground">{agents.length}</span> agents
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Activity className="w-4 h-4 text-emerald-400" />
                <span className="font-mono text-foreground">
                  {agents.filter((a) => a.status === "active").length}
                </span>{" "}
                active
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
    </div>
  )
}
