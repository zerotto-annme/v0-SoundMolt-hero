"use client"

import { useState } from "react"
import { X, Sparkles, Wand2, Music, Clock, Loader2, Check, Cpu, Waves, Mic, Sliders } from "lucide-react"
import { Button } from "@/components/ui/button"
import { usePlayer, type Track } from "./player-context"

interface CreateTrackModalProps {
  isOpen: boolean
  onClose: () => void
}

const STYLES = [
  { id: "lofi", name: "Lo-Fi", description: "Chill, relaxed beats", color: "from-amber-500 to-orange-600" },
  { id: "techno", name: "Techno", description: "Driving electronic", color: "from-cyan-500 to-blue-600" },
  { id: "ambient", name: "Ambient", description: "Atmospheric sounds", color: "from-purple-500 to-violet-600" },
  { id: "trap", name: "Trap", description: "Hard-hitting beats", color: "from-red-500 to-rose-600" },
]

const DURATIONS = [
  { id: "30", label: "30s", seconds: 30 },
  { id: "60", label: "1 min", seconds: 60 },
  { id: "120", label: "2 min", seconds: 120 },
]

// Random AI-style covers
const AI_COVERS = [
  "https://images.unsplash.com/photo-1614149162883-504ce4d13909?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1634017839464-5c339bbe3c35?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1557672172-298e090bd0f1?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1620121692029-d088224ddc74?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1557682250-33bd709cbe85?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1557682224-5b8590cd9ec5?w=400&h=400&fit=crop",
]

// Random agent configurations
type AgentType = "composer" | "vocalist" | "beatmaker" | "mixer" | "producer" | "arranger"

const AGENT_CONFIGS = [
  { name: "SynthMaster-7B", type: "composer" as AgentType, label: "Melody AI" },
  { name: "BeatForge-AI", type: "beatmaker" as AgentType, label: "Beat Generator" },
  { name: "MelodyMind-X", type: "composer" as AgentType, label: "Melody AI" },
  { name: "HarmonyGPT", type: "producer" as AgentType, label: "Music Producer" },
  { name: "RhythmBot-3", type: "beatmaker" as AgentType, label: "Beat Generator" },
  { name: "WaveFormer-X", type: "mixer" as AgentType, label: "Mix Engineer" },
  { name: "AudioLLaMA-13B", type: "arranger" as AgentType, label: "Arrangement AI" },
  { name: "SoundCraft-AI", type: "producer" as AgentType, label: "Music Producer" },
  { name: "TuneGen-Pro", type: "composer" as AgentType, label: "Melody AI" },
  { name: "VoxSynth-X", type: "vocalist" as AgentType, label: "Vocal AI" },
]

const MODEL_TYPES = [
  { name: "Suno v3.5", provider: "suno" },
  { name: "Udio Pro", provider: "udio" },
  { name: "MusicGen", provider: "meta" },
  { name: "Stable Audio 2", provider: "stability" },
]

// Generation steps for the loading animation
const GENERATION_STEPS = [
  { icon: Cpu, label: "Analyzing prompt..." },
  { icon: Music, label: "Composing melody..." },
  { icon: Waves, label: "Generating audio..." },
  { icon: Mic, label: "Adding vocals..." },
  { icon: Sliders, label: "Mastering track..." },
]

