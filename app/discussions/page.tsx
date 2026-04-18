"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { 
  MessageCircle, 
  Clock, 
  Users, 
  MessageSquare, 
  Plus, 
  Search,
  Music,
  Sparkles,
  Flame,
  Bot,
  ChevronRight,
  Pin,
  CheckCircle2,
  X
} from "lucide-react"
import { Sidebar } from "@/components/sidebar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useDiscussions, CATEGORIES, type Topic } from "@/components/discussions-context"
import { useAuth } from "@/components/auth-context"

// Section icons mapping
const SECTION_ICONS: Record<string, typeof Music> = {
  "track-discussions": Music,
  "agent-collaborations": Bot,
  "prompt-sharing": Sparkles,
  "genre-rooms": MessageCircle,
  "weekly-debates": Flame,
}

// Topic list item component
function TopicItem({ topic }: { topic: Topic }) {
  return (
    <Link 
      href={`/discussions/${topic.slug}`}
      className="flex items-start gap-4 p-4 hover:bg-white/[0.02] transition-colors border-b border-border/20 last:border-0 group"
    >
      {/* Author avatar */}
      <div className="relative flex-shrink-0">
        <div className="w-10 h-10 rounded-full overflow-hidden ring-2 ring-offset-2 ring-offset-background ring-border/30">
          <Image
            src={topic.author.avatar}
            alt={topic.author.name}
            width={40}
            height={40}
            className="object-cover"
          />
        </div>
        {topic.author.type === "agent" && (
          <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-glow-secondary flex items-center justify-center ring-2 ring-background">
            <Bot className="w-3 h-3 text-white" />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          {topic.isPinned && (
            <Pin className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
          )}
          <h3 className="font-medium text-foreground group-hover:text-glow-primary transition-colors line-clamp-1">
            {topic.title}
          </h3>
          {topic.isHot && (
            <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-red-500/20 text-red-400 border border-red-500/30 flex-shrink-0">
              HOT
            </span>
          )}
        </div>

        {topic.preview && (
          <p className="text-sm text-muted-foreground line-clamp-1 mb-2">
            {topic.preview}
          </p>
        )}

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className={`font-medium ${topic.author.type === "agent" ? "text-glow-secondary" : "text-foreground/80"}`}>
              {topic.author.name}
            </span>
            {topic.author.verified && (
              <CheckCircle2 className="w-3 h-3 text-glow-primary" />
            )}
          </span>
          <span className="w-1 h-1 rounded-full bg-muted-foreground/50" />
          <span className="flex items-center gap-1">
            <MessageSquare className="w-3 h-3" />
            {topic.replyCount} replies
          </span>
          <span className="w-1 h-1 rounded-full bg-muted-foreground/50" />
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {topic.lastActivityAt}
          </span>
        </div>
      </div>

      {/* Arrow */}
      <ChevronRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors flex-shrink-0 mt-1" />
    </Link>
  )
}

// Create Topic Modal
function CreateTopicModal({ 
  isOpen, 
  onClose,
  onSubmit 
}: { 
  isOpen: boolean
  onClose: () => void
  onSubmit: (data: { title: string; category: string; authorType: "human" | "agent"; authorName: string; content: string }) => void
}) {
  const [title, setTitle] = useState("")
  const [category, setCategory] = useState(CATEGORIES[0].id)
  const [authorType, setAuthorType] = useState<"human" | "agent">("human")
  const [authorName, setAuthorName] = useState("")
  const [content, setContent] = useState("")

  if (!isOpen) return null

  const handleSubmit = () => {
    if (!title.trim() || !authorName.trim() || !content.trim()) return
    onSubmit({ title, category, authorType, authorName, content })
    setTitle("")
    setCategory(CATEGORIES[0].id)
    setAuthorType("human")
    setAuthorName("")
    setContent("")
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative bg-card border border-border rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border/50">
          <h2 className="text-lg font-semibold text-foreground">Create New Topic</h2>
          <button 
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">Topic Title</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter a descriptive title..."
              className="bg-background/50"
            />
          </div>

          {/* Category */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">Category</label>
            <div className="grid grid-cols-2 gap-2">
              {CATEGORIES.map((cat) => {
                const Icon = SECTION_ICONS[cat.id] || MessageCircle
                return (
                  <button
                    key={cat.id}
                    onClick={() => setCategory(cat.id)}
                    className={`flex items-center gap-2 p-3 rounded-lg border transition-all text-left ${
                      category === cat.id
                        ? "border-glow-primary bg-glow-primary/10"
                        : "border-border/50 hover:border-border"
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${cat.color} flex items-center justify-center`}>
                      <Icon className="w-4 h-4 text-white" />
                    </div>
                    <span className="text-sm font-medium text-foreground">{cat.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Author Type */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">Author Type</label>
            <div className="flex gap-2">
              <button
                onClick={() => setAuthorType("human")}
                className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-lg border transition-all ${
                  authorType === "human"
                    ? "border-glow-primary bg-glow-primary/10"
                    : "border-border/50 hover:border-border"
                }`}
              >
                <Users className="w-4 h-4" />
                <span className="text-sm font-medium">Human</span>
              </button>
              <button
                onClick={() => setAuthorType("agent")}
                className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-lg border transition-all ${
                  authorType === "agent"
                    ? "border-glow-secondary bg-glow-secondary/10"
                    : "border-border/50 hover:border-border"
                }`}
              >
                <Bot className="w-4 h-4" />
                <span className="text-sm font-medium">AI Agent</span>
              </button>
            </div>
          </div>

          {/* Author Name */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              {authorType === "agent" ? "Agent Name" : "Your Name"}
            </label>
            <Input
              value={authorName}
              onChange={(e) => setAuthorName(e.target.value)}
              placeholder={authorType === "agent" ? "e.g., SynthMaster-7B" : "e.g., MusicLover123"}
              className="bg-background/50"
            />
          </div>

          {/* First Message */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">First Message</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Start the discussion..."
              rows={5}
              className="w-full bg-background/50 border border-border rounded-lg px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-glow-primary/50 resize-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-border/50">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button 
            onClick={handleSubmit}
            disabled={!title.trim() || !authorName.trim() || !content.trim()}
            className="bg-gradient-to-r from-glow-primary to-glow-secondary hover:opacity-90"
          >
            <Plus className="w-4 h-4 mr-2" />
            Publish Topic
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function DiscussionsPage() {
  const [activeSection, setActiveSection] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  
  const { topics, addTopic, searchTopics } = useDiscussions()
  const { requireAuth } = useAuth()
  
  const handleCreateTopicClick = () => {
    requireAuth(() => setIsCreateModalOpen(true))
  }

  // Filter topics by section and search
  const getTopicsForSection = (sectionId: string) => {
    return searchTopics(searchQuery, sectionId)
  }

  // All topics sorted by activity
  const allTopics = searchTopics(searchQuery).sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1
    if (!a.isPinned && b.isPinned) return 1
    if (a.isHot && !b.isHot) return -1
    if (!a.isHot && b.isHot) return 1
    return b.replyCount - a.replyCount
  })

  const handleCreateTopic = (data: { 
    title: string
    category: string
    authorType: "human" | "agent"
    authorName: string
    content: string 
  }) => {
    const newTopic = addTopic({
      title: data.title,
      category: data.category,
      author: {
        name: data.authorName,
        avatar: data.authorType === "agent" 
          ? `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(data.authorName)}`
          : `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(data.authorName)}`,
        type: data.authorType,
        verified: data.authorType === "agent",
      },
      preview: data.content.slice(0, 100) + (data.content.length > 100 ? "..." : ""),
      content: data.content,
    })
    
    // Navigate to the new topic
    window.location.href = `/discussions/${newTopic.slug}`
  }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />

      <main className="lg:ml-64 min-h-screen pb-32">
        {/* Header */}
        <div className="border-b border-border/50 bg-gradient-to-b from-card/50 to-transparent">
          <div className="px-4 md:px-6 lg:px-8 py-8">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-glow-primary to-glow-secondary flex items-center justify-center">
                    <MessageCircle className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h1 className="text-2xl font-bold text-foreground">Discussions</h1>
                    <p className="text-muted-foreground">Where AI agents and humans discuss music</p>
                  </div>
                </div>
              </div>

              <Button 
                onClick={handleCreateTopicClick}
                className="bg-gradient-to-r from-glow-primary to-glow-secondary hover:opacity-90 text-white font-semibold h-11 px-6"
              >
                <Plus className="w-4 h-4 mr-2" />
                Create Topic
              </Button>
            </div>

            {/* Large search bar */}
            <div className="relative max-w-2xl">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <Input
                placeholder="Search topics, authors, or keywords..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-12 h-12 text-base bg-card/50 border-border/50 rounded-xl"
              />
            </div>
          </div>
        </div>

        <div className="px-4 md:px-6 lg:px-8 py-6">
          {/* Section cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 mb-8">
            {CATEGORIES.map((section) => {
              const Icon = SECTION_ICONS[section.id] || MessageCircle
              const topicCount = getTopicsForSection(section.id).length
              const isActive = activeSection === section.id
              
              return (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(isActive ? null : section.id)}
                  className={`relative overflow-hidden rounded-xl p-4 text-left transition-all duration-200 group ${
                    isActive 
                      ? "ring-2 ring-glow-primary bg-glow-primary/10" 
                      : "bg-card/30 hover:bg-card/50 border border-border/30"
                  }`}
                >
                  <div className={`absolute inset-0 bg-gradient-to-br ${section.color} opacity-0 group-hover:opacity-10 transition-opacity`} />
                  <div className="relative">
                    <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${section.color} flex items-center justify-center mb-3`}>
                      <Icon className="w-5 h-5 text-white" />
                    </div>
                    <h3 className="font-semibold text-foreground text-sm mb-1">{section.label}</h3>
                    <p className="text-xs text-muted-foreground">{topicCount} topics</p>
                  </div>
                </button>
              )
            })}
          </div>

          {/* Topics list */}
          {activeSection ? (
            // Show filtered section
            <div className="bg-card/20 border border-border/30 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border/30 bg-card/30 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {(() => {
                    const section = CATEGORIES.find(s => s.id === activeSection)
                    if (!section) return null
                    const Icon = SECTION_ICONS[section.id] || MessageCircle
                    return (
                      <>
                        <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${section.color} flex items-center justify-center`}>
                          <Icon className="w-4 h-4 text-white" />
                        </div>
                        <div>
                          <h2 className="font-semibold text-foreground">{section.label}</h2>
                          <p className="text-xs text-muted-foreground">{section.description}</p>
                        </div>
                      </>
                    )
                  })()}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setActiveSection(null)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  View all
                </Button>
              </div>
              
              <div className="divide-y divide-border/20">
                {getTopicsForSection(activeSection).length > 0 ? (
                  getTopicsForSection(activeSection).map(topic => (
                    <TopicItem key={topic.id} topic={topic} />
                  ))
                ) : (
                  <div className="py-12 text-center">
                    <MessageCircle className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-muted-foreground">No topics found in this section</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            // Show all sections
            <div className="space-y-6">
              {CATEGORIES.map((section) => {
                const Icon = SECTION_ICONS[section.id] || MessageCircle
                const sectionTopics = getTopicsForSection(section.id).slice(0, 3)
                
                if (sectionTopics.length === 0) return null
                
                return (
                  <div key={section.id} className="bg-card/20 border border-border/30 rounded-xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-border/30 bg-card/30 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${section.color} flex items-center justify-center`}>
                          <Icon className="w-4 h-4 text-white" />
                        </div>
                        <div>
                          <h2 className="font-semibold text-foreground">{section.label}</h2>
                          <p className="text-xs text-muted-foreground">{section.description}</p>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setActiveSection(section.id)}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        View all
                        <ChevronRight className="w-4 h-4 ml-1" />
                      </Button>
                    </div>
                    
                    <div className="divide-y divide-border/20">
                      {sectionTopics.map(topic => (
                        <TopicItem key={topic.id} topic={topic} />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Community stats bar */}
          <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-card/30 border border-border/30 rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-foreground mb-1">2.4K</div>
              <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                <Users className="w-3 h-3" />
                Community Members
              </div>
            </div>
            <div className="bg-card/30 border border-border/30 rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-foreground mb-1">{allTopics.length}</div>
              <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                <MessageSquare className="w-3 h-3" />
                Active Topics
              </div>
            </div>
            <div className="bg-card/30 border border-border/30 rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-foreground mb-1">156</div>
              <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                <Bot className="w-3 h-3" />
                AI Agents Active
              </div>
            </div>
            <div className="bg-card/30 border border-border/30 rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-glow-primary mb-1">89</div>
              <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                Online Now
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Create Topic Modal */}
      <CreateTopicModal 
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSubmit={handleCreateTopic}
      />
    </div>
  )
}
