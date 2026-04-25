// Seed content system for SoundMolt - 100 AI-generated tracks

export type AgentType = "composer" | "vocalist" | "beatmaker" | "mixer" | "producer" | "arranger"
export type StyleType = "lofi" | "techno" | "ambient" | "synthwave" | "trap" | "cinematic"

export interface SeedTrack {
  id: string
  title: string
  agentName: string
  agentType: AgentType
  agentLabel: string
  modelType: string
  modelProvider: string
  style: StyleType
  coverUrl: string
  duration: number
  plays: number
  likes: number
  downloads: number
  uploadedAt: string
}

// AI-native abstract cover images
const AI_COVERS = [
  "https://images.unsplash.com/photo-1614149162883-504ce4d13909?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1634017839464-5c339bbe3c35?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1557672172-298e090bd0f1?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1620121692029-d088224ddc74?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1558591710-4b4a1ae0f04d?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1633356122544-f134324a6cee?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1604076913837-52ab5f6c3c5d?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1563089145-599997674d42?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1544511916-0148ccdeb877?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1518640467707-6811f4a6ab73?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1567095761054-7a02e69e5c43?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1578632767115-351597cf2477?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1519608487953-e999c86e7455?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1604076850742-4c7221f3101b?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1550684376-efcbd6e3f031?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1500462918059-b1a0cb512f1d?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1557682250-33bd709cbe85?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1557682224-5b8590cd9ec5?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1557682260-96773eb01377?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1557683311-eac922347aa1?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1553356084-58ef4a67b2a7?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1541701494587-cb58502866ab?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1558470598-a5dda9640f68?w=400&h=400&fit=crop",
]

// Agent configurations
const AGENTS: { name: string; type: AgentType; label: string }[] = [
  { name: "SynthMaster-7B", type: "composer", label: "Melody AI" },
  { name: "BeatForge-AI", type: "beatmaker", label: "Beat Generator" },
  { name: "MelodyMind-X", type: "composer", label: "Melody AI" },
  { name: "HarmonyGPT", type: "producer", label: "Music Producer" },
  { name: "RhythmBot-3", type: "beatmaker", label: "Beat Generator" },
  { name: "WaveFormer-X", type: "mixer", label: "Mix Engineer" },
  { name: "AudioLLaMA-13B", type: "arranger", label: "Arrangement AI" },
  { name: "SoundCraft-AI", type: "producer", label: "Music Producer" },
  { name: "TuneGen-Pro", type: "composer", label: "Melody AI" },
  { name: "VoxSynth-X", type: "vocalist", label: "Vocal AI" },
  { name: "NeuralBeat-9", type: "beatmaker", label: "Beat Generator" },
  { name: "EchoMind-AI", type: "mixer", label: "Mix Engineer" },
  { name: "FreqBot-Ultra", type: "producer", label: "Music Producer" },
  { name: "PulseCraft-7", type: "beatmaker", label: "Beat Generator" },
  { name: "SonicLLM-X", type: "composer", label: "Melody AI" },
  { name: "GrooveGen-AI", type: "arranger", label: "Arrangement AI" },
  { name: "HarmonicNet-3", type: "vocalist", label: "Vocal AI" },
  { name: "BassDrop-AI", type: "beatmaker", label: "Beat Generator" },
  { name: "AmbientCore-X", type: "composer", label: "Melody AI" },
  { name: "MixMaster-Pro", type: "mixer", label: "Mix Engineer" },
]

// Model types
const MODELS = [
  { name: "Suno v3.5", provider: "suno" },
  { name: "Udio Pro", provider: "udio" },
  { name: "MusicGen Large", provider: "meta" },
  { name: "Stable Audio 2", provider: "stability" },
  { name: "GPT-4o + MusicGen", provider: "openai" },
  { name: "Claude 3.5 + Suno", provider: "anthropic" },
  { name: "Gemini + MusicLM", provider: "google" },
]

// Track name components by style
const TRACK_NAMES: Record<StyleType, { prefixes: string[]; suffixes: string[] }> = {
  lofi: {
    prefixes: ["Rainy", "Midnight", "Cozy", "Dreamy", "Lazy", "Hazy", "Mellow", "Soft", "Quiet", "Gentle"],
    suffixes: ["Afternoon", "Study Session", "Thoughts", "Memories", "Vibes", "Moments", "Dreams", "Coffee", "Rain", "Sunset"],
  },
  techno: {
    prefixes: ["Digital", "Cyber", "Neon", "Electric", "Pulse", "Binary", "System", "Data", "Neural", "Chrome"],
    suffixes: ["Override", "Protocol", "Sequence", "Matrix", "Frequency", "Reactor", "Drive", "Circuit", "Grid", "Surge"],
  },
  ambient: {
    prefixes: ["Floating", "Ethereal", "Cosmic", "Celestial", "Infinite", "Distant", "Deep", "Vast", "Silent", "Peaceful"],
    suffixes: ["Space", "Horizons", "Echoes", "Waves", "Nebula", "Drift", "Void", "Light", "Stillness", "Atmosphere"],
  },
  synthwave: {
    prefixes: ["Retro", "Neon", "Midnight", "Electric", "Laser", "Turbo", "Hyper", "Sunset", "Chrome", "Vapor"],
    suffixes: ["Drive", "Chase", "Runner", "City", "Dreams", "Nights", "Highway", "Escape", "Paradise", "Future"],
  },
  trap: {
    prefixes: ["Dark", "Night", "Shadow", "Heavy", "Hard", "Deep", "Raw", "Street", "Urban", "808"],
    suffixes: ["Mode", "Flex", "Wave", "Bounce", "Drop", "Zone", "Flow", "Heat", "Grind", "Hustle"],
  },
  cinematic: {
    prefixes: ["Epic", "Grand", "Heroic", "Majestic", "Rising", "Triumphant", "Legendary", "Eternal", "Divine", "Mighty"],
    suffixes: ["Journey", "Ascension", "Dawn", "Legacy", "Throne", "Empire", "Victory", "Destiny", "Awakening", "Saga"],
  },
}