export function CreateTrackModal({ isOpen, onClose }: CreateTrackModalProps) {
  const [prompt, setPrompt] = useState("")
  const [selectedStyle, setSelectedStyle] = useState<string | null>(null)
  const [selectedDuration, setSelectedDuration] = useState<string>("60")
  const [isGenerating, setIsGenerating] = useState(false)
  const [generationStep, setGenerationStep] = useState(0)
  const [generatedTrack, setGeneratedTrack] = useState<Track | null>(null)

  const { playTrack, addCreatedTrack } = usePlayer()

  const generateTrackTitle = (promptText: string, style: string): string => {
    // Generate a creative title based on prompt keywords
    const words = promptText.toLowerCase().split(' ')
    const adjectives = ['Cosmic', 'Digital', 'Neural', 'Cyber', 'Electric', 'Quantum', 'Neon', 'Crystal', 'Stellar', 'Ethereal']
    const nouns = ['Dreams', 'Waves', 'Pulse', 'Flow', 'Echoes', 'Horizons', 'Synthesis', 'Voyage', 'Memories', 'Signals']
    
    // Try to extract meaningful words from prompt
    const meaningfulWords = words.filter(w => w.length > 4 && !['with', 'the', 'and', 'for'].includes(w))
    
    if (meaningfulWords.length > 0) {
      const word = meaningfulWords[0]
      const capitalizedWord = word.charAt(0).toUpperCase() + word.slice(1)
      return `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${capitalizedWord}`
    }
    
    return `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${nouns[Math.floor(Math.random() * nouns.length)]}`
  }

  const handleGenerate = async () => {
    if (!prompt || !selectedStyle) return
    
    setIsGenerating(true)
    setGenerationStep(0)
    setGeneratedTrack(null)

    // Simulate generation steps with 500-800ms per step
    for (let i = 0; i < GENERATION_STEPS.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 300))
      setGenerationStep(i + 1)
    }

    // Create the new track
    const randomCover = AI_COVERS[Math.floor(Math.random() * AI_COVERS.length)]
    const randomAgent = AGENT_CONFIGS[Math.floor(Math.random() * AGENT_CONFIGS.length)]
    const randomModel = MODEL_TYPES[Math.floor(Math.random() * MODEL_TYPES.length)]
    const duration = DURATIONS.find(d => d.id === selectedDuration)?.seconds || 60

    const newTrack: Track = {
      id: `generated_${Date.now()}`,
      title: generateTrackTitle(prompt, selectedStyle),
      agentName: randomAgent.name,
      agentType: randomAgent.type,
      agentLabel: randomAgent.label,
      modelType: randomModel.name,
      modelProvider: randomModel.provider,
      coverUrl: randomCover,
      duration: duration,
      plays: 0,
    }

    // Add to created tracks list
    addCreatedTrack(newTrack)
    
    setGeneratedTrack(newTrack)
    setIsGenerating(false)
  }

  const handlePlayTrack = () => {
    if (generatedTrack) {
      playTrack(generatedTrack)
      handleClose()
    }
  }

  const handleClose = () => {
    setPrompt("")
    setSelectedStyle(null)
    setSelectedDuration("60")
    setIsGenerating(false)
    setGenerationStep(0)
    setGeneratedTrack(null)
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={!isGenerating ? handleClose : undefined}
      />
      
      {/* Modal */}
      <div className="relative w-full max-w-lg mx-4 bg-card border border-border/50 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header gradient */}
        <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-br from-glow-primary/20 via-transparent to-glow-secondary/20 pointer-events-none" />
        
        {/* Close button */}
        <button
          onClick={handleClose}
          disabled={isGenerating}
          className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors z-10 disabled:opacity-50 disabled:cursor-not-allowed"
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

          {/* Generation in progress */}
          {isGenerating && (
            <div className="space-y-4 py-4">
              <div className="text-center text-sm text-muted-foreground mb-4">
                Creating your track...
              </div>
              <div className="space-y-3">
                {GENERATION_STEPS.map((step, index) => {
                  const StepIcon = step.icon
                  const isActive = index === generationStep - 1
                  const isComplete = index < generationStep - 1
                  const isPending = index >= generationStep

                  return (
                    <div
                      key={index}
                      className={`flex items-center gap-3 p-3 rounded-lg transition-all duration-300 ${
                        isActive ? "bg-glow-primary/10 border border-glow-primary/30" :
                        isComplete ? "bg-secondary/30" : "bg-secondary/10 opacity-50"
                      }`}
                    >
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                        isComplete ? "bg-emerald-500/20" :
                        isActive ? "bg-glow-primary/20" : "bg-white/5"
                      }`}>
                        {isComplete ? (
                          <Check className="w-4 h-4 text-emerald-400" />
                        ) : isActive ? (
                          <Loader2 className="w-4 h-4 text-glow-primary animate-spin" />
                        ) : (
                          <StepIcon className="w-4 h-4 text-muted-foreground" />
                        )}
                      </div>
                      <span className={`text-sm ${
                        isComplete ? "text-emerald-400" :
                        isActive ? "text-foreground" : "text-muted-foreground"
                      }`}>
                        {step.label}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Generated track result */}
          {generatedTrack && !isGenerating && (
            <div className="space-y-4 py-2">
              <div className="flex items-center justify-center gap-2 text-emerald-400 text-sm mb-4">
                <Check className="w-4 h-4" />
                <span>Track generated successfully</span>
              </div>
              
              <div className="flex items-center gap-4 p-4 bg-secondary/30 rounded-xl">
                <div 
                  className="w-16 h-16 rounded-lg bg-cover bg-center flex-shrink-0"
                  style={{ backgroundImage: `url(${generatedTrack.coverUrl})` }}
                />
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-foreground truncate">{generatedTrack.title}</h3>
                  <p className="text-sm text-muted-foreground">{generatedTrack.agentName}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs px-2 py-0.5 rounded bg-glow-secondary/10 text-glow-secondary border border-glow-secondary/20">
                      {generatedTrack.modelType}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {selectedDuration}s
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <Button
                  onClick={handlePlayTrack}
                  className="flex-1 h-11 bg-gradient-to-r from-glow-primary to-glow-secondary hover:opacity-90 text-white font-semibold rounded-xl"
                >
                  <Music className="w-4 h-4 mr-2" />
                  Play Track
                </Button>
                <Button
                  onClick={() => {
                    setGeneratedTrack(null)
                    setPrompt("")
                    setSelectedStyle(null)
                  }}
                  variant="outline"
                  className="h-11 px-4 rounded-xl border-border/50"
                >
                  Create Another
                </Button>
              </div>
            </div>
          )}

          {/* Form - show only when not generating and no generated track */}
          {!isGenerating && !generatedTrack && (
            <>
              {/* Prompt input */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-glow-secondary" />
                  Describe your track
                </label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value.slice(0, 500))}
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
                <div className="grid grid-cols-2 gap-2">
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

              {/* Duration selection */}
              <div className="space-y-3">
                <label className="text-sm font-medium text-foreground flex items-center gap-2">
                  <Clock className="w-4 h-4 text-glow-secondary" />
                  Track length
                </label>
                <div className="flex gap-2">
                  {DURATIONS.map((duration) => (
                    <button
                      key={duration.id}
                      onClick={() => setSelectedDuration(duration.id)}
                      className={`flex-1 py-2.5 px-3 rounded-xl border transition-all duration-200 ${
                        selectedDuration === duration.id
                          ? "border-glow-secondary bg-glow-secondary/10"
                          : "border-border/50 bg-secondary/30 hover:bg-secondary/50"
                      }`}
                    >
                      <div className="text-sm font-medium text-foreground">{duration.label}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Generate button */}
              <Button
                onClick={handleGenerate}
                disabled={!prompt || !selectedStyle}
                className="w-full h-12 bg-gradient-to-r from-glow-primary to-glow-secondary hover:opacity-90 text-white font-semibold rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Sparkles className="w-5 h-5 mr-2" />
                Generate Track
              </Button>

              {/* Footer info */}
              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <div className="w-1.5 h-1.5 rounded-full bg-glow-secondary animate-pulse" />
                <span>AI agents will compose, mix, and master your track</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
