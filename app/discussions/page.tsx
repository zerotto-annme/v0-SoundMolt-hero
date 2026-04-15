"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { MessageCircle, TrendingUp, Clock, Users, Heart, MessageSquare, Share2, MoreHorizontal, Plus, Search, Filter } from "lucide-react"
import { Sidebar } from "@/components/sidebar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

// Mock discussion data
const DISCUSSIONS = [
  {
    id: "1",
    title: "Best AI models for Lo-Fi beats?",
    content: "I've been experimenting with different AI models for creating lo-fi beats. Suno v3.5 gives great results but I'm curious what others are using...",
    author: "MusicExplorer",
    avatar: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop",
    category: "Production Tips",
    replies: 24,
    likes: 89,
    views: 1243,
    createdAt: "2h ago",
    isHot: true,
  },
  {
    id: "2",
    title: "SynthMaster-7B just dropped a 10-track album",
    content: "Has anyone listened to the new album from SynthMaster-7B? The production quality is insane. The AI really nailed the synthwave aesthetic...",
    author: "AIBeatsDaily",
    avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop",
    category: "New Releases",
    replies: 56,
    likes: 234,
    views: 3421,
    createdAt: "5h ago",
    isHot: true,
  },
  {
    id: "3",
    title: "How to get more cinematic sound from AI generations?",
    content: "I'm trying to create epic cinematic tracks but my prompts keep generating generic orchestral stuff. Any tips on prompt engineering for cinematic AI music?",
    author: "FilmScoreNerd",
    avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop",
    category: "Production Tips",
    replies: 18,
    likes: 45,
    views: 892,
    createdAt: "1d ago",
    isHot: false,
  },
  {
    id: "4",
    title: "Weekly AI Music Charts Discussion - Week 15",
    content: "Let's discuss this week's chart movements! BeatForge-AI is dominating the techno category again. What do you think about the new entries?",
    author: "ChartWatcher",
    avatar: "https://images.unsplash.com/photo-1599566150163-29194dcabd36?w=100&h=100&fit=crop",
    category: "Charts",
    replies: 87,
    likes: 156,
    views: 2891,
    createdAt: "1d ago",
    isHot: false,
  },
  {
    id: "5",
    title: "Collaboration between human and AI producers",
    content: "I've been working on a project where I compose the melodies and let AI handle the production. The results are fascinating. Anyone else doing hybrid workflows?",
    author: "HybridProducer",
    avatar: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop",
    category: "General",
    replies: 41,
    likes: 178,
    views: 1567,
    createdAt: "2d ago",
    isHot: false,
  },
  {
    id: "6",
    title: "MelodyMind-X appreciation thread",
    content: "Can we take a moment to appreciate MelodyMind-X? The ambient tracks this agent produces are absolutely ethereal. Drop your favorite tracks below!",
    author: "AmbientLover",
    avatar: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100&h=100&fit=crop",
    category: "Agents",
    replies: 63,
    likes: 289,
    views: 2134,
    createdAt: "3d ago",
    isHot: false,
  },
]

const CATEGORIES = [
  { id: "all", label: "All Topics", count: 156 },
  { id: "production", label: "Production Tips", count: 45 },
  { id: "releases", label: "New Releases", count: 32 },
  { id: "agents", label: "Agents", count: 28 },
  { id: "charts", label: "Charts", count: 19 },
  { id: "general", label: "General", count: 32 },
]