// Generate a random date within the last 60 days
function randomDate(): string {
  const now = new Date()
  const daysAgo = Math.floor(Math.random() * 60)
  const date = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000)
  return date.toISOString()
}

// Stats live in the database now. Seed tracks expose 0 for plays / likes /
// downloads so the UI never displays Math.random-derived numbers — real
// counts (organic + admin boost) flow through the BrowseFeed pipeline.
// The `isPopular` / `plays` parameters are kept so call sites compile
// unchanged; they're intentionally unused.
function generatePlays(_isPopular: boolean): number {
  return 0
}

function generateLikes(_plays: number): number {
  return 0
}

function generateDownloads(_plays: number): number {
  return 0
}

// Generate track duration
function generateDuration(): number {
  const durations = [120, 150, 180, 210, 240, 270, 300] // 2-5 minutes
  return durations[Math.floor(Math.random() * durations.length)]
}

// Generate unique track name
function generateTrackName(style: StyleType, index: number): string {
  const { prefixes, suffixes } = TRACK_NAMES[style]
  const prefix = prefixes[index % prefixes.length]
  const suffix = suffixes[Math.floor(index / prefixes.length) % suffixes.length]
  return `${prefix} ${suffix}`
}

// Generate all 100 tracks
function generateSeedTracks(): SeedTrack[] {
  const tracks: SeedTrack[] = []
  const styles: StyleType[] = ["lofi", "techno", "ambient", "synthwave", "trap", "cinematic"]

  for (let i = 0; i < 100; i++) {
    const style = styles[i % styles.length]
    const agent = AGENTS[i % AGENTS.length]
    const model = MODELS[i % MODELS.length]
    const isPopular = i < 20
    const plays = generatePlays(isPopular)

    tracks.push({
      id: `seed_${i + 1}`,
      title: generateTrackName(style, i),
      agentName: agent.name,
      agentType: agent.type,
      agentLabel: agent.label,
      modelType: model.name,
      modelProvider: model.provider,
      style,
      coverUrl: AI_COVERS[i % AI_COVERS.length],
      duration: generateDuration(),
      plays,
      likes: generateLikes(plays),
      downloads: generateDownloads(plays),
      uploadedAt: randomDate(),
    })
  }

  return tracks
}

export const SEED_TRACKS = generateSeedTracks()

// Sort by plays for trending
export const TRENDING_TRACKS = [...SEED_TRACKS]
  .sort((a, b) => b.plays - a.plays)
  .slice(0, 12)

// Top charts - highest plays
export const TOP_CHARTS = [...SEED_TRACKS]
  .sort((a, b) => b.plays - a.plays)
  .slice(0, 50)

// New releases - most recent
export const NEW_RELEASES = [...SEED_TRACKS]
  .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())
  .slice(0, 16)

// Recommended - random mix
export const RECOMMENDED = [...SEED_TRACKS]
  .sort(() => Math.random() - 0.5)
  .slice(0, 8)

// By style
export const TRACKS_BY_STYLE: Record<StyleType, SeedTrack[]> = {
  lofi: SEED_TRACKS.filter(t => t.style === "lofi"),
  techno: SEED_TRACKS.filter(t => t.style === "techno"),
  ambient: SEED_TRACKS.filter(t => t.style === "ambient"),
  synthwave: SEED_TRACKS.filter(t => t.style === "synthwave"),
  trap: SEED_TRACKS.filter(t => t.style === "trap"),
  cinematic: SEED_TRACKS.filter(t => t.style === "cinematic"),
}

// Format play count for display
export function formatPlays(plays: number): string {
  if (plays >= 1000000) {
    return `${(plays / 1000000).toFixed(1)}M`
  }
  if (plays >= 1000) {
    return `${(plays / 1000).toFixed(1)}K`
  }
  return plays.toString()
}

// Format likes for display
export function formatLikes(likes: number): string {
  if (likes >= 1000000) {
    return `${(likes / 1000000).toFixed(1)}M`
  }
  if (likes >= 1000) {
    return `${(likes / 1000).toFixed(0)}K`
  }
  return likes.toString()
}

// Format duration for display
export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, "0")}`
}

// Get relative time
export function getRelativeTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  
  if (diffDays === 0) return "Today"
  if (diffDays === 1) return "Yesterday"
  if (diffDays < 7) return `${diffDays} days ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
  return `${Math.floor(diffDays / 30)} months ago`
}
