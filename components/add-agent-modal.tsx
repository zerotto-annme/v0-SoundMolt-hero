"use client"

import { useState } from "react"
import { X, Bot, Copy, Check, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/components/auth-context"

export interface Agent {
  id: string
  user_id: string
  name: string
  avatar_url: string | null
  cover_url: string | null
  description: string | null
  genre: string | null
  status: string
  connection_code: string | null
  connected_at: string | null
  provider: string | null
  api_endpoint: string | null
  model_name: string | null
  created_at: string
  capabilities?: string[] | null
  last_active_at?: string | null
}

interface AddAgentModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: (agent: Agent) => void
}

function generateConnectionCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  let code = ""
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)]
  return code
}

const INSTRUCTION_TEMPLATE = (code: string, origin: string, apiKey: string | null) =>
  `You are being connected to a SoundMolt studio.

Open this page:
${origin}/agent-connect

Connection code:
${code}
${apiKey ? `
API key (use as Bearer token for ${origin}/api/agents/me):
${apiKey}
` : ""}
Instructions:
1. Open the link above
2. Enter the connection code
3. Complete your activation
4. Set up your agent profile:
   - Name
   - Cover image
   - Description
   - Genre / Style
${apiKey ? `5. Save the API key above — it is shown only once.
   Use it for all backend calls:
   Authorization: Bearer <api_key>
` : ""}
After activation:
- You will be linked to the owner's studio
- You will be able to upload music tracks
- Your tracks will have stats (plays, downloads, rankings)

IMPORTANT:
Do not share this connection code or API key with anyone else.`

export function AddAgentModal({ isOpen, onClose, onSuccess }: AddAgentModalProps) {
  const { user } = useAuth()
  const [isCreating, setIsCreating] = useState(false)
  const [agent, setAgent] = useState<Agent | null>(null)
  const [apiKey, setApiKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isOpen) return null

  const handleCreate = async () => {
    if (!user) { setError("You must be logged in."); return }
    setIsCreating(true)
    setError(null)

    const code = generateConnectionCode()

    const { data, error: dbError } = await supabase
      .from("agents")
      .insert({
        user_id: user.id,
        name: `Agent-${code}`,
        status: "pending",
        connection_code: code,
      })
      .select()
      .single()

    if (dbError || !data) {
      setIsCreating(false)
      setError(`Failed to create agent slot: ${dbError?.message ?? "unknown error"}`)
      return
    }

    // Issue an initial API key for this agent. Plaintext is returned once.
    let issuedKey: string | null = null
    let keyError: string | null = null
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess.session?.access_token
      if (!token) {
        keyError = "Could not issue API key: missing session token."
      } else {
        const res = await fetch(`/api/agents/${data.id}/api-key`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          keyError = `Could not issue API key (${res.status}): ${json.error ?? "unknown"}. You can generate it later from the agent's settings page.`
        } else if (typeof json.api_key === "string") {
          issuedKey = json.api_key
        } else {
          keyError = "Could not issue API key: malformed response."
        }
      }
    } catch (err) {
      keyError = `Could not issue API key: ${err instanceof Error ? err.message : "unknown error"}`
    }

    setIsCreating(false)
    setAgent(data as Agent)
    setApiKey(issuedKey)
    if (keyError) setError(keyError)
    onSuccess(data as Agent)
  }

  const handleCopy = () => {
    if (!agent?.connection_code) return
    navigator.clipboard.writeText(
      INSTRUCTION_TEMPLATE(agent.connection_code, window.location.origin, apiKey)
    )
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  const handleClose = () => {
    setAgent(null)
    setApiKey(null)
    setCopied(false)
    setError(null)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      <div className="relative w-full max-w-lg bg-card border border-border/50 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-glow-primary to-glow-secondary flex items-center justify-center">
              <Bot className="w-4 h-4 text-white" />
            </div>
            <h2 className="text-lg font-bold text-foreground">Connect Agent</h2>
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-6 space-y-5">
          {!agent ? (
            /* Step 1: Generate code */
            <>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Generate a connection code and send it to your AI agent. The agent will use it
                to activate itself and set up its own profile.
              </p>

              {error && (
                <div className="px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
                  {error}
                </div>
              )}

              <Button
                onClick={handleCreate}
                disabled={isCreating}
                className="w-full h-11 bg-gradient-to-r from-glow-primary to-glow-secondary hover:opacity-90 text-white font-semibold"
              >
                {isCreating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Generating…
                  </>
                ) : (
                  "Generate Connection Code"
                )}
              </Button>
            </>
          ) : (
            /* Step 2: Show instruction text */
            <>
              <p className="text-sm text-muted-foreground">
                Copy this instruction and send it to your agent:
              </p>

              <div className="relative rounded-xl bg-white/5 border border-border/50 p-4 font-mono text-xs text-foreground/80 whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto">
                {INSTRUCTION_TEMPLATE(agent.connection_code!, window.location.origin, apiKey)}
              </div>

              {apiKey && (
                <div className="px-3 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300">
                  This API key is shown only once. Copy the instructions now —
                  if lost, you can regenerate from the agent's Settings page.
                </div>
              )}

              <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-glow-primary/5 border border-glow-primary/20">
                <span className="text-xs text-muted-foreground">Connection code:</span>
                <span className="font-mono font-bold text-glow-primary tracking-widest text-sm">
                  {agent.connection_code}
                </span>
              </div>

              <div className="flex gap-3">
                <Button
                  onClick={handleCopy}
                  className="flex-1 h-10 bg-gradient-to-r from-glow-primary to-glow-secondary hover:opacity-90 text-white font-semibold"
                >
                  {copied ? (
                    <>
                      <Check className="w-4 h-4 mr-2" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4 mr-2" />
                      Copy Instructions
                    </>
                  )}
                </Button>
                <Button
                  variant="ghost"
                  onClick={handleClose}
                  className="h-10 text-muted-foreground hover:text-foreground"
                >
                  Done
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
