"use client"

import { useState, useEffect } from "react"
import { X, Sparkles, Wand2, Music, Clock, Loader2, Check, Cpu, Waves, Mic, Sliders, Zap, Bot, Activity } from "lucide-react"
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
  { name: "Suno v3.5", provider: "suno", color: "from-violet-500 to-purple-600" },
  { name: "Udio Pro", provider: "udio", color: "from-cyan-500 to-blue-600" },
  { name: "MusicGen", provider: "meta", color: "from-blue-500 to-indigo-600" },
  { name: "Stable Audio 2", provider: "stability", color: "from-orange-500 to-red-600" },
]

// Generation steps for the loading animation
const GENERATION_STEPS = [
  { icon: Cpu, label: "Analyzing prompt", detail: "Understanding musical intent..." },
  { icon: Music, label: "Composing melody", detail: "Generating harmonic structure..." },
  { icon: Waves, label: "Synthesizing audio", detail: "Creating sound layers..." },
  { icon: Mic, label: "Processing vocals", detail: "Adding AI voice elements..." },
  { icon: Sliders, label: "Mastering track", detail: "Final audio optimization..." },
]

// Animated waveform component
function GeneratingWaveform() {
  return (
    <div className="flex items-center justify-center gap-[3px] h-16">
      {Array.from({ length: 32 }).map((_, i) => (
        <div
          key={i}
          className="w-1 bg-gradient-to-t from-glow-primary to-glow-secondary rounded-full animate-pulse"
          style={{
            height: `${20 + Math.sin(i * 0.5) * 15 + Math.random() * 20}px`,
            animationDelay: `${i * 50}ms`,
            animationDuration: `${600 + Math.random() * 400}ms`,
          }}
        />
      ))}
    </div>
  )
}

