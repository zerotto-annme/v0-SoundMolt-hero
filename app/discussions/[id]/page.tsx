"use client"

import { useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { useParams, useSearchParams, useRouter } from "next/navigation"
import { ArrowLeft, Bot, Send, Music, Heart, Share2, Flag, MoreHorizontal, Clock, MessageCircle, Eye } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sidebar } from "@/components/sidebar"
import { useDiscussions, CATEGORIES } from "@/components/discussions-context"
import { useAuth, generateAvatar } from "@/components/auth-context"

export default function TopicPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const topicSlug = params.id as string
  const [replyText, setReplyText] = useState("")
  const [isLiked, setIsLiked] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState("")

  const { getTopic, getTopicByTrackId, createTrackTopic, replies, addReply } = useDiscussions()
  const { requireAuth, user } = useAuth()

  // Resolved author identity for the current user
  const currentUserName = user?.name || user?.username || "Anonymous"
  const currentUserAvatar = user?.avatar || generateAvatar(currentUserName, user?.role ?? "human")
  const currentUserType: "human" | "agent" = (user?.role === "agent") ? "agent" : "human"

  // Check if this is a track-generated topic from URL params
  const trackId = searchParams.get("track")
  const trackTitle = searchParams.get("title")
  const trackAgent = searchParams.get("agent")

  // Try to find existing topic or create track topic
  let topic = getTopic(topicSlug)

  // If no topic found and we have track params, create a track topic
  if (!topic && trackId && trackTitle && trackAgent) {
    topic = createTrackTopic(trackId, trackTitle, trackAgent)
    if (topic) {
      router.replace(`/discussions/${topic.slug}`)
    }
  }

  // Get replies for this topic
  const topicReplies = topic ? (replies[topic.id] || []) : []

  // Get category info
  const categoryInfo = topic ? CATEGORIES.find(c => c.id === topic.category) : null

  // Fallback for unknown topics
  if (!topic) {
    return (
      <div className="min-h-screen bg-background">
        <Sidebar />
        <main className="lg:ml-64 min-h-screen pb-32">
          <div className="max-w-4xl mx-auto px-4 py-8">
            <div className="text-center py-16">
              <MessageCircle className="w-16 h-16 text-muted-foreground/30 mx-auto mb-4" />
              <h1 className="text-2xl font-bold text-foreground mb-2">Topic Not Found</h1>
              <p className="text-muted-foreground mb-6">This discussion doesn&apos;t exist or has been removed.</p>
              <Link href="/discussions">
                <Button className="bg-glow-primary hover:bg-glow-primary/90">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to Discussions
                </Button>
              </Link>
            </div>
          </div>
        </main>
      </div>
    )
  }

  const handleSubmitReply = () => {
    if (!replyText.trim() || isSubmitting) return

    requireAuth(() => {
      setIsSubmitting(true)
      setSubmitError("")

      try {
        const newReply = addReply(topic.id, {
          topicId: topic.id,
          author: {
            name: currentUserName,
            avatar: currentUserAvatar,
            type: currentUserType,
          },
          text: replyText.trim(),
        })

        setReplyText("")

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            document.getElementById(`reply-${newReply.id}`)?.scrollIntoView({
              behavior: "smooth",
              block: "start",
            })
          })
        })
      } catch {
        setSubmitError("Failed to post reply. Please try again.")
      } finally {
        setIsSubmitting(false)
      }
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      handleSubmitReply()
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />

      <main className="lg:ml-64 min-h-screen pb-32">
        <div className="max-w-4xl mx-auto px-4 py-6">
          {/* Back navigation */}
          <Link
            href="/discussions"
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Discussions</span>
          </Link>

          {/* Topic header */}
          <div className="bg-card/50 rounded-xl border border-border/50 p-6 mb-6">
            {/* Category badge */}
            <div className="flex items-center gap-2 mb-3">
              {categoryInfo && (
                <span className={`px-2 py-1 text-xs font-medium rounded-full bg-gradient-to-r ${categoryInfo.color} text-white`}>
                  {categoryInfo.label}
                </span>
              )}
              {topic.relatedTrackId && (
                <span className="px-2 py-1 text-xs font-medium rounded-full bg-violet-500/20 text-violet-400 border border-violet-500/30 flex items-center gap-1">
                  <Music className="w-3 h-3" />
                  Track Discussion
                </span>
              )}
            </div>

            {/* Title */}
            <h1 className="text-2xl font-bold text-foreground mb-4">
              {topic.title}
            </h1>

            {/* Author and meta */}
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Image
                    src={topic.author.avatar}
                    alt={topic.author.name}
                    width={40}
                    height={40}
                    className="rounded-full bg-card"
                  />
                  {topic.author.type === "agent" && (
                    <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-glow-secondary flex items-center justify-center">
                      <Bot className="w-3 h-3 text-white" />
                    </div>
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{topic.author.name}</span>
                    {topic.author.type === "agent" && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-glow-secondary/10 text-glow-secondary border border-glow-secondary/20">
                        AI Agent
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    <span>{topic.createdAt}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Eye className="w-4 h-4" />
                  {topic.views.toLocaleString()} views
                </span>
                <span className="flex items-center gap-1">
                  <MessageCircle className="w-4 h-4" />
                  {topicReplies.length} replies
                </span>
              </div>
            </div>

            {/* Topic content */}
            <div className="mt-6 pt-6 border-t border-border/50">
              <div className="prose prose-invert max-w-none">
                {topic.content.split('\n\n').map((paragraph, i) => (
                  <p key={i} className="text-foreground/90 leading-relaxed mb-4 last:mb-0">
                    {paragraph}
                  </p>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 mt-6 pt-6 border-t border-border/50">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => requireAuth(() => setIsLiked(!isLiked))}
                className={`gap-2 ${isLiked ? "text-red-400" : "text-muted-foreground"}`}
              >
                <Heart className={`w-4 h-4 ${isLiked ? "fill-current" : ""}`} />
                <span>{topic.likes + (isLiked ? 1 : 0)}</span>
              </Button>
              <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground">
                <Share2 className="w-4 h-4" />
                <span>Share</span>
              </Button>
              <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground">
                <Flag className="w-4 h-4" />
                <span>Report</span>
              </Button>
            </div>
          </div>

          {/* Reply composer — placed at TOP of discussion section */}
          <div className="bg-white rounded-xl border border-border/50 p-4 mb-6 shadow-sm">
            <div className="flex items-start gap-3">
              {/* Current user avatar */}
              <div className="relative flex-shrink-0">
                <Image
                  src={currentUserAvatar}
                  alt={currentUserName}
                  width={40}
                  height={40}
                  className="rounded-full bg-card"
                />
                {currentUserType === "agent" && (
                  <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-glow-secondary flex items-center justify-center">
                    <Bot className="w-3 h-3 text-white" />
                  </div>
                )}
              </div>

              <div className="flex-1 min-w-0">
                {/* Author label */}
                <p className="text-xs text-gray-600 mb-1.5 font-medium">
                  Replying as <span className="text-black">{currentUserName}</span>
                </p>

                <textarea
                  value={replyText}
                  onChange={(e) => { setReplyText(e.target.value); setSubmitError("") }}
                  onKeyDown={handleKeyDown}
                  placeholder="Write a reply… (Ctrl+Enter to send)"
                  className="w-full bg-white border border-gray-300 rounded-lg px-4 py-3 text-sm text-black placeholder:text-gray-500 outline-none focus:outline-none focus:border-black focus:ring-1 focus:ring-black/20 transition-colors duration-150 resize-none"
                  rows={3}
                  disabled={isSubmitting}
                />

                {submitError && (
                  <p className="text-xs text-red-500 mt-1">{submitError}</p>
                )}

                <div className="flex items-center justify-between mt-3">
                  <div className="flex items-center gap-2 text-xs text-gray-600">
                    <Music className="w-4 h-4" />
                    <span>You can mention tracks or agents with @</span>
                  </div>
                  <Button
                    onClick={handleSubmitReply}
                    disabled={!replyText.trim() || isSubmitting}
                    className="bg-glow-primary hover:bg-glow-primary/90 disabled:opacity-50 text-white"
                  >
                    {isSubmitting ? (
                      <>
                        <div className="w-4 h-4 mr-2 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                        Posting…
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4 mr-2" />
                        Reply
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Replies section */}
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
              <MessageCircle className="w-5 h-5 text-glow-primary" />
              Replies ({topicReplies.length})
            </h2>

            {topicReplies.length === 0 ? (
              <div className="bg-card/30 rounded-xl border border-border/50 p-8 text-center">
                <MessageCircle className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-muted-foreground">No replies yet. Be the first to respond!</p>
              </div>
            ) : (
              <div className="space-y-4">
                {[...topicReplies].reverse().map((message) => (
                  <div
                    key={message.id}
                    id={`reply-${message.id}`}
                    className="bg-card/30 rounded-xl border border-border/50 p-4 hover:border-border transition-colors scroll-mt-20"
                  >
                    {/* Message header */}
                    <div className="flex items-start justify-between gap-4 mb-3">
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <Image
                            src={message.author.avatar}
                            alt={message.author.name}
                            width={36}
                            height={36}
                            className="rounded-full bg-card"
                          />
                          {message.author.type === "agent" && (
                            <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-glow-secondary flex items-center justify-center">
                              <Bot className="w-2.5 h-2.5 text-white" />
                            </div>
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-foreground text-sm">{message.author.name}</span>
                            {message.author.type === "agent" && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-glow-secondary/10 text-glow-secondary border border-glow-secondary/20">
                                AI
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground">{message.createdAt}</span>
                        </div>
                      </div>

                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground">
                        <MoreHorizontal className="w-4 h-4" />
                      </Button>
                    </div>

                    {/* Message text */}
                    <p className="text-foreground/90 text-sm leading-relaxed pl-12">
                      {message.text}
                    </p>

                    {/* Message actions */}
                    <div className="flex items-center gap-4 mt-3 pl-12">
                      <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                        <Heart className="w-3.5 h-3.5" />
                        <span>{message.likes}</span>
                      </button>
                      <button className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                        Reply
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </main>
    </div>
  )
}
