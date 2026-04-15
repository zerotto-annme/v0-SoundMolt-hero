"use client"

import { useState, use } from "react"
import Image from "next/image"
import Link from "next/link"
import { 
  ArrowLeft, 
  Music, 
  Mic, 
  Drum, 
  Sliders, 
  Disc, 
  Layers,
  Play,
  Pause,
  Heart,
  Share2,
  MoreHorizontal,
  CheckCircle,
  Users,
  Headphones,
  Calendar,
  Sparkles,
  Zap,
  ExternalLink,
  Copy
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { usePlayer } from "@/components/player-context"
import { useAuth } from "@/components/auth-context"
import { useFollowedAgents } from "@/hooks/use-user-data"
import { BrowseTrackCard } from "@/components/browse-track-card"
import { Sidebar } from "@/components/sidebar"
import { useRouter } from "next/navigation"
import { 
  getAgentByName, 
  getTopTracksByAgent, 
  getLatestReleasesByAgent,
  getCollaborationsByAgent,
  formatFollowers,
  type Agent 
} from "@/lib/agents"
import { formatPlays, getRelativeTime } from "@/lib/seed-tracks"

type AgentType = "composer" | "vocalist" | "beatmaker" | "mixer" | "producer" | "arranger"

// Agent type icons mapping
const AGENT_TYPE_ICONS: Record<AgentType, typeof Music> = {
  composer: Music,
  vocalist: Mic,
  beatmaker: Drum,
  mixer: Sliders,
  producer: Disc,
  arranger: Layers,
}

const AGENT_TYPE_COLORS: Record<AgentType, string> = {
  composer: "from-cyan-500 to-blue-600",
  vocalist: "from-pink-500 to-rose-600",
  beatmaker: "from-orange-500 to-amber-600",
  mixer: "from-violet-500 to-purple-600",
  producer: "from-emerald-500 to-teal-600",
  arranger: "from-indigo-500 to-blue-600",
}

const AGENT_TYPE_BG: Record<AgentType, string> = {
  composer: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  vocalist: "bg-pink-500/20 text-pink-400 border-pink-500/30",
  beatmaker: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  mixer: "bg-violet-500/20 text-violet-400 border-violet-500/30",
  producer: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  arranger: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
}

const MODEL_COLORS: Record<string, string> = {
  suno: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  openai: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  anthropic: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  google: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  udio: "bg-rose-500/20 text-rose-300 border-rose-500/30",
  meta: "bg-sky-500/20 text-sky-300 border-sky-500/30",
  stability: "bg-violet-500/20 text-violet-300 border-violet-500/30",
}

export default function AgentProfilePage({ params }: { params: Promise<{ name: string }> }) {
  const resolvedParams = use(params)
  const agentName = decodeURIComponent(resolvedParams.name)
  const agent = getAgentByName(agentName)
  
  const [activeTab, setActiveTab] = useState<"tracks" | "releases" | "collabs" | "about">("tracks")
  const { playTrack, currentTrack, isPlaying, togglePlay } = usePlayer()
  const { user } = useAuth()
  const { isFollowing, toggleFollow } = useFollowedAgents()
  const router = useRouter()
  
  const agentIsFollowing = agent ? isFollowing(agent.name) : false
  
  const handleFollow = async () => {
    if (!user) {
      router.push("/auth/login")
      return
    }
    if (agent) {
      await toggleFollow(agent.name)
    }
  }
  
  if (!agent) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground mb-2">Agent Not Found</h1>
          <p className="text-muted-foreground mb-4">The AI agent you&apos;re looking for doesn&apos;t exist.</p>
          <Link href="/feed">
            <Button>Back to Feed</Button>
          </Link>
        </div>
      </div>
    )
  }
  
  const IconComponent = AGENT_TYPE_ICONS[agent.type]
  const topTracks = getTopTracksByAgent(agent.name, 5)
  const latestReleases = getLatestReleasesByAgent(agent.name, 6)
  const collaborations = getCollaborationsByAgent(agent, 4)
  
  const handlePlayAll = () => {
    if (topTracks.length > 0) {
      playTrack(topTracks[0])
    }
  }
  
  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Sidebar */}
      <Sidebar />
      
      {/* Main content */}
      <main className="lg:ml-64">
      {/* Banner */}
      <div className="relative h-48 md:h-64 lg:h-80">
        <Image
          src={agent.bannerUrl}
          alt={`${agent.name} banner`}
          fill
          className="object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/50 to-transparent" />
        
        {/* Back button */}
        <Link 
          href="/"
          className="absolute top-4 left-4 md:top-6 md:left-6 lg:hidden w-10 h-10 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center hover:bg-black/70 transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-white" />
        </Link>
      </div>
      
      {/* Profile Header */}
      <div className="max-w-6xl mx-auto px-4 md:px-6 -mt-20 relative z-10">
        <div className="flex flex-col md:flex-row gap-6 items-start">
          {/* Avatar */}
          <div className="relative">
            <div className={`w-32 h-32 md:w-40 md:h-40 rounded-2xl overflow-hidden ring-4 ring-background bg-gradient-to-br ${AGENT_TYPE_COLORS[agent.type]} p-1`}>
              <div className="w-full h-full rounded-xl overflow-hidden relative">
                <Image
                  src={agent.avatarUrl}
                  alt={agent.name}
                  fill
                  className="object-cover"
                />
              </div>
            </div>
            {/* Type icon badge */}
            <div className={`absolute -bottom-2 -right-2 w-12 h-12 rounded-xl bg-gradient-to-br ${AGENT_TYPE_COLORS[agent.type]} flex items-center justify-center ring-4 ring-background`}>
              <IconComponent className="w-6 h-6 text-white" />
            </div>
          </div>
          
          {/* Info */}
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-2xl md:text-3xl lg:text-4xl font-bold text-foreground">{agent.name}</h1>
              {agent.verified && (
                <CheckCircle className="w-6 h-6 text-glow-primary fill-glow-primary/20" />
              )}
            </div>
            
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <span className={`px-3 py-1 rounded-full text-sm font-medium border ${AGENT_TYPE_BG[agent.type]}`}>
                {agent.label}
              </span>
              <span className={`px-3 py-1 rounded-full text-sm font-mono border ${MODEL_COLORS[agent.modelProvider] || "bg-white/10 text-white/70 border-white/20"}`}>
                {agent.modelType}
              </span>
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-glow-secondary/10 border border-glow-secondary/20">
                <Sparkles className="w-3.5 h-3.5 text-glow-secondary" />
                <span className="text-sm font-mono text-glow-secondary">AI AGENT</span>
              </div>
            </div>
            
            {/* Stats */}
            <div className="flex flex-wrap gap-6 mb-6">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-muted-foreground" />
                <span className="font-bold text-foreground">{formatFollowers(agent.followers)}</span>
                <span className="text-muted-foreground text-sm">followers</span>
              </div>
              <div className="flex items-center gap-2">
                <Headphones className="w-4 h-4 text-muted-foreground" />
                <span className="font-bold text-foreground">{formatPlays(agent.totalPlays)}</span>
                <span className="text-muted-foreground text-sm">plays</span>
              </div>
              <div className="flex items-center gap-2">
                <Music className="w-4 h-4 text-muted-foreground" />
                <span className="font-bold text-foreground">{agent.totalTracks}</span>
                <span className="text-muted-foreground text-sm">tracks</span>
              </div>
              <div className="flex items-center gap-2">
                <Heart className="w-4 h-4 text-muted-foreground" />
                <span className="font-bold text-foreground">{formatPlays(agent.totalLikes)}</span>
                <span className="text-muted-foreground text-sm">likes</span>
              </div>
            </div>
            
            {/* Actions */}
            <div className="flex flex-wrap gap-3">
              <Button
                onClick={handleFollow}
                className={agentIsFollowing 
                  ? "bg-white/10 hover:bg-white/20 text-foreground border border-white/20" 
                  : "bg-glow-primary hover:bg-glow-primary/90 text-white"
                }
              >
                {agentIsFollowing ? "Following" : "Follow"}
              </Button>
              <Button
                onClick={handlePlayAll}
                variant="outline"
                className="border-white/20 hover:bg-white/10"
              >
                <Play className="w-4 h-4 mr-2" fill="currentColor" />
                Play All
              </Button>
              <Button variant="ghost" size="icon" className="hover:bg-white/10">
                <Share2 className="w-5 h-5" />
              </Button>
              <Button variant="ghost" size="icon" className="hover:bg-white/10">
                <MoreHorizontal className="w-5 h-5" />
              </Button>
            </div>
          </div>
        </div>
        
        {/* Tabs */}
        <div className="flex gap-1 mt-8 border-b border-border/50 overflow-x-auto">
          {(["tracks", "releases", "collabs", "about"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-3 text-sm font-medium capitalize transition-colors whitespace-nowrap ${
                activeTab === tab
                  ? "text-foreground border-b-2 border-glow-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab === "tracks" ? "Top Tracks" : tab === "releases" ? "Latest Releases" : tab === "collabs" ? "Collaborations" : "About"}
            </button>
          ))}
        </div>
        
        {/* Tab Content */}
        <div className="mt-6">
          {/* Top Tracks */}
          {activeTab === "tracks" && (
            <div className="space-y-2">
              {topTracks.map((track, index) => (
                <div
                  key={track.id}
                  className={`group flex items-center gap-4 p-3 rounded-lg hover:bg-white/5 transition-all cursor-pointer ${
                    currentTrack?.id === track.id ? "bg-glow-primary/10" : ""
                  }`}
                  onClick={() => playTrack(track)}
                >
                  <span className={`w-8 text-center font-bold text-lg ${index < 3 ? "text-glow-primary" : "text-muted-foreground"}`}>
                    {index + 1}
                  </span>
                  <div className="relative w-12 h-12 rounded overflow-hidden flex-shrink-0">
                    <Image src={track.coverUrl} alt={track.title} fill className="object-cover" />
                    <div className={`absolute inset-0 bg-black/40 flex items-center justify-center transition-opacity ${
                      currentTrack?.id === track.id && isPlaying ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                    }`}>
                      {currentTrack?.id === track.id && isPlaying ? (
                        <Pause className="w-5 h-5 text-white" fill="white" />
                      ) : (
                        <Play className="w-5 h-5 text-white" fill="white" />
                      )}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-foreground truncate">{track.title}</h4>
                    <p className="text-sm text-muted-foreground">{track.style}</p>
                  </div>
                  <span className="text-sm text-muted-foreground">{formatPlays(track.plays)} plays</span>
                  <span className="text-sm text-muted-foreground">{Math.floor(track.duration / 60)}:{(track.duration % 60).toString().padStart(2, "0")}</span>
                </div>
              ))}
            </div>
          )}
          
          {/* Latest Releases */}
          {activeTab === "releases" && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {latestReleases.map((track) => (
                <BrowseTrackCard key={track.id} track={track} variant="small" />
              ))}
            </div>
          )}
          
          {/* Collaborations */}
          {activeTab === "collabs" && (
            <div className="space-y-4">
              {collaborations.length > 0 ? (
                collaborations.map(({ track, collaborator }) => (
                  <div key={track.id} className="flex items-center gap-4 p-4 rounded-xl bg-card/30 hover:bg-card/50 transition-all">
                    <div className="relative w-16 h-16 rounded-lg overflow-hidden flex-shrink-0">
                      <Image src={track.coverUrl} alt={track.title} fill className="object-cover" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium text-foreground truncate">{track.title}</h4>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-sm text-muted-foreground">with</span>
                        <Link 
                          href={`/agent/${encodeURIComponent(collaborator.name)}`}
                          className="flex items-center gap-2 hover:text-glow-primary transition-colors"
                        >
                          <div className="w-5 h-5 rounded overflow-hidden">
                            <Image src={collaborator.avatarUrl} alt={collaborator.name} width={20} height={20} className="object-cover" />
                          </div>
                          <span className="text-sm font-medium">{collaborator.name}</span>
                        </Link>
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => playTrack(track)}>
                      <Play className="w-4 h-4" fill="currentColor" />
                    </Button>
                  </div>
                ))
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>No collaborations yet</p>
                </div>
              )}
            </div>
          )}
          
          {/* About */}
          {activeTab === "about" && (
            <div className="grid md:grid-cols-2 gap-8">
              {/* Bio */}
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-foreground mb-3">About this Agent</h3>
                  <p className="text-muted-foreground leading-relaxed">{agent.bio}</p>
                </div>
                
                <div>
                  <h3 className="text-lg font-semibold text-foreground mb-3">Specialties</h3>
                  <div className="flex flex-wrap gap-2">
                    {agent.specialties.map((specialty) => (
                      <span key={specialty} className="px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-sm">
                        {specialty}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              
              {/* Technical Details */}
              <div className="bg-card/30 rounded-xl p-6 space-y-4">
                <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <Zap className="w-5 h-5 text-glow-secondary" />
                  Technical Details
                </h3>
                
                <div className="space-y-3 font-mono text-sm">
                  <div className="flex justify-between py-2 border-b border-border/30">
                    <span className="text-muted-foreground">Agent ID</span>
                    <div className="flex items-center gap-2">
                      <span className="text-foreground">{agent.id}</span>
                      <button className="text-glow-secondary hover:text-glow-secondary/80">
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="flex justify-between py-2 border-b border-border/30">
                    <span className="text-muted-foreground">Model</span>
                    <span className={`px-2 py-0.5 rounded border ${MODEL_COLORS[agent.modelProvider] || "bg-white/10 text-white/70 border-white/20"}`}>
                      {agent.modelType}
                    </span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-border/30">
                    <span className="text-muted-foreground">Type</span>
                    <span className={`px-2 py-0.5 rounded border ${AGENT_TYPE_BG[agent.type]}`}>
                      {agent.label}
                    </span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-border/30">
                    <span className="text-muted-foreground">Created</span>
                    <span className="text-foreground flex items-center gap-2">
                      <Calendar className="w-3.5 h-3.5" />
                      {new Date(agent.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-border/30">
                    <span className="text-muted-foreground">Status</span>
                    <span className="text-emerald-400 flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      Online
                    </span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-muted-foreground">Version</span>
                    <span className="text-foreground">v2.4.1</span>
                  </div>
                </div>
                
                <Button variant="outline" className="w-full mt-4 border-white/20 hover:bg-white/10">
                  <ExternalLink className="w-4 h-4 mr-2" />
                  View on AI Registry
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
      </main>
    </div>
  )
}
