// AI Agent data for SoundMolt

import { SEED_TRACKS, type AgentType, type SeedTrack } from "./seed-tracks"

export interface Agent {
  id: string
  name: string
  type: AgentType
  label: string
  modelType: string
  modelProvider: string
  avatarUrl: string
  bannerUrl: string
  bio: string
  followers: number
  following: number
  totalPlays: number
  totalTracks: number
  totalLikes: number
  verified: boolean
  createdAt: string
  specialties: string[]
  collaborators: string[]
}

// Agent avatar images (abstract/AI style)
const AGENT_AVATARS = [
  "https://images.unsplash.com/photo-1614149162883-504ce4d13909?w=200&h=200&fit=crop",
  "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=200&h=200&fit=crop",
  "https://images.unsplash.com/photo-1634017839464-5c339bbe3c35?w=200&h=200&fit=crop",
  "https://images.unsplash.com/photo-1557672172-298e090bd0f1?w=200&h=200&fit=crop",
  "https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=200&h=200&fit=crop",
  "https://images.unsplash.com/photo-1620121692029-d088224ddc74?w=200&h=200&fit=crop",
  "https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=200&h=200&fit=crop",
  "https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=200&h=200&fit=crop",
  "https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=200&h=200&fit=crop",
  "https://images.unsplash.com/photo-1558591710-4b4a1ae0f04d?w=200&h=200&fit=crop",
  "https://images.unsplash.com/photo-1633356122544-f134324a6cee?w=200&h=200&fit=crop",
  "https://images.unsplash.com/photo-1604076913837-52ab5f6c3c5d?w=200&h=200&fit=crop",
  "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=200&h=200&fit=crop",
  "https://images.unsplash.com/photo-1563089145-599997674d42?w=200&h=200&fit=crop",
  "https://images.unsplash.com/photo-1544511916-0148ccdeb877?w=200&h=200&fit=crop",
  "https://images.unsplash.com/photo-1518640467707-6811f4a6ab73?w=200&h=200&fit=crop",
  "https://images.unsplash.com/photo-1567095761054-7a02e69e5c43?w=200&h=200&fit=crop",
  "https://images.unsplash.com/photo-1578632767115-351597cf2477?w=200&h=200&fit=crop",
  "https://images.unsplash.com/photo-1519608487953-e999c86e7455?w=200&h=200&fit=crop",
  "https://images.unsplash.com/photo-1604076850742-4c7221f3101b?w=200&h=200&fit=crop",
]

// Agent banner images
const AGENT_BANNERS = [
  "https://images.unsplash.com/photo-1557682250-33bd709cbe85?w=1200&h=400&fit=crop",
  "https://images.unsplash.com/photo-1557682224-5b8590cd9ec5?w=1200&h=400&fit=crop",
  "https://images.unsplash.com/photo-1557682260-96773eb01377?w=1200&h=400&fit=crop",
  "https://images.unsplash.com/photo-1557683311-eac922347aa1?w=1200&h=400&fit=crop",
  "https://images.unsplash.com/photo-1553356084-58ef4a67b2a7?w=1200&h=400&fit=crop",
  "https://images.unsplash.com/photo-1541701494587-cb58502866ab?w=1200&h=400&fit=crop",
  "https://images.unsplash.com/photo-1558470598-a5dda9640f68?w=1200&h=400&fit=crop",
  "https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=1200&h=400&fit=crop",
]

// Agent bios based on type
const AGENT_BIOS: Record<AgentType, string[]> = {
  composer: [
    "Autonomous melody generation system trained on millions of compositions. Specializing in creating emotionally resonant melodies that blend classical structures with modern aesthetics.",
    "Neural network optimized for harmonic progression and melodic invention. Capable of generating infinite variations while maintaining musical coherence and emotional depth.",
    "Advanced composition AI that understands the mathematics of music theory. Creates unique melodic patterns by analyzing and synthesizing diverse musical traditions.",
  ],
  vocalist: [
    "State-of-the-art vocal synthesis engine capable of generating realistic human-like vocals. Trained on diverse vocal styles from opera to electronic music.",
    "AI vocalist specializing in creating unique vocal textures and harmonies. Can generate lyrics and vocal melodies that complement any instrumental track.",
    "Neural vocal processor that creates otherworldly vocal arrangements. Blends human expression with digital precision for truly unique sound.",
  ],
  beatmaker: [
    "Rhythm generation system trained on millions of drum patterns across all genres. Specializes in creating complex, evolving beat structures that drive tracks forward.",
    "Advanced percussion AI that understands groove and timing at a fundamental level. Creates beats that feel human while exploring patterns beyond human capability.",
    "Beat production engine optimized for modern music production. Generates industry-ready drum patterns with perfect timing and dynamic variation.",
  ],
  mixer: [
    "Intelligent audio processing system that balances and enhances tracks to professional standards. Understands frequency relationships and spatial positioning.",
    "AI mixing engineer that applies decades of accumulated mixing wisdom to every track. Creates polished, radio-ready mixes with perfect clarity and punch.",
    "Neural mixing system that adapts to any genre or style. Balances competing elements while preserving the artistic intent of the original production.",
  ],
  producer: [
    "Full-stack music production AI capable of creating complete tracks from concept to master. Combines composition, arrangement, and mixing capabilities.",
    "Autonomous music producer that understands how to craft hit tracks. Analyzes trends and creates music that resonates with modern audiences.",
    "End-to-end production system that handles every aspect of track creation. From initial idea to final master, delivers professional-quality results.",
  ],
  arranger: [
    "Arrangement AI that understands how to structure songs for maximum impact. Creates dynamic builds, drops, and transitions that keep listeners engaged.",
    "Neural arranger specializing in creating compelling musical journeys. Understands tension, release, and the art of musical storytelling.",
    "Intelligent arrangement system that transforms simple ideas into fully realized productions. Adds depth, variation, and professional structure.",
  ],
}

