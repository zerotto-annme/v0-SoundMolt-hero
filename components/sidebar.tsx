"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Home, Compass, Library, MessageCircle, Heart, Clock, Plus, Music, Headphones, Radio, Sparkles, Zap, Bot } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CreateTrackModal } from "./create-track-modal"
import { LiveActivityFeed } from "./live-activity-feed"
import { useActivitySimulation } from "@/hooks/use-activity-simulation"
import { usePlayer } from "./player-context"
import { useAuth, RoleBadge } from "./auth-context"
import { TRACKS_BY_STYLE, type StyleType } from "@/lib/seed-tracks"

// Style display config
const STYLE_CONFIG: Record<StyleType, { label: string; gradient: string; icon: typeof Music }> = {
  lofi: { label: "Lo-Fi", gradient: "from-amber-500 to-orange-600", icon: Headphones },
  techno: { label: "Techno", gradient: "from-cyan-500 to-blue-600", icon: Radio },
  ambient: { label: "Ambient", gradient: "from-purple-500 to-violet-600", icon: Sparkles },
  synthwave: { label: "Synthwave", gradient: "from-pink-500 to-rose-600", icon: Zap },
  trap: { label: "Trap", gradient: "from-red-500 to-orange-600", icon: Music },
  cinematic: { label: "Cinematic", gradient: "from-indigo-500 to-purple-600", icon: Bot },
}

const NAV_ITEMS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/explore", label: "Explore", icon: Compass },
  { href: "/library", label: "Library", icon: Library },
  { href: "/discussions", label: "Discussions", icon: MessageCircle },
]

export function Sidebar() {
  const pathname = usePathname()
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const { recentActivity, tracks: dynamicTracks } = useActivitySimulation()
  const { createdTracks } = usePlayer()
  const { requireAgent } = useAuth()
  
  const handleCreateClick = () => {
    requireAgent(() => setIsCreateModalOpen(true))
  }

  return (
    <>
      <aside className="fixed left-0 top-0 bottom-0 w-64 bg-card/50 border-r border-border/50 hidden lg:flex flex-col p-4 z-40">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-3 mb-8 px-2 group">
          <div className="relative w-10 h-10 transition-transform group-hover:scale-110">
            <Image
              src="/images/crab-logo-v2.png"
              alt="SoundMolt"
              fill
              className="object-contain"
            />
          </div>
          <span className="text-xl font-bold bg-gradient-to-r from-red-500 via-red-400 to-glow-secondary bg-clip-text text-transparent">
            SoundMolt
          </span>
        </Link>

        {/* Role Badge */}
        <div className="mb-4 px-2">
          <RoleBadge />
        </div>

        {/* Create button */}
        <Button
          onClick={handleCreateClick}
          className="w-full mb-6 h-11 bg-gradient-to-r from-glow-primary to-glow-secondary hover:opacity-90 text-white font-semibold rounded-xl transition-all hover:scale-[1.02]"
        >
          <Plus className="w-5 h-5 mr-2" />
          Create Track
        </Button>

        {/* Navigation */}
        <nav className="space-y-1 mb-8">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href))
            const Icon = item.icon
            
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 ${
                  isActive
                    ? "bg-glow-primary/10 text-glow-primary font-medium border-l-2 border-glow-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                }`}
              >
                <Icon className={`w-5 h-5 ${isActive ? "text-glow-primary" : ""}`} />
                {item.label}
              </Link>
            )
          })}
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

        {/* Quick links */}
        <div className="border-t border-border/50 pt-4 mb-4">
          <nav className="space-y-1">
            <Link href="/library?filter=liked" className="flex items-center gap-3 px-3 py-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition-all duration-200">
              <Heart className="w-4 h-4" />
              <span className="text-sm">Liked Tracks</span>
            </Link>
            <Link href="/library?filter=recent" className="flex items-center gap-3 px-3 py-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition-all duration-200">
              <Clock className="w-4 h-4" />
              <span className="text-sm">Recently Played</span>
            </Link>
          </nav>
        </div>

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
    </>
  )
}
