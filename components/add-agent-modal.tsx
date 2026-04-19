"use client"

import { useState } from "react"
import { X, Bot, Loader2 } from "lucide-react"
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
  provider: string | null
  api_endpoint: string | null
  model_name: string | null
  created_at: string
}

interface AddAgentModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: (agent: Agent) => void
}

export function AddAgentModal({ isOpen, onClose, onSuccess }: AddAgentModalProps) {
  const { user } = useAuth()
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState({
    name: "",
    avatar_url: "",
    cover_url: "",
    description: "",
    genre: "",
    status: "active",
    provider: "",
    api_endpoint: "",
    model_name: "",
  })

  if (!isOpen) return null

  const handleChange = (field: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }))
    setError(null)
  }

  const handleSave = async () => {
    if (!form.name.trim()) {
      setError("Agent name is required.")
      return
    }
    if (!user) {
      setError("You must be logged in to create an agent.")
      return
    }

    setIsSaving(true)
    setError(null)

    const { data, error: dbError } = await supabase
      .from("agents")
      .insert({
        user_id: user.id,
        name: form.name.trim(),
        avatar_url: form.avatar_url.trim() || null,
        cover_url: form.cover_url.trim() || null,
        description: form.description.trim() || null,
        genre: form.genre.trim() || null,
        status: form.status,
        provider: form.provider.trim() || null,
        api_endpoint: form.api_endpoint.trim() || null,
        model_name: form.model_name.trim() || null,
      })
      .select()
      .single()

    setIsSaving(false)

    if (dbError) {
      setError(`Failed to create agent: ${dbError.message}`)
      return
    }

    onSuccess(data as Agent)
    setForm({
      name: "",
      avatar_url: "",
      cover_url: "",
      description: "",
      genre: "",
      status: "active",
      provider: "",
      api_endpoint: "",
      model_name: "",
    })
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
            <h2 className="text-lg font-bold text-foreground">Add Agent</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Agent Name */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Agent Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              placeholder="e.g. BassDropAI"
              value={form.name}
              onChange={(e) => handleChange("name", e.target.value)}
              className="w-full bg-white/5 border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-glow-primary/50 transition-colors"
            />
          </div>

          {/* Avatar URL */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Avatar URL</label>
            <input
              type="text"
              placeholder="https://..."
              value={form.avatar_url}
              onChange={(e) => handleChange("avatar_url", e.target.value)}
              className="w-full bg-white/5 border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-glow-primary/50 transition-colors"
            />
          </div>

          {/* Cover URL */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Cover URL</label>
            <input
              type="text"
              placeholder="https://..."
              value={form.cover_url}
              onChange={(e) => handleChange("cover_url", e.target.value)}
              className="w-full bg-white/5 border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-glow-primary/50 transition-colors"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Description</label>
            <textarea
              rows={3}
              placeholder="Describe what this agent creates…"
              value={form.description}
              onChange={(e) => handleChange("description", e.target.value)}
              className="w-full bg-white/5 border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-glow-primary/50 transition-colors resize-none"
            />
          </div>

          {/* Genre / Style */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Genre / Style</label>
            <input
              type="text"
              placeholder="e.g. Lo-Fi, Techno, Ambient"
              value={form.genre}
              onChange={(e) => handleChange("genre", e.target.value)}
              className="w-full bg-white/5 border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-glow-primary/50 transition-colors"
            />
          </div>

          {/* Status */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Status</label>
            <select
              value={form.status}
              onChange={(e) => handleChange("status", e.target.value)}
              className="w-full bg-white/5 border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-glow-primary/50 transition-colors"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="training">Training</option>
            </select>
          </div>

          {/* Provider */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Provider</label>
            <input
              type="text"
              placeholder="e.g. OpenAI, Anthropic, custom"
              value={form.provider}
              onChange={(e) => handleChange("provider", e.target.value)}
              className="w-full bg-white/5 border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-glow-primary/50 transition-colors"
            />
          </div>

          {/* API Endpoint */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">API Endpoint</label>
            <input
              type="text"
              placeholder="https://api.example.com/generate"
              value={form.api_endpoint}
              onChange={(e) => handleChange("api_endpoint", e.target.value)}
              className="w-full bg-white/5 border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-glow-primary/50 transition-colors"
            />
          </div>

          {/* Model Name */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Model Name</label>
            <input
              type="text"
              placeholder="e.g. gpt-4o, claude-3, musicgen-large"
              value={form.model_name}
              onChange={(e) => handleChange("model_name", e.target.value)}
              className="w-full bg-white/5 border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-glow-primary/50 transition-colors"
            />
          </div>

          {error && (
            <div className="px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border/50">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={isSaving}
            className="text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving}
            className="bg-gradient-to-r from-glow-primary to-glow-secondary hover:opacity-90 text-white font-semibold"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Creating…
              </>
            ) : (
              "Create Agent"
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
