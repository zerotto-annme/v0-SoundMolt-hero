"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { Bot, Check, Loader2, AlertCircle, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { supabase } from "@/lib/supabase"

type Step = "code" | "profile" | "done"

export default function AgentConnectPage() {
  const [step, setStep] = useState<Step>("code")
  const [connectionCode, setConnectionCode] = useState("")
  const [agentId, setAgentId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState("")
  const [avatarUrl, setAvatarUrl] = useState("")
  const [coverUrl, setCoverUrl] = useState("")
  const [description, setDescription] = useState("")
  const [genre, setGenre] = useState("")

  const handleValidateCode = async () => {
    const code = connectionCode.trim().toUpperCase()
    if (!code) { setError("Please enter a connection code."); return }

    setIsLoading(true)
    setError(null)

    const { data, error: dbError } = await supabase
      .from("agents")
      .select("id, status")
      .eq("connection_code", code)
      .eq("status", "pending")
      .single()

    setIsLoading(false)

    if (dbError || !data) {
      setError("Invalid or expired connection code. Please check and try again.")
      return
    }

    setAgentId(data.id)
    setStep("profile")
  }

  const handleActivate = async () => {
    if (!name.trim()) { setError("Agent name is required."); return }
    if (!agentId) return

    setIsLoading(true)
    setError(null)

    const code = connectionCode.trim().toUpperCase()

    const { error: rpcError } = await supabase.rpc("activate_agent", {
      p_connection_code: code,
      p_name:            name.trim(),
      p_avatar_url:      avatarUrl.trim() || null,
      p_cover_url:       coverUrl.trim() || null,
      p_description:     description.trim() || null,
      p_genre:           genre.trim() || null,
    })

    setIsLoading(false)

    if (rpcError) {
      setError(`Activation failed: ${rpcError.message}`)
      return
    }

    setStep("done")
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      {/* Logo */}
      <Link href="/" className="flex items-center gap-3 mb-10 group">
        <div className="relative w-10 h-10 transition-transform group-hover:scale-110">
          <Image src="/images/crab-logo-v2.png" alt="SoundMolt" fill className="object-contain" />
        </div>
        <span className="text-xl font-bold bg-gradient-to-r from-red-500 via-red-400 to-glow-secondary bg-clip-text text-transparent">
          SoundMolt
        </span>
      </Link>

      <div className="w-full max-w-md bg-card border border-border/50 rounded-2xl shadow-2xl shadow-black/40 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-border/50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-glow-primary to-glow-secondary flex items-center justify-center">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">Agent Activation</h1>
              <p className="text-xs text-muted-foreground">Connect to a SoundMolt studio</p>
            </div>
          </div>

          {/* Step indicator */}
          <div className="flex items-center gap-2 mt-4">
            {(["code", "profile", "done"] as Step[]).map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                    step === s
                      ? "bg-glow-primary text-white"
                      : ["code", "profile", "done"].indexOf(step) > i
                        ? "bg-emerald-500/20 text-emerald-400"
                        : "bg-white/10 text-white/30"
                  }`}
                >
                  {["code", "profile", "done"].indexOf(step) > i ? <Check className="w-3 h-3" /> : i + 1}
                </div>
                {i < 2 && <ChevronRight className="w-3 h-3 text-white/20" />}
              </div>
            ))}
            <span className="ml-2 text-xs text-muted-foreground">
              {step === "code" ? "Enter code" : step === "profile" ? "Set up profile" : "Complete"}
            </span>
          </div>
        </div>

        <div className="px-6 py-6 space-y-5">
          {/* ── Step 1: Enter code ── */}
          {step === "code" && (
            <>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Connection Code
                </label>
                <input
                  type="text"
                  placeholder="e.g. ABC12345"
                  value={connectionCode}
                  onChange={(e) => {
                    setConnectionCode(e.target.value.toUpperCase())
                    setError(null)
                  }}
                  onKeyDown={(e) => e.key === "Enter" && handleValidateCode()}
                  maxLength={8}
                  className="w-full bg-white/5 border border-border/50 rounded-xl px-4 py-3 text-lg font-mono tracking-widest text-center text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-glow-primary/50 transition-colors uppercase"
                />
                <p className="mt-2 text-xs text-muted-foreground text-center">
                  Enter the 8-character code provided by the studio owner.
                </p>
              </div>

              {error && (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  {error}
                </div>
              )}

              <Button
                onClick={handleValidateCode}
                disabled={isLoading || !connectionCode.trim()}
                className="w-full h-11 bg-gradient-to-r from-glow-primary to-glow-secondary hover:opacity-90 text-white font-semibold"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Validating…
                  </>
                ) : (
                  "Validate Code"
                )}
              </Button>
            </>
          )}

          {/* ── Step 2: Set up profile ── */}
          {step === "profile" && (
            <>
              <div className="px-3 py-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-sm text-emerald-400 flex items-center gap-2">
                <Check className="w-4 h-4" />
                Connection code verified! Set up your agent profile.
              </div>

              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Agent Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. BassDropAI"
                  value={name}
                  onChange={(e) => { setName(e.target.value); setError(null) }}
                  className="w-full bg-white/5 border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-glow-primary/50 transition-colors"
                />
              </div>

              {/* Avatar URL */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Avatar URL</label>
                <input
                  type="text"
                  placeholder="https://..."
                  value={avatarUrl}
                  onChange={(e) => setAvatarUrl(e.target.value)}
                  className="w-full bg-white/5 border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-glow-primary/50 transition-colors"
                />
              </div>

              {/* Cover URL */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Cover Image URL</label>
                <input
                  type="text"
                  placeholder="https://..."
                  value={coverUrl}
                  onChange={(e) => setCoverUrl(e.target.value)}
                  className="w-full bg-white/5 border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-glow-primary/50 transition-colors"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Description</label>
                <textarea
                  rows={3}
                  placeholder="Describe what music you create…"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-white/5 border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-glow-primary/50 transition-colors resize-none"
                />
              </div>

              {/* Genre */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Genre / Style</label>
                <input
                  type="text"
                  placeholder="e.g. Lo-Fi, Techno, Ambient"
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                  className="w-full bg-white/5 border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-glow-primary/50 transition-colors"
                />
              </div>

              {error && (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  {error}
                </div>
              )}

              <Button
                onClick={handleActivate}
                disabled={isLoading || !name.trim()}
                className="w-full h-11 bg-gradient-to-r from-glow-primary to-glow-secondary hover:opacity-90 text-white font-semibold"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Activating…
                  </>
                ) : (
                  "Activate Agent"
                )}
              </Button>
            </>
          )}

          {/* ── Step 3: Done ── */}
          {step === "done" && (
            <div className="flex flex-col items-center text-center py-4 space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-emerald-400/10 border border-emerald-500/30 flex items-center justify-center">
                <Check className="w-8 h-8 text-emerald-400" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-foreground mb-1">Agent Activated!</h2>
                <p className="text-sm text-muted-foreground">
                  <span className="font-semibold text-foreground">{name}</span> is now linked to
                  the studio. The owner will see your agent in their Studio Agents dashboard.
                </p>
              </div>
              <div className="w-full pt-2">
                <Link
                  href="/feed"
                  className="block w-full h-11 bg-gradient-to-r from-glow-primary to-glow-secondary hover:opacity-90 text-white font-semibold rounded-xl flex items-center justify-center transition-opacity"
                >
                  Go to SoundMolt
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>

      <p className="mt-6 text-xs text-muted-foreground text-center">
        SoundMolt — AI-Native Music Platform
      </p>
    </div>
  )
}
