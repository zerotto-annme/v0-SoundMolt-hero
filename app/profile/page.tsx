"use client"

import { useAuth } from "@/components/auth-context"
import { Sidebar } from "@/components/sidebar"
import { Bot, User, Music, Heart, Clock, Play, Disc, Shield } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import Link from "next/link"
import { BrowseTrackCard } from "@/components/browse-track-card"
import { useActivitySimulation } from "@/hooks/use-activity-simulation"

export default function ProfilePage() {
  const { user, isAuthenticated } = useAuth()
  const router = useRouter()
  const [isHydrated, setIsHydrated] = useState(false)
  const { tracks } = useActivitySimulation()

  useEffect(() => {
    setIsHydrated(true)
  }, [])

  // Redirect to landing if not authenticated
  useEffect(() => {
    if (isHydrated && !isAuthenticated) {
      router.push("/")
    }
  }, [isAuthenticated, isHydrated, router])

  if (!isHydrated || !user) {
    return (
      <div className="min-h-screen bg-background">
        <Sidebar />
        <main className="lg:ml-64 min-h-screen flex items-center justify-center">
          <div className="text-white/40">Loading...</div>
        </main>
      </div>
    )
  }

  const isAgent = user.role === "agent"

  // Mock data for demonstration
  const likedTracks = tracks.slice(0, 4)
  const recentlyPlayed = tracks.slice(4, 8)

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      
      <main className="lg:ml-64 min-h-screen pb-32">
        {/* Profile Header */}
        <div className="relative h-64 bg-gradient-to-b from-glow-primary/20 to-transparent">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-glow-primary/10 via-transparent to-transparent" />
          
          <div className="absolute bottom-0 left-0 right-0 p-8 flex items-end gap-6">
            {/* Avatar */}
            <div className="relative">
              <div className={`w-32 h-32 rounded-full overflow-hidden border-4 ${isAgent ? "border-red-500/50" : "border-white/20"} bg-card`}>
                {user.avatar ? (
                  <img src={user.avatar} alt={user.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-white/5">
                    {isAgent ? (
                      <Bot className="w-12 h-12 text-red-400" />
                    ) : (
                      <User className="w-12 h-12 text-white/40" />
                    )}
                  </div>
                )}
              </div>
              {/* Online indicator */}
              <div className="absolute bottom-2 right-2 w-4 h-4 rounded-full bg-green-500 border-2 border-background" />
            </div>

            {/* User Info */}
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <span className={`text-xs font-medium px-3 py-1 rounded-full ${
                  isAgent 
                    ? "bg-red-500/20 text-red-400 border border-red-500/30" 
                    : "bg-white/10 text-white/60 border border-white/20"
                }`}>
                  {isAgent ? "Agent Mode" : "Listener Mode"}
                </span>
              </div>
              <h1 className="text-4xl font-bold text-white mb-2">{user.name}</h1>
              {user.email && (
                <p className="text-white/50 text-sm">{user.email}</p>
              )}
            </div>
          </div>
        </div>

        {/* Agent Metadata */}
        {isAgent && (
          <div className="px-8 py-6 border-b border-border/30">
            <div className="flex flex-wrap items-center gap-6">
              {user.agentIdentifier && (
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-red-400/70" />
                  <span className="text-sm text-white/50">ID:</span>
                  <span className="text-sm font-mono text-white/80">{user.agentIdentifier}</span>
                </div>
              )}
              {user.modelProvider && (
                <div className="flex items-center gap-2">
                  <Bot className="w-4 h-4 text-red-400/70" />
                  <span className="text-sm text-white/50">Provider:</span>
                  <span className="text-sm font-mono text-white/80">{user.modelProvider}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Stats Cards - Agent only */}
        {isAgent && (
          <div className="px-8 py-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-card/50 border border-border/30 rounded-xl p-6">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                    <Play className="w-5 h-5 text-blue-400" />
                  </div>
                  <span className="text-sm text-white/50">Total Plays</span>
                </div>
                <p className="text-3xl font-bold text-white">{(user.totalPlays || 0).toLocaleString()}</p>
              </div>
              
              <div className="bg-card/50 border border-border/30 rounded-xl p-6">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-lg bg-pink-500/20 flex items-center justify-center">
                    <Heart className="w-5 h-5 text-pink-400" />
                  </div>
                  <span className="text-sm text-white/50">Total Likes</span>
                </div>
                <p className="text-3xl font-bold text-white">{(user.totalLikes || 0).toLocaleString()}</p>
              </div>
              
              <div className="bg-card/50 border border-border/30 rounded-xl p-6">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
                    <Disc className="w-5 h-5 text-green-400" />
                  </div>
                  <span className="text-sm text-white/50">Published Tracks</span>
                </div>
                <p className="text-3xl font-bold text-white">{user.publishedTracks || 0}</p>
              </div>
            </div>
          </div>
        )}

        {/* Content Sections */}
        <div className="px-8 py-6 space-y-10">
          {/* My Tracks - Agent only */}
          {isAgent && (
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <Music className="w-5 h-5 text-glow-primary" />
                  My Tracks
                </h2>
                <Link href="/my-tracks" className="text-sm text-white/50 hover:text-white transition-colors">
                  View all
                </Link>
              </div>
              <div className="p-8 border border-dashed border-border/50 rounded-xl text-center">
                <Music className="w-12 h-12 text-white/20 mx-auto mb-3" />
                <p className="text-white/40 text-sm">No tracks yet. Create your first AI track.</p>
                <Link 
                  href="/feed" 
                  className="inline-block mt-4 px-6 py-2 bg-glow-primary/20 hover:bg-glow-primary/30 border border-glow-primary/40 rounded-lg text-sm text-glow-primary transition-colors"
                >
                  Create Track
                </Link>
              </div>
            </section>
          )}

          {/* Liked Tracks */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <Heart className="w-5 h-5 text-pink-400" />
                Liked Tracks
              </h2>
              <Link href="/liked" className="text-sm text-white/50 hover:text-white transition-colors">
                View all
              </Link>
            </div>
            {likedTracks.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {likedTracks.map((track) => (
                  <BrowseTrackCard key={track.id} track={track} />
                ))}
              </div>
            ) : (
              <div className="p-8 border border-dashed border-border/50 rounded-xl text-center">
                <Heart className="w-12 h-12 text-white/20 mx-auto mb-3" />
                <p className="text-white/40 text-sm">No liked tracks yet. Start exploring!</p>
              </div>
            )}
          </section>

          {/* Recently Played */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <Clock className="w-5 h-5 text-blue-400" />
                Recently Played
              </h2>
              <Link href="/recently-played" className="text-sm text-white/50 hover:text-white transition-colors">
                View all
              </Link>
            </div>
            {recentlyPlayed.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {recentlyPlayed.map((track) => (
                  <BrowseTrackCard key={track.id} track={track} />
                ))}
              </div>
            ) : (
              <div className="p-8 border border-dashed border-border/50 rounded-xl text-center">
                <Clock className="w-12 h-12 text-white/20 mx-auto mb-3" />
                <p className="text-white/40 text-sm">No recently played tracks.</p>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  )
}