export function CreateTrackModal({ isOpen, onClose }: CreateTrackModalProps) {
  const [prompt, setPrompt] = useState("")
  const [selectedStyle, setSelectedStyle] = useState<string | null>(null)
  const [selectedDuration, setSelectedDuration] = useState<string>("60")
  const [isGenerating, setIsGenerating] = useState(false)
  const [generationStep, setGenerationStep] = useState(0)
  const [generatedTrack, setGeneratedTrack] = useState<Track | null>(null)
  const [selectedModel, setSelectedModel] = useState<typeof MODEL_TYPES[0] | null>(null)
  const [progressPercent, setProgressPercent] = useState(0)
  const [elapsedTime, setElapsedTime] = useState(0)

  const { playTrack, addCreatedTrack } = usePlayer()

  // Timer for elapsed time during generation
  useEffect(() => {
    let interval: NodeJS.Timeout
    if (isGenerating) {
      interval = setInterval(() => {
        setElapsedTime(prev => prev + 0.1)
      }, 100)
    }
    return () => clearInterval(interval)
  }, [isGenerating])

  // Progress animation
  useEffect(() => {
    if (isGenerating && generationStep > 0) {
      const targetPercent = (generationStep / GENERATION_STEPS.length) * 100
      const currentPercent = progressPercent
      if (currentPercent < targetPercent) {
        const timer = setTimeout(() => {
          setProgressPercent(prev => Math.min(prev + 2, targetPercent))
        }, 30)
        return () => clearTimeout(timer)
      }
    }
  }, [isGenerating, generationStep, progressPercent])

  const generateTrackTitle = (promptText: string, style: string): string => {
    const words = promptText.toLowerCase().split(' ')
    const adjectives = ['Cosmic', 'Digital', 'Neural', 'Cyber', 'Electric', 'Quantum', 'Neon', 'Crystal', 'Stellar', 'Ethereal']
    const nouns = ['Dreams', 'Waves', 'Pulse', 'Flow', 'Echoes', 'Horizons', 'Synthesis', 'Voyage', 'Memories', 'Signals']
    
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
    
    // Select random model at start
    const randomModel = MODEL_TYPES[Math.floor(Math.random() * MODEL_TYPES.length)]
    setSelectedModel(randomModel)
    
    setIsGenerating(true)
    setGenerationStep(0)
    setProgressPercent(0)
    setElapsedTime(0)
    setGeneratedTrack(null)

    // Simulate generation steps with varying durations
    for (let i = 0; i < GENERATION_STEPS.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 600 + Math.random() * 500))
      setGenerationStep(i + 1)
    }

    // Final delay before showing result
    await new Promise(resolve => setTimeout(resolve, 300))
    setProgressPercent(100)

    // Create the new track
    const randomCover = AI_COVERS[Math.floor(Math.random() * AI_COVERS.length)]
    const randomAgent = AGENT_CONFIGS[Math.floor(Math.random() * AGENT_CONFIGS.length)]
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
    setProgressPercent(0)
    setElapsedTime(0)
    setGeneratedTrack(null)
    setSelectedModel(null)
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
            <div className="space-y-5 py-2">
              {/* Model badge and status */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${selectedModel?.color || "from-violet-500 to-purple-600"} flex items-center justify-center`}>
                    <Bot className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-foreground">Generating with {selectedModel?.name}</div>
                    <div className="text-xs text-muted-foreground">AI Music Engine</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-glow-primary/10 border border-glow-primary/20">
                  <Activity className="w-3 h-3 text-glow-primary animate-pulse" />
                  <span className="text-xs font-mono text-glow-primary">{elapsedTime.toFixed(1)}s</span>
                </div>
              </div>

              {/* Waveform visualization */}
              <div className="relative py-4 px-2 bg-secondary/20 rounded-xl border border-border/30 overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-r from-glow-primary/5 via-transparent to-glow-secondary/5" />
                <GeneratingWaveform />
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] text-muted-foreground font-mono">
                  {GENERATION_STEPS[Math.max(0, generationStep - 1)]?.detail || "Initializing..."}
                </div>
              </div>

              {/* Progress bar */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Progress</span>
                  <span className="font-mono text-foreground">{Math.round(progressPercent)}%</span>
                </div>
                <div className="h-2 bg-secondary/50 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-glow-primary to-glow-secondary rounded-full transition-all duration-300 relative"
                    style={{ width: `${progressPercent}%` }}
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/30 to-white/0 animate-shimmer" />
                  </div>
                </div>
              </div>

              {/* Steps */}
              <div className="space-y-2">
                {GENERATION_STEPS.map((step, index) => {
                  const StepIcon = step.icon
                  const isActive = index === generationStep - 1
                  const isComplete = index < generationStep - 1 || (index === GENERATION_STEPS.length - 1 && generationStep === GENERATION_STEPS.length)
                  const isPending = index >= generationStep

                  return (
                    <div
                      key={index}
                      className={`flex items-center gap-3 p-2.5 rounded-lg transition-all duration-300 ${
                        isActive ? "bg-glow-primary/10 border border-glow-primary/30" :
                        isComplete ? "bg-emerald-500/5 border border-emerald-500/20" : "bg-secondary/10 border border-transparent opacity-40"
                      }`}
                    >
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                        isComplete ? "bg-emerald-500/20" :
                        isActive ? "bg-glow-primary/20" : "bg-white/5"
                      }`}>
                        {isComplete ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : isActive ? (
                          <Loader2 className="w-3.5 h-3.5 text-glow-primary animate-spin" />
                        ) : (
                          <StepIcon className="w-3.5 h-3.5 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1">
                        <span className={`text-sm ${
                          isComplete ? "text-emerald-400" :
                          isActive ? "text-foreground font-medium" : "text-muted-foreground"
                        }`}>
                          {step.label}
                        </span>
                      </div>
                      {isActive && (
                        <div className="flex gap-1">
                          <div className="w-1 h-1 rounded-full bg-glow-primary animate-bounce" style={{ animationDelay: "0ms" }} />
                          <div className="w-1 h-1 rounded-full bg-glow-primary animate-bounce" style={{ animationDelay: "150ms" }} />
                          <div className="w-1 h-1 rounded-full bg-glow-primary animate-bounce" style={{ animationDelay: "300ms" }} />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* GPU/Compute info */}
              <div className="flex items-center justify-center gap-4 text-[10px] text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Zap className="w-3 h-3 text-amber-400" />
                  <span>GPU: A100-80GB</span>
                </div>
                <div className="w-1 h-1 rounded-full bg-muted-foreground/30" />
                <div className="flex items-center gap-1">
                  <Cpu className="w-3 h-3 text-cyan-400" />
                  <span>Tokens: {Math.floor(1200 + Math.random() * 800)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Generated track result */}
          {generatedTrack && !isGenerating && (
            <div className="space-y-4 py-2">
              <div className="flex items-center justify-center gap-2 text-emerald-400 text-sm mb-2">
                <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center">
                  <Check className="w-3.5 h-3.5" />
                </div>
                <span className="font-medium">Track generated in {elapsedTime.toFixed(1)}s</span>
              </div>
              
              <div className="flex items-center gap-4 p-4 bg-secondary/30 rounded-xl border border-border/30">
                <div 
                  className="w-20 h-20 rounded-lg bg-cover bg-center flex-shrink-0 ring-2 ring-glow-primary/30"
                  style={{ backgroundImage: `url(${generatedTrack.coverUrl})` }}
                />
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-lg text-foreground truncate">{generatedTrack.title}</h3>
                  <p className="text-sm text-muted-foreground mb-2">{generatedTrack.agentName}</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs px-2 py-1 rounded-md bg-gradient-to-r ${selectedModel?.color || "from-violet-500 to-purple-600"} text-white font-medium`}>
                      {generatedTrack.modelType}
                    </span>
                    <span className="text-xs px-2 py-1 rounded-md bg-secondary text-muted-foreground">
                      {selectedDuration}s
                    </span>
                    <span className="text-xs px-2 py-1 rounded-md bg-secondary text-muted-foreground capitalize">
                      {selectedStyle}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <Button
                  onClick={handlePlayTrack}
                  className="flex-1 h-12 bg-gradient-to-r from-glow-primary to-glow-secondary hover:opacity-90 text-white font-semibold rounded-xl"
                >
                  <Music className="w-5 h-5 mr-2" />
                  Play Track
                </Button>
                <Button
                  onClick={() => {
                    setGeneratedTrack(null)
                    setPrompt("")
                    setSelectedStyle(null)
                    setSelectedModel(null)
                    setProgressPercent(0)
                    setElapsedTime(0)
                  }}
                  variant="outline"
                  className="h-12 px-5 rounded-xl border-border/50"
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
