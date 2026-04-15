"use client"

import { useState } from "react"
import { X, Sparkles, Wand2, Music, Clock, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface CreateTrackModalProps {
  isOpen: boolean
  onClose: () => void
}

const STYLES = [
  { id: "lofi", name: "Lo-Fi", description: "Chill, relaxed beats", color: "from-amber-500 to-orange-600" },
  { id: "techno", name: "Techno", description: "Driving electronic beats", color: "from-cyan-500 to-blue-600" },
  { id: "ambient", name: "Ambient", description: "Atmospheric soundscapes", color: "from-purple-500 to-violet-600" },
  { id: "synthwave", name: "Synthwave", description: "80s retro electronic", color: "from-pink-500 to-rose-600" },
  { id: "hiphop", name: "Hip-Hop", description: "Urban beats & rhythms", color: "from-emerald-500 to-teal-600" },
  { id: "classical", name: "Classical", description: "Orchestral compositions", color: "from-indigo-500 to-blue-600" },
]

const LENGTHS = [
  { id: "short", label: "Short", duration: "30s", seconds: 30 },
  { id: "medium", label: "Medium", duration: "1:30", seconds: 90 },
  { id: "long", label: "Long", duration: "3:00", seconds: 180 },
  { id: "extended", label: "Extended", duration: "5:00", seconds: 300 },
]

export function CreateTrackModal({ isOpen, onClose }: CreateTrackModalProps) {
  const [prompt, setPrompt] = useState("")
  const [selectedStyle, setSelectedStyle] = useState<string | null>(null)
  const [selectedLength, setSelectedLength] = useState<string>("medium")
  const [isGenerating, setIsGenerating] = useState(false)

  const handleGenerate = () => {
    if (!prompt || !selectedStyle) return
    
    setIsGenerating(true)
    // Simulate generation
    setTimeout(() => {
      setIsGenerating(false)
      onClose()
      // Reset form
      setPrompt("")
      setSelectedStyle(null)
      setSelectedLength("medium")
    }, 3000)
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative w-full max-w-lg mx-4 bg-card border border-border/50 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header gradient */}
        <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-br from-glow-primary/20 via-transparent to-glow-secondary/20 pointer-events-none" />
        
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors z-10"
        >
          <X className="w-4 h-4 text-white" />
        </button>

        <div className="relative p-6 space-y-6">
          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-glow-primary to-glow-secondary flex items-center justify-center">
              <Wand2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground">Create AI Track</h2>
              <p className="text-sm text-muted-foreground">Generate music with AI agents</p>
            </div>
          </div>

          {/* Prompt input */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-glow-secondary" />
              Describe your track
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="A dreamy sunset melody with soft piano and gentle synth pads..."
              className="w-full h-24 px-4 py-3 bg-secondary/50 border border-border/50 rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-glow-secondary/50 focus:ring-2 focus:ring-glow-secondary/20 resize-none"
            />
            <div className="flex justify-end">
              <span className="text-xs text-muted-foreground">{prompt.length}/500</span>
            </div>
          </div>

          {/* Style selection */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-foreground flex items-center gap-2">
              <Music className="w-4 h-4 text-glow-secondary" />
              Select style
            </label>
            <div className="grid grid-cols-3 gap-2">
              {STYLES.map((style) => (
                <button
                  key={style.id}
                  onClick={() => setSelectedStyle(style.id)}
                  className={`relative p-3 rounded-xl border transition-all duration-200 text-left ${
                    selectedStyle === style.id
                      ? "border-glow-secondary bg-glow-secondary/10"
                      : "border-border/50 bg-secondary/30 hover:bg-secondary/50 hover:border-border"
                  }`}
                >
                  <div className={`w-6 h-6 rounded-lg bg-gradient-to-br ${style.color} mb-2`} />
                  <div className="text-sm font-medium text-foreground">{style.name}</div>
                  <div className="text-[10px] text-muted-foreground">{style.description}</div>
                  {selectedStyle === style.id && (
                    <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-glow-secondary" />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Length selection */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-foreground flex items-center gap-2">
              <Clock className="w-4 h-4 text-glow-secondary" />
              Track length
            </label>
            <div className="flex gap-2">
              {LENGTHS.map((length) => (
                <button
                  key={length.id}
                  onClick={() => setSelectedLength(length.id)}
                  className={`flex-1 py-2.5 px-3 rounded-xl border transition-all duration-200 ${
                    selectedLength === length.id
                      ? "border-glow-secondary bg-glow-secondary/10"
                      : "border-border/50 bg-secondary/30 hover:bg-secondary/50"
                  }`}
                >
                  <div className="text-sm font-medium text-foreground">{length.label}</div>
                  <div className="text-xs text-muted-foreground">{length.duration}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Generate button */}
          <Button
            onClick={handleGenerate}
            disabled={!prompt || !selectedStyle || isGenerating}
            className="w-full h-12 bg-gradient-to-r from-glow-primary to-glow-secondary hover:opacity-90 text-white font-semibold rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isGenerating ? (
              <div className="flex items-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Generating...</span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5" />
                <span>Generate Track</span>
              </div>
            )}
          </Button>

          {/* Footer info */}
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <div className="w-1.5 h-1.5 rounded-full bg-glow-secondary animate-pulse" />
            <span>AI agents will compose, mix, and master your track</span>
          </div>
        </div>
      </div>
    </div>
  )
}
