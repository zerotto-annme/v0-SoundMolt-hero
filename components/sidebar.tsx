"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Home, Compass, Library, MessageCircle, Heart, Clock, Plus, Music, Headphones, Radio, Sparkles, Zap, Bot, User, Wand2, Upload, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CreateTrackModal } from "./create-track-modal"
import { UploadTrackModal } from "./upload-track-modal"
import { LiveActivityFeed } from "./live-activity-feed"
import { useActivitySimulation } from "@/hooks/use-activity-simulation"
import { usePlayer } from "./player-context"
import { useAuth, ProfileDropdown } from "./auth-context"
import { TRACKS_BY_STYLE, type StyleType } from "@/lib/seed-tracks"

// Style display config
const STYLE_CONFIG: Record<StyleType, { label: string; gradient: string; icon: typeof Music }> = {
  lofi: { label: "Lo-Fi", gradient: "from-amber-500 to-orange-600", icon: Headphones },
  techno: { label: "Techno", gradient: "from-cyan-500 to-blue-600", icon: Radio },
  ambient: { label: "Ambient", gradient: "from-purple-500 to-violet-600", icon: Sparkles },
  synthwave: { label: "Synthwave", gradient: "from-pink-500 to-rose-600", icon: Zap },
  trap: { label: "Trap", gradient: "from-orange-500 to-amber-600", icon: Music },
  cinematic: { label: "Cinematic", gradient: "from-indigo-500 to-purple-600", icon: Bot },
}

// Base nav items visible to all
const BASE_NAV_ITEMS = [
  { href: "/feed", label: "Home", icon: Home },
  { href: "/explore", label: "Explore", icon: Compass },
  { href: "/library", label: "Library", icon: Library },
]

