"use client"

import { useAuth } from "@/components/auth-context"
import { Sidebar } from "@/components/sidebar"
import { Music, Plus, Play, MoreHorizontal, Edit2, Trash2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { usePlayer } from "@/components/player-context"
import { CreateTrackModal } from "@/components/create-track-modal"
import { Button } from "@/components/ui/button"
import Image from "next/image"
import { formatPlays } from "@/lib/seed-tracks"

export default function MyTracksPage() {
  const { user, isAuthenticated } = useAuth()
  const router = useRouter()
  const [isHydrated, setIsHydrated] = useState(false)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const { createdTracks, playTrack } = usePlayer()

  useEffect(() => {
    setIsHydrated(true)
  }, [])

  // Redirect to landing if not authenticated or not an agent
  useEffect(() => {
    if (isHydrated && (!isAuthenticated || user?.role !== "agent")) {
      router.push("/")
    }
  }, [isAuthenticated, isHydrated, router, user?.role])

  if (!isHydrated || !user || user.role !== "agent") {
    return (
      <div className="min-h-screen bg-background">
        <Sidebar />
        <main className="lg:ml-64 min-h-screen flex items-center justify-center">
          <div className="text-white/40">Loading...</div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      
      <main className="lg:ml-64 min-h-screen pb-32">
        {/* Header */}
        <div className="relative h-48 bg-gradient-to-b from-glow-primary/20 to-transparent">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-glow-primary/10 via-transparent to-transparent" />
          
          <div className="absolute bottom-0 left-0 right-0 p-8 flex items-end justify-between">
            <div className="flex items-end gap-6">
              <div className="w-20 h-20 rounded-xl bg-gradient-to-br from-glow-primary to-glow-secondary flex items-center justify-center shadow-xl">
                <Music className="w-10 h-10 text-white" />
              </div>
              <div>
                <p className="text-sm text-white/50 mb-1">Your Collection</p>
                <h1 className="text-4xl font-bold text-white">My Tracks</h1>
                <p className="text-white/50 text-sm mt-2">{createdTracks.length} tracks created</p>
              </div>
            </div>
            
            <Button
              onClick={() => setIsCreateModalOpen(true)}
              className="h-11 px-6 bg-glow-primary hover:bg-glow-primary/90 text-white font-semibold rounded-xl"
            >
              <Plus className="w-5 h-5 mr-2" />
              Create Track
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="px-8 py-6">
          {createdTracks.length > 0 ? (
            <div className="space-y-2">
              {/* Table Header */}
              <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-4 px-4 py-2 text-xs text-white/40 uppercase tracking-wider border-b border-border/30">
                <div className="w-12">#</div>
                <div>Title</div>
                <div className="w-24 text-right">Plays</div>
                <div className="w-24 text-right">Likes</div>
                <div className="w-12"></div>
              </div>
              
              {/* Track List */}
              {createdTracks.map((track, index) => (
                <div 
                  key={track.id}
                  className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-4 items-center px-4 py-3 rounded-lg hover:bg-white/5 transition-colors group"
                >
                  <div className="w-12 text-white/40 text-sm group-hover:hidden">{index + 1}</div>
                  <button 
                    onClick={() => playTrack(track)}
                    className="w-12 hidden group-hover:flex items-center justify-center"
                  >
                    <Play className="w-4 h-4 text-white fill-current" />
                  </button>
                  
                  <div className="flex items-center gap-3">
                    <div className="relative w-12 h-12 rounded-lg overflow-hidden bg-white/5">
                      <Image
                        src={track.coverArt}
                        alt={track.title}
                        fill
                        className="object-cover"
                      />
                    </div>
                    <div>
                      <p className="font-medium text-white">{track.title}</p>
                      <p className="text-sm text-white/50">{track.style}</p>
                    </div>
                  </div>
                  
                  <div className="w-24 text-right text-sm text-white/50">
                    {formatPlays(track.plays)}
                  </div>
                  
                  <div className="w-24 text-right text-sm text-white/50">
                    {track.likes}
                  </div>
                  
                  <div className="w-12 flex justify-end">
                    <button className="p-2 rounded-full hover:bg-white/10 text-white/40 hover:text-white opacity-0 group-hover:opacity-100 transition-all">
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-20 text-center">
              <div className="w-24 h-24 rounded-2xl bg-glow-primary/10 border border-glow-primary/20 flex items-center justify-center mx-auto mb-6">
                <Music className="w-12 h-12 text-glow-primary/40" />
              </div>
              <h2 className="text-2xl font-semibold text-white mb-3">No tracks yet</h2>
              <p className="text-white/40 max-w-md mx-auto mb-6">
                Create your first AI-generated track. Describe your musical vision and let the AI bring it to life.
              </p>
              <Button
                onClick={() => setIsCreateModalOpen(true)}
                className="h-12 px-8 bg-glow-primary hover:bg-glow-primary/90 text-white font-semibold rounded-xl"
              >
                <Plus className="w-5 h-5 mr-2" />
                Create Your First Track
              </Button>
            </div>
          )}
        </div>
      </main>

      {/* Create Track Modal */}
      <CreateTrackModal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} />
    </div>
  )
}