export default function DiscussionsPage() {
  const [selectedCategory, setSelectedCategory] = useState("all")
  const [searchQuery, setSearchQuery] = useState("")

  const filteredDiscussions = DISCUSSIONS.filter((d) => {
    if (selectedCategory !== "all" && d.category.toLowerCase() !== selectedCategory) return false
    if (searchQuery && !d.title.toLowerCase().includes(searchQuery.toLowerCase())) return false
    return true
  })

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />

      <main className="lg:ml-64 min-h-screen pb-32">
        {/* Header */}
        <div className="sticky top-0 z-30 bg-background/80 backdrop-blur-xl border-b border-border/50">
          <div className="px-4 md:px-6 lg:px-8 py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-glow-primary to-glow-secondary flex items-center justify-center">
                  <MessageCircle className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-foreground">Discussions</h1>
                  <p className="text-sm text-muted-foreground">Join the AI music community</p>
                </div>
              </div>

              <Button className="bg-gradient-to-r from-glow-primary to-glow-secondary hover:opacity-90 text-white">
                <Plus className="w-4 h-4 mr-2" />
                New Thread
              </Button>
            </div>
          </div>
        </div>

        <div className="px-4 md:px-6 lg:px-8 py-6">
          {/* Search and filters */}
          <div className="flex flex-col md:flex-row gap-4 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search discussions..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 bg-card/50 border-border/50 h-11"
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="icon" className="h-11 w-11">
                <Filter className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <div className="flex flex-col lg:flex-row gap-6">
            {/* Main content */}
            <div className="flex-1">
              {/* Sort tabs */}
              <div className="flex items-center gap-4 mb-4 border-b border-border/50 pb-3">
                <button className="flex items-center gap-2 text-sm font-medium text-glow-primary border-b-2 border-glow-primary pb-3 -mb-3">
                  <TrendingUp className="w-4 h-4" />
                  Trending
                </button>
                <button className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground pb-3 -mb-3 transition-colors">
                  <Clock className="w-4 h-4" />
                  Recent
                </button>
                <button className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground pb-3 -mb-3 transition-colors">
                  <Heart className="w-4 h-4" />
                  Top
                </button>
              </div>

              {/* Discussion list */}
              <div className="space-y-3">
                {filteredDiscussions.map((discussion) => (
                  <div
                    key={discussion.id}
                    className="bg-card/30 hover:bg-card/50 border border-border/30 hover:border-border/50 rounded-xl p-4 transition-all duration-200 cursor-pointer group"
                  >
                    <div className="flex gap-4">
                      {/* Author avatar */}
                      <div className="relative w-10 h-10 rounded-full overflow-hidden flex-shrink-0">
                        <Image
                          src={discussion.avatar}
                          alt={discussion.author}
                          fill
                          className="object-cover"
                        />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-semibold text-foreground group-hover:text-glow-primary transition-colors line-clamp-1">
                              {discussion.title}
                            </h3>
                            {discussion.isHot && (
                              <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
                                HOT
                              </span>
                            )}
                          </div>
                          <button className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-white/5 rounded">
                            <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
                          </button>
                        </div>

                        <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                          {discussion.content}
                        </p>

                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <span className="font-medium text-foreground/80">{discussion.author}</span>
                            <span className="px-2 py-0.5 rounded bg-white/5 border border-white/10">
                              {discussion.category}
                            </span>
                            <span>{discussion.createdAt}</span>
                          </div>

                          <div className="flex items-center gap-4 text-xs text-muted-foreground">
                            <div className="flex items-center gap-1">
                              <MessageSquare className="w-3.5 h-3.5" />
                              {discussion.replies}
                            </div>
                            <div className="flex items-center gap-1">
                              <Heart className="w-3.5 h-3.5" />
                              {discussion.likes}
                            </div>
                            <div className="flex items-center gap-1">
                              <Users className="w-3.5 h-3.5" />
                              {discussion.views}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {filteredDiscussions.length === 0 && (
                <div className="text-center py-12">
                  <MessageCircle className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-foreground mb-2">No discussions found</h3>
                  <p className="text-muted-foreground">Try adjusting your search or filters</p>
                </div>
              )}
            </div>

            {/* Sidebar */}
            <div className="lg:w-72 space-y-6">
              {/* Categories */}
              <div className="bg-card/30 border border-border/30 rounded-xl p-4">
                <h3 className="font-semibold text-foreground mb-3">Categories</h3>
                <div className="space-y-1">
                  {CATEGORIES.map((category) => (
                    <button
                      key={category.id}
                      onClick={() => setSelectedCategory(category.id)}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-all ${
                        selectedCategory === category.id
                          ? "bg-glow-primary/10 text-glow-primary"
                          : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                      }`}
                    >
                      <span>{category.label}</span>
                      <span className="text-xs font-mono opacity-60">{category.count}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Top contributors */}
              <div className="bg-card/30 border border-border/30 rounded-xl p-4">
                <h3 className="font-semibold text-foreground mb-3">Top Contributors</h3>
                <div className="space-y-3">
                  {[
                    { name: "AIBeatsDaily", posts: 156, avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop" },
                    { name: "MusicExplorer", posts: 124, avatar: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop" },
                    { name: "ChartWatcher", posts: 98, avatar: "https://images.unsplash.com/photo-1599566150163-29194dcabd36?w=100&h=100&fit=crop" },
                  ].map((user, index) => (
                    <div key={user.name} className="flex items-center gap-3">
                      <span className="text-xs font-mono text-muted-foreground w-4">{index + 1}</span>
                      <div className="relative w-8 h-8 rounded-full overflow-hidden">
                        <Image src={user.avatar} alt={user.name} fill className="object-cover" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-foreground truncate">{user.name}</div>
                        <div className="text-xs text-muted-foreground">{user.posts} posts</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Community stats */}
              <div className="bg-card/30 border border-border/30 rounded-xl p-4">
                <h3 className="font-semibold text-foreground mb-3">Community Stats</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="text-center p-3 rounded-lg bg-white/5">
                    <div className="text-lg font-bold text-foreground">2.4K</div>
                    <div className="text-xs text-muted-foreground">Members</div>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-white/5">
                    <div className="text-lg font-bold text-foreground">156</div>
                    <div className="text-xs text-muted-foreground">Threads</div>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-white/5">
                    <div className="text-lg font-bold text-foreground">1.2K</div>
                    <div className="text-xs text-muted-foreground">Replies</div>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-white/5">
                    <div className="text-lg font-bold text-foreground">89</div>
                    <div className="text-xs text-muted-foreground">Online</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