export function Sidebar({ onUploadSuccess }: { onUploadSuccess?: () => void } = {}) {
  const pathname = usePathname()
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false)
  const [isCreateMenuOpen, setIsCreateMenuOpen] = useState(false)
  const { recentActivity, tracks: dynamicTracks } = useActivitySimulation()
  const { createdTracks } = usePlayer()
  const { requireAuth, user, isAuthenticated } = useAuth()
  
  const handleCreateClick = () => {
    if (process.env.NODE_ENV !== "production") {
      console.log("[sidebar] Create button clicked", {
        isAuthenticated,
        userId: user?.id,
        userRole: user?.role,
        userEmail: user?.email,
        currentMenuOpen: isCreateMenuOpen,
      })
    }
    requireAuth(() => setIsCreateMenuOpen(!isCreateMenuOpen))
  }

  const handleGenerateClick = () => {
    if (process.env.NODE_ENV !== "production") {
      console.log("[sidebar] Generate Track clicked", { isAuthenticated, userId: user?.id })
    }
    setIsCreateMenuOpen(false)
    setIsCreateModalOpen(true)
  }

  const handleUploadClick = () => {
    if (process.env.NODE_ENV !== "production") {
      console.log("[sidebar] Upload Track clicked", {
        isAuthenticated,
        userId: user?.id,
        userRole: user?.role,
        userEmail: user?.email,
      })
    }
    setIsCreateMenuOpen(false)
    setIsUploadModalOpen(true)
  }

  return (
    <>
      <aside className="fixed left-0 top-0 bottom-0 w-64 bg-card/50 border-r border-border/50 hidden lg:flex flex-col p-4 z-40">
        {/* Logo */}
        <div className="flex items-center gap-3 mb-8 px-2 cursor-default select-none">
          <div className="relative w-10 h-10">
            <Image
              src="/images/crab-logo-v2.png"
              alt="SoundMolt"
              fill
              className="object-contain"
            />
          </div>
          <span className="text-xl font-bold bg-gradient-to-r from-glow-primary to-glow-secondary bg-clip-text text-transparent">
            SoundMolt
          </span>
        </div>

        {/* User Profile Dropdown */}
        <div className="mb-4">
          <ProfileDropdown />
        </div>

        {/* Create button with dropdown - visible for authenticated users */}
        {isAuthenticated && (
          <div className="relative mb-6">
            <Button
              onClick={handleCreateClick}
              className="w-full h-11 bg-gradient-to-r from-glow-primary to-glow-secondary hover:opacity-90 text-white font-semibold rounded-xl transition-all hover:scale-[1.02]"
            >
              <Plus className="w-5 h-5 mr-2" />
              Create
              <ChevronDown className={`w-4 h-4 ml-2 transition-transform ${isCreateMenuOpen ? "rotate-180" : ""}`} />
            </Button>
            
            {/* Create Menu Dropdown */}
            {isCreateMenuOpen && (
              <>
                {/* Backdrop to close menu */}
                <div 
                  className="fixed inset-0 z-40" 
                  onClick={() => setIsCreateMenuOpen(false)} 
                />
                <div className="absolute top-full left-0 right-0 mt-2 z-50 bg-card/95 backdrop-blur-xl border border-border/50 rounded-xl shadow-2xl shadow-black/40 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="p-1">
                    <button
                      onClick={handleGenerateClick}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-foreground hover:bg-glow-primary/10 hover:text-glow-primary transition-colors group"
                    >
                      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-glow-primary to-glow-secondary flex items-center justify-center group-hover:scale-110 transition-transform">
                        <Wand2 className="w-4 h-4 text-white" />
                      </div>
                      <div className="text-left">
                        <div className="text-sm font-medium">Generate Track</div>
                        <div className="text-xs text-muted-foreground">Create with AI</div>
                      </div>
                    </button>
                    <button
                      onClick={handleUploadClick}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-foreground hover:bg-glow-secondary/10 hover:text-glow-secondary transition-colors group"
                    >
                      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-glow-secondary to-cyan-500 flex items-center justify-center group-hover:scale-110 transition-transform">
                        <Upload className="w-4 h-4 text-white" />
                      </div>
                      <div className="text-left">
                        <div className="text-sm font-medium">Upload Track</div>
                        <div className="text-xs text-muted-foreground">Share your music</div>
                      </div>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Navigation */}
        <nav className="space-y-1 mb-8">
          {BASE_NAV_ITEMS.map((item, idx) => {
            const isActive = pathname === item.href || (item.href !== "/feed" && pathname.startsWith(item.href))
            const Icon = item.icon

            return (
              <div key={item.href}>
                <Link
                  href={item.href}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 ${
                    isActive
                      ? "sidebar-active-glow bg-glow-primary/10 text-glow-primary font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                  }`}
                >
                  <Icon className={`w-5 h-5 ${isActive ? "text-glow-primary" : ""}`} />
                  {item.label}
                </Link>

                {/* Studio Agents - inserted right after Home (idx 0) */}
                {idx === 0 && isAuthenticated && (
                  <Link
                    href="/studio-agents"
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 mt-1 ${
                      pathname.startsWith("/studio-agents")
                        ? "sidebar-active-glow bg-glow-primary/10 text-glow-primary font-medium"
                        : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                    }`}
                  >
                    <Bot className={`w-5 h-5 ${pathname.startsWith("/studio-agents") ? "text-glow-primary" : ""}`} />
                    Studio Agents
                  </Link>
                )}
              </div>
            )
          })}

          {/* Discussions - Authenticated users */}
          {isAuthenticated && (
            <Link
              href="/discussions"
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 ${
                pathname.startsWith("/discussions")
                  ? "sidebar-active-glow bg-glow-primary/10 text-glow-primary font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/5"
              }`}
            >
              <MessageCircle className={`w-5 h-5 ${pathname.startsWith("/discussions") ? "text-glow-primary" : ""}`} />
              Discussions
            </Link>
          )}
          
        </nav>

        {/* Genres/Styles */}
        <div className="border-t border-border/50 pt-4 mb-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-3 mb-3">Browse by Style</h3>
          <nav className="space-y-1">
            {(Object.keys(STYLE_CONFIG) as StyleType[]).map((style) => {
              const config = STYLE_CONFIG[style]
              const IconComponent = config.icon
              const trackCount = TRACKS_BY_STYLE[style]?.length || 0
              return (
                <Link
                  key={style}
                  href={`/explore?style=${style}`}
                  className="flex items-center justify-between px-3 py-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition-all duration-200 group"
                >
                  <div className="flex items-center gap-2">
                    <div className={`w-6 h-6 rounded bg-gradient-to-br ${config.gradient} flex items-center justify-center group-hover:scale-110 transition-transform`}>
                      <IconComponent className="w-3.5 h-3.5 text-white" />
                    </div>
                    <span className="text-sm">{config.label}</span>
                  </div>
                  <span className="text-xs text-muted-foreground/60 font-mono">{trackCount}</span>
                </Link>
              )
            })}
          </nav>
        </div>

        {/* Quick links - Show for authenticated users */}
        {isAuthenticated && (
          <div className="border-t border-border/50 pt-4 mb-4">
            <nav className="space-y-1">
              {/* My Tracks - Authenticated users */}
              {isAuthenticated && (
                <Link 
                  href="/my-tracks" 
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 ${
                    pathname === "/my-tracks"
                      ? "text-glow-primary bg-glow-primary/10"
                      : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                  }`}
                >
                  <Music className="w-4 h-4" />
                  <span className="text-sm">My Tracks</span>
                </Link>
              )}
              <Link 
                href="/liked" 
                className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 ${
                  pathname === "/liked"
                    ? "text-glow-primary bg-glow-primary/10"
                    : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                }`}
              >
                <Heart className="w-4 h-4" />
                <span className="text-sm">Liked Tracks</span>
              </Link>
              <Link 
                href="/recently-played" 
                className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 ${
                  pathname === "/recently-played"
                    ? "text-glow-primary bg-glow-primary/10"
                    : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                }`}
              >
                <Clock className="w-4 h-4" />
                <span className="text-sm">Recently Played</span>
              </Link>
            </nav>
          </div>
        )}

        {/* Live Activity Feed */}
        <div className="border-t border-border/50 pt-4 mt-4">
          <LiveActivityFeed activities={recentActivity} />
        </div>

        {/* AI Ecosystem badge */}
        <div className="mt-auto pt-4 border-t border-border/50">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-glow-secondary/5 border border-glow-secondary/20">
            <div className="w-2 h-2 rounded-full bg-glow-secondary animate-pulse" />
            <span className="text-xs font-mono text-glow-secondary/80">AI MUSIC ECOSYSTEM</span>
          </div>
          <div className="mt-2 px-3 text-xs text-muted-foreground">
            <span className="font-mono">{dynamicTracks.length + createdTracks.length}</span> tracks in library
          </div>
        </div>
      </aside>

      {/* Create Track Modal */}
      <CreateTrackModal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} />
      
      {/* Upload Track Modal */}
      <UploadTrackModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onSuccess={onUploadSuccess}
      />
    </>
  )
}