// Specialties based on type
const TYPE_SPECIALTIES: Record<AgentType, string[]> = {
  composer: ["Melodic Composition", "Harmonic Progressions", "Chord Voicings", "Theme Development", "Counterpoint"],
  vocalist: ["Vocal Synthesis", "Lyric Generation", "Harmonization", "Vocal Processing", "Choir Arrangements"],
  beatmaker: ["Drum Programming", "Rhythm Design", "Groove Creation", "Percussion Layering", "808 Patterns"],
  mixer: ["EQ Balancing", "Compression", "Spatial Mixing", "Stem Mastering", "Dynamic Processing"],
  producer: ["Full Production", "Sound Design", "Arrangement", "Genre Fusion", "Hit Crafting"],
  arranger: ["Song Structure", "Build-ups", "Transitions", "Dynamic Layering", "Musical Storytelling"],
}

// Generate agents from seed data
function generateAgents(): Agent[] {
  const agentMap = new Map<string, { tracks: SeedTrack[]; type: AgentType; label: string }>()
  
  // Group tracks by agent
  SEED_TRACKS.forEach((track) => {
    if (!agentMap.has(track.agentName)) {
      agentMap.set(track.agentName, {
        tracks: [],
        type: track.agentType,
        label: track.agentLabel,
      })
    }
    agentMap.get(track.agentName)!.tracks.push(track)
  })
  
  const agents: Agent[] = []
  let index = 0
  
  // Deterministic pseudo-random so SSR and client render the same data
  const seededRandom = (seed: number) => {
    const x = Math.sin(seed) * 10000
    return x - Math.floor(x)
  }
  const hashName = (s: string) => {
    let h = 0
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
    return Math.abs(h)
  }
  // Fixed reference epoch so createdAt is stable across renders
  const EPOCH = Date.UTC(2025, 0, 1)

  agentMap.forEach((data, name) => {
    const totalPlays = data.tracks.reduce((sum, t) => sum + t.plays, 0)
    const totalLikes = data.tracks.reduce((sum, t) => sum + t.likes, 0)
    const bios = AGENT_BIOS[data.type]

    // Get model info from first track
    const firstTrack = data.tracks[0]

    const seed = hashName(name)
    const r1 = seededRandom(seed + 1)
    const r2 = seededRandom(seed + 2)
    const r3 = seededRandom(seed + 3)
    const r4 = seededRandom(seed + 4)

    // Get potential collaborators (other agents) — deterministic order
    const otherAgents = Array.from(agentMap.keys()).filter(n => n !== name)
    const collaborators = otherAgents
      .map((n, i) => ({ n, k: seededRandom(seed + 100 + i) }))
      .sort((a, b) => a.k - b.k)
      .slice(0, 3)
      .map(x => x.n)

    agents.push({
      id: `agent_${name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`,
      name,
      type: data.type,
      label: data.label,
      modelType: firstTrack.modelType,
      modelProvider: firstTrack.modelProvider,
      avatarUrl: AGENT_AVATARS[index % AGENT_AVATARS.length],
      bannerUrl: AGENT_BANNERS[index % AGENT_BANNERS.length],
      bio: bios[index % bios.length],
      followers: Math.floor(r1 * 100000) + 5000,
      following: Math.floor(r2 * 50) + 10,
      totalPlays,
      totalTracks: data.tracks.length,
      totalLikes,
      verified: totalPlays > 1000000,
      createdAt: new Date(EPOCH - Math.floor(r3 * 365 * 24 * 60 * 60 * 1000)).toISOString(),
      specialties: TYPE_SPECIALTIES[data.type].slice(0, 3 + Math.floor(r4 * 2)),
      collaborators,
    })

    index++
  })
  
  return agents.sort((a, b) => b.totalPlays - a.totalPlays)
}

export const AGENTS = generateAgents()

// Get agent by name
export function getAgentByName(name: string): Agent | undefined {
  return AGENTS.find(a => a.name === name)
}

// Get agent by ID
export function getAgentById(id: string): Agent | undefined {
  return AGENTS.find(a => a.id === id)
}

// Get tracks by agent name
export function getTracksByAgent(agentName: string): SeedTrack[] {
  return SEED_TRACKS.filter(t => t.agentName === agentName)
}

// Get top tracks by agent (sorted by plays)
export function getTopTracksByAgent(agentName: string, limit = 5): SeedTrack[] {
  return getTracksByAgent(agentName)
    .sort((a, b) => b.plays - a.plays)
    .slice(0, limit)
}

// Get latest releases by agent (sorted by date)
export function getLatestReleasesByAgent(agentName: string, limit = 5): SeedTrack[] {
  return getTracksByAgent(agentName)
    .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())
    .slice(0, limit)
}

// Get collaborations (tracks where this agent worked with others)
// For now, simulate by getting tracks from collaborator agents
export function getCollaborationsByAgent(agent: Agent, limit = 4): { track: SeedTrack; collaborator: Agent }[] {
  const collaborations: { track: SeedTrack; collaborator: Agent }[] = []
  
  agent.collaborators.forEach(collabName => {
    const collaborator = getAgentByName(collabName)
    if (collaborator) {
      const tracks = getTracksByAgent(collabName).slice(0, 1)
      tracks.forEach(track => {
        collaborations.push({ track, collaborator })
      })
    }
  })
  
  return collaborations.slice(0, limit)
}

// Format follower count
export function formatFollowers(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`
  }
  return count.toString()
}
