"use client"

import { useState, useCallback, useEffect } from "react"
import Image from "next/image"
import { Heart, MessageCircle, ChevronDown, Bot, User, Sparkles, Send, Clock } from "lucide-react"
import { useTrackComments, type Comment, type Reply, type CommentAuthor } from "./track-comments-context"
import { useAuth } from "./auth-context"
import { usePlayer, usePlayerProgress } from "./player-context"

interface TrackCommentsProps {
  trackId: string
  trackAgentName: string
  onSeekTo?: (seconds: number) => void
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
  onReply,
  onSeekTo
}: { 
  comment: Comment
  trackId: string
  trackAgentName: string
  onReply: (commentId: string) => void
  onSeekTo?: (seconds: number) => void
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
    <div className="space-y-3 scroll-mt-20" id={`track-comment-${comment.id}`}>
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
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Timestamp badge - clickable */}
            <button
              onClick={() => onSeekTo?.(comment.trackTimestamp)}
              className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-glow-primary/20 text-glow-primary border border-glow-primary/30 hover:bg-glow-primary/30 transition-colors flex items-center gap-1"
              title={`Jump to ${comment.timeLabel}`}
            >
              <Clock className="w-2.5 h-2.5" />
              {comment.timeLabel}
            </button>

            <span className="font-medium text-foreground text-sm">{comment.author.name}</span>
            

            {/* Creator badge */}
            {isCreator && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-glow-primary/20 text-glow-primary border border-glow-primary/30 flex items-center gap-1">
                <Sparkles className="w-2.5 h-2.5" />
                Creator
              </span>
            )}

            <span className="text-xs text-muted-foreground">{formatRelativeTime(comment.timestamp)}</span>
          </div>

          <p className="text-sm text-foreground/90 mt-1.5 leading-relaxed">{comment.text}</p>

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
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-foreground text-xs">{reply.author.name}</span>
          

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

// Format seconds to time label
function formatTimeLabel(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, "0")}`
}

// Main TrackComments Component
export function TrackComments({ trackId, trackAgentName, onSeekTo }: TrackCommentsProps) {
  const { getComments, getCommentCount, addComment, sortComments } = useTrackComments()
  const { user, isAuthenticated, openSignInModal } = useAuth()
  const { currentTrack, playTrack } = usePlayer()
  const { currentTime, duration, seekTo: playerSeekTo } = usePlayerProgress()
  const [sortBy, setSortBy] = useState<"newest" | "most_liked" | "by_time">("newest")
  const [commentText, setCommentText] = useState("")
  const [replyingTo, setReplyingTo] = useState<string | null>(null)
  const [capturedTime, setCapturedTime] = useState<number>(0)
  const [isInputFocused, setIsInputFocused] = useState(false)

  const comments = sortComments(trackId, sortBy)
  const commentCount = getCommentCount(trackId)
  const isCurrentTrack = currentTrack?.id === trackId

  // Capture time when input is focused
  const handleInputFocus = () => {
    setIsInputFocused(true)
    if (isCurrentTrack) {
      setCapturedTime(currentTime)
    }
  }

  // Handle seeking to a timestamp
  const handleSeekTo = useCallback((seconds: number) => {
    if (onSeekTo) {
      onSeekTo(seconds)
    } else if (isCurrentTrack && duration > 0) {
      const percent = (seconds / duration) * 100
      playerSeekTo(Math.max(0, Math.min(100, percent)))
    }
  }, [onSeekTo, isCurrentTrack, duration, playerSeekTo])

  const handleSubmitComment = () => {
    if (!commentText.trim() || !user) return
    
    const author: CommentAuthor = {
      id: user.id,
      name: user.name,
      avatar: user.avatar || `https://api.dicebear.com/7.x/${user.role === "agent" ? "bottts" : "avataaars"}/svg?seed=${user.name}`,
      role: user.role as "human" | "agent",
      isCreator: user.name === trackAgentName,
    }

    // Use captured time or current time
    const timeToUse = isInputFocused && capturedTime > 0 ? capturedTime : (isCurrentTrack ? currentTime : 0)
    const newComment = addComment(trackId, author, commentText, timeToUse)
    setCommentText("")
    setIsInputFocused(false)
    setCapturedTime(0)

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.getElementById(`track-comment-${newComment.id}`)?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        })
      })
    })
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
              onChange={(e) => setSortBy(e.target.value as "newest" | "most_liked" | "by_time")}
              className="h-7 px-2 bg-black/30 border border-white/10 rounded-lg text-xs text-foreground focus:outline-none focus:border-glow-primary/50 cursor-pointer"
            >
              <option value="newest">Newest</option>
              <option value="most_liked">Most liked</option>
              <option value="by_time">Track time</option>
            </select>
          </div>
        )}
      </div>

      {/* Comment Input */}
      <div className="bg-secondary/30 rounded-xl p-4">
        {isAuthenticated && user ? (
          <div className="space-y-3">
            {/* Time indicator */}
            {isInputFocused && (
              <div className="flex items-center gap-2 text-xs animate-in fade-in slide-in-from-top-1 duration-200">
                <Clock className="w-3.5 h-3.5 text-glow-primary" />
                <span className="text-muted-foreground">
                  Commenting at{" "}
                  <span className="font-mono font-semibold text-glow-primary">
                    {formatTimeLabel(capturedTime > 0 ? capturedTime : currentTime)}
                  </span>
                </span>
              </div>
            )}
            
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
                  onFocus={handleInputFocus}
                  onBlur={() => !commentText.trim() && setIsInputFocused(false)}
                  placeholder="Comment on this moment..."
                  rows={2}
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm text-black placeholder:text-gray-500 resize-none outline-none focus:outline-none focus:border-black focus:ring-1 focus:ring-black/20 transition-colors duration-150"
                />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    Commenting as <span className="text-white/70">{user.name}</span>
                  </span>
                  <button
                    onClick={handleSubmitComment}
                    disabled={!commentText.trim()}
                    className="h-8 px-4 bg-glow-primary text-white rounded-lg text-xs font-semibold hover:bg-glow-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-1.5"
                  >
                    <Clock className="w-3 h-3" />
                    Post
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <button 
            onClick={openSignInModal}
            className="w-full py-4 text-center text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <span className="text-glow-secondary font-medium">Sign in</span> to comment on moments
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
              onSeekTo={handleSeekTo}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-8">
          <Clock className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No comments yet.</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Be the first to comment on a moment in this track.</p>
        </div>
      )}
    </div>
  )
}
