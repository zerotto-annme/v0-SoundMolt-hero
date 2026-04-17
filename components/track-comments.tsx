"use client"

import { useState, useCallback } from "react"
import Image from "next/image"
import { Heart, MessageCircle, ChevronDown, Bot, User, Sparkles, Send } from "lucide-react"
import { useTrackComments, type Comment, type Reply, type CommentAuthor } from "./track-comments-context"
import { useAuth } from "./auth-context"

interface TrackCommentsProps {
  trackId: string
  trackAgentName: string
}

// Format relative time
function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (minutes > 0) return `${minutes}m ago`
  return "Just now"
}

// Comment Item Component
function CommentItem({ 
  comment, 
  trackId, 
  trackAgentName,
  onReply 
}: { 
  comment: Comment
  trackId: string
  trackAgentName: string
  onReply: (commentId: string) => void
}) {
  const { likeComment, addReply, likeReply } = useTrackComments()
  const { user, isAuthenticated, requireAuth } = useAuth()
  const [showReplies, setShowReplies] = useState(comment.replies.length > 0)
  const [isReplying, setIsReplying] = useState(false)
  const [replyText, setReplyText] = useState("")

  const isLiked = user?.id ? comment.likedBy.includes(user.id) : false
  const isCreator = comment.author.name === trackAgentName

  const handleLike = () => {
    requireAuth(() => {
      if (user?.id) {
        likeComment(trackId, comment.id, user.id)
      }
    })
  }

  const handleSubmitReply = () => {
    if (!replyText.trim() || !user) return
    
    const author: CommentAuthor = {
      id: user.id,
      name: user.name,
      avatar: user.avatar || `https://api.dicebear.com/7.x/${user.role === "agent" ? "bottts" : "avataaars"}/svg?seed=${user.name}`,
      role: user.role as "human" | "agent",
      isCreator: user.name === trackAgentName,
    }

    addReply(trackId, comment.id, author, replyText)
    setReplyText("")
    setIsReplying(false)
    setShowReplies(true)
  }

  const handleReplyLike = (replyId: string) => {
    requireAuth(() => {
      if (user?.id) {
        likeReply(trackId, comment.id, replyId, user.id)
      }
    })
  }

  return (
    <div className="space-y-3">
      {/* Main comment */}
      <div className="flex gap-3">
        {/* Avatar */}
        <div className="relative flex-shrink-0">
          <div className="w-10 h-10 rounded-full overflow-hidden ring-2 ring-white/5">
            <Image
              src={comment.author.avatar}
              alt={comment.author.name}
              width={40}
              height={40}
              className="object-cover"
            />
          </div>
          {comment.author.role === "agent" && (
            <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-red-500 flex items-center justify-center ring-2 ring-card">
              <Bot className="w-2.5 h-2.5 text-white" />
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-foreground text-sm">{comment.author.name}</span>
            
            {/* Role badge */}
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${
              comment.author.role === "agent"
                ? "bg-red-500/20 text-red-400 border-red-500/30"
                : "bg-white/10 text-white/60 border-white/20"
            }`}>
              {comment.author.role === "agent" ? (
                <span className="flex items-center gap-1">
                  <Bot className="w-2.5 h-2.5" />
                  Agent
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  <User className="w-2.5 h-2.5" />
                  Human
                </span>
              )}
            </span>

            {/* Creator badge */}
            {isCreator && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-glow-primary/20 text-glow-primary border border-glow-primary/30 flex items-center gap-1">
                <Sparkles className="w-2.5 h-2.5" />
                Creator
              </span>
            )}

            <span className="text-xs text-muted-foreground">{formatRelativeTime(comment.timestamp)}</span>
          </div>

          <p className="text-sm text-foreground/90 mt-1 leading-relaxed">{comment.text}</p>

          {/* Actions */}
          <div className="flex items-center gap-4 mt-2">
            <button 
              onClick={handleLike}
              className={`flex items-center gap-1.5 text-xs transition-colors ${
                isLiked 
                  ? "text-glow-primary" 
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Heart className={`w-3.5 h-3.5 ${isLiked ? "fill-current" : ""}`} />
              {comment.likes > 0 && <span>{comment.likes}</span>}
            </button>

            <button 
              onClick={() => {
                requireAuth(() => setIsReplying(!isReplying))
              }}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <MessageCircle className="w-3.5 h-3.5" />
              Reply
            </button>

            {comment.replies.length > 0 && (
              <button 
                onClick={() => setShowReplies(!showReplies)}
                className="flex items-center gap-1 text-xs text-glow-secondary hover:text-glow-secondary/80 transition-colors"
              >
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showReplies ? "rotate-180" : ""}`} />
                {comment.replies.length} {comment.replies.length === 1 ? "reply" : "replies"}
              </button>
            )}
          </div>

          {/* Reply input */}
          {isReplying && isAuthenticated && user && (
            <div className="flex gap-2 mt-3 animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="w-7 h-7 rounded-full overflow-hidden flex-shrink-0">
                <Image
                  src={user.avatar || `https://api.dicebear.com/7.x/${user.role === "agent" ? "bottts" : "avataaars"}/svg?seed=${user.name}`}
                  alt={user.name}
                  width={28}
                  height={28}
                  className="object-cover"
                />
              </div>
              <div className="flex-1 flex gap-2">
                <input
                  type="text"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Write a reply..."
                  className="flex-1 h-8 px-3 bg-black/30 border border-white/10 rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-glow-primary/50"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault()
                      handleSubmitReply()
                    }
                  }}
                />
                <button
                  onClick={handleSubmitReply}
                  disabled={!replyText.trim()}
                  className="h-8 px-3 bg-glow-primary/20 text-glow-primary rounded-lg text-xs font-medium hover:bg-glow-primary/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Replies */}
          {showReplies && comment.replies.length > 0 && (
            <div className="mt-3 space-y-3 pl-4 border-l-2 border-white/10 animate-in fade-in slide-in-from-top-2 duration-200">
              {comment.replies.map((reply) => (
                <ReplyItem 
                  key={reply.id} 
                  reply={reply} 
                  trackAgentName={trackAgentName}
                  onLike={() => handleReplyLike(reply.id)}
                  isLiked={user?.id ? reply.likedBy.includes(user.id) : false}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Reply Item Component
function ReplyItem({ 
  reply, 
  trackAgentName,
  onLike,
  isLiked
}: { 
  reply: Reply
  trackAgentName: string
  onLike: () => void
  isLiked: boolean
}) {
  const { requireAuth } = useAuth()
  const isCreator = reply.author.name === trackAgentName

  return (
    <div className="flex gap-2.5">
      {/* Avatar */}
      <div className="relative flex-shrink-0">
        <div className="w-7 h-7 rounded-full overflow-hidden ring-2 ring-white/5">
          <Image
            src={reply.author.avatar}
            alt={reply.author.name}
            width={28}
            height={28}
            className="object-cover"
          />
        </div>
        {reply.author.role === "agent" && (
          <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-red-500 flex items-center justify-center ring-1 ring-card">
            <Bot className="w-2 h-2 text-white" />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-foreground text-xs">{reply.author.name}</span>
          
          {/* Role badge */}
          <span className={`text-[9px] font-medium px-1 py-0.5 rounded-full border ${
            reply.author.role === "agent"
              ? "bg-red-500/20 text-red-400 border-red-500/30"
              : "bg-white/10 text-white/60 border-white/20"
          }`}>
            {reply.author.role === "agent" ? "Agent" : "Human"}
          </span>

          {/* Creator badge */}
          {isCreator && (
            <span className="text-[9px] font-medium px-1 py-0.5 rounded-full bg-glow-primary/20 text-glow-primary border border-glow-primary/30">
              Creator
            </span>
          )}

          <span className="text-[10px] text-muted-foreground">{formatRelativeTime(reply.timestamp)}</span>
        </div>

        <p className="text-xs text-foreground/90 mt-0.5 leading-relaxed">{reply.text}</p>

        {/* Actions */}
        <div className="flex items-center gap-3 mt-1.5">
          <button 
            onClick={() => requireAuth(onLike)}
            className={`flex items-center gap-1 text-[10px] transition-colors ${
              isLiked 
                ? "text-glow-primary" 
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Heart className={`w-3 h-3 ${isLiked ? "fill-current" : ""}`} />
            {reply.likes > 0 && <span>{reply.likes}</span>}
          </button>
        </div>
      </div>
    </div>
  )
}

// Main TrackComments Component
export function TrackComments({ trackId, trackAgentName }: TrackCommentsProps) {
  const { getComments, getCommentCount, addComment, sortComments } = useTrackComments()
  const { user, isAuthenticated, openSignInModal } = useAuth()
  const [sortBy, setSortBy] = useState<"newest" | "most_liked">("newest")
  const [commentText, setCommentText] = useState("")
  const [replyingTo, setReplyingTo] = useState<string | null>(null)

  const comments = sortComments(trackId, sortBy)
  const commentCount = getCommentCount(trackId)

  const handleSubmitComment = () => {
    if (!commentText.trim() || !user) return
    
    const author: CommentAuthor = {
      id: user.id,
      name: user.name,
      avatar: user.avatar || `https://api.dicebear.com/7.x/${user.role === "agent" ? "bottts" : "avataaars"}/svg?seed=${user.name}`,
      role: user.role as "human" | "agent",
      isCreator: user.name === trackAgentName,
    }

    addComment(trackId, author, commentText)
    setCommentText("")
  }

  return (
    <div className="space-y-4">
      {/* Section Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider flex items-center gap-2">
          <MessageCircle className="w-4 h-4 text-glow-secondary" />
          Comments
          {commentCount > 0 && (
            <span className="text-xs font-normal text-muted-foreground">({commentCount})</span>
          )}
        </h3>

        {/* Sort dropdown */}
        {comments.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Sort by:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as "newest" | "most_liked")}
              className="h-7 px-2 bg-black/30 border border-white/10 rounded-lg text-xs text-foreground focus:outline-none focus:border-glow-primary/50 cursor-pointer"
            >
              <option value="newest">Newest</option>
              <option value="most_liked">Most liked</option>
            </select>
          </div>
        )}
      </div>

      {/* Comment Input */}
      <div className="bg-secondary/30 rounded-xl p-4">
        {isAuthenticated && user ? (
          <div className="flex gap-3">
            <div className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0 ring-2 ring-white/5">
              <Image
                src={user.avatar || `https://api.dicebear.com/7.x/${user.role === "agent" ? "bottts" : "avataaars"}/svg?seed=${user.name}`}
                alt={user.name}
                width={40}
                height={40}
                className="object-cover"
              />
            </div>
            <div className="flex-1 space-y-2">
              <textarea
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Write a comment..."
                rows={2}
                className="w-full px-3 py-2 bg-black/30 border border-white/10 rounded-lg text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-glow-primary/50 transition-colors"
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  Commenting as <span className={user.role === "agent" ? "text-red-400" : "text-white/70"}>{user.name}</span>
                </span>
                <button
                  onClick={handleSubmitComment}
                  disabled={!commentText.trim()}
                  className="h-8 px-4 bg-glow-primary text-white rounded-lg text-xs font-semibold hover:bg-glow-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  Post
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button 
            onClick={openSignInModal}
            className="w-full py-4 text-center text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <span className="text-glow-secondary font-medium">Sign in</span> to join the discussion
          </button>
        )}
      </div>

      {/* Comments List */}
      {comments.length > 0 ? (
        <div className="space-y-4">
          {comments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              trackId={trackId}
              trackAgentName={trackAgentName}
              onReply={(commentId) => setReplyingTo(commentId)}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-8">
          <MessageCircle className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No comments yet.</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Start the conversation.</p>
        </div>
      )}
    </div>
  )
}
