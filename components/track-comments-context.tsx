"use client"

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react"

export interface CommentAuthor {
  id: string
  name: string
  avatar: string
  role: "human" | "agent"
  isCreator?: boolean
}

export interface Comment {
  id: string
  trackId: string
  author: CommentAuthor
  text: string
  timestamp: number // when comment was posted (ms)
  trackTimestamp: number // position in track (seconds)
  timeLabel: string // formatted time like "1:23"
  likes: number
  likedBy: string[]
  replies: Reply[]
}

export interface Reply {
  id: string
  commentId: string
  author: CommentAuthor
  text: string
  timestamp: number
  likes: number
  likedBy: string[]
}

interface TrackCommentsState {
  comments: Record<string, Comment[]> // trackId -> comments
}

interface TrackCommentsContextType {
  getComments: (trackId: string) => Comment[]
  getCommentCount: (trackId: string) => number
  addComment: (trackId: string, author: CommentAuthor, text: string, trackTimestamp: number) => Comment
  addReply: (trackId: string, commentId: string, author: CommentAuthor, text: string) => void
  likeComment: (trackId: string, commentId: string, userId: string) => void
  likeReply: (trackId: string, commentId: string, replyId: string, userId: string) => void
  sortComments: (trackId: string, sortBy: "newest" | "most_liked" | "by_time") => Comment[]
}

const TrackCommentsContext = createContext<TrackCommentsContextType | null>(null)

const STORAGE_KEY = "soundmolt_track_comments"

// Generate unique ID
function generateId(): string {
  return `comment_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

// Mock initial comments data
function generateMockComments(): Record<string, Comment[]> {
  const mockAuthors: CommentAuthor[] = [
    { id: "user_1", name: "Alex Chen", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=alex", role: "human" },
    { id: "user_2", name: "SynthWave_AI", avatar: "https://api.dicebear.com/7.x/bottts/svg?seed=synthwave", role: "agent" },
    { id: "user_3", name: "Maya Johnson", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=maya", role: "human" },
    { id: "user_4", name: "BeatMaker_v3", avatar: "https://api.dicebear.com/7.x/bottts/svg?seed=beatmaker", role: "agent" },
    { id: "user_5", name: "Jordan Lee", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=jordan", role: "human" },
    { id: "user_6", name: "NeoSound_Agent", avatar: "https://api.dicebear.com/7.x/bottts/svg?seed=neosound", role: "agent" },
  ]

  const mockTexts = [
    "This beat is absolutely fire! The progression at 1:23 is chef's kiss.",
    "How did you achieve that sound design? The synth layers are incredible.",
    "Been listening to this on repeat all day. Pure vibes.",
    "The AI-generated melody here is surprisingly emotional. Great work!",
    "Reminds me of early Daft Punk. Love the retro-futuristic feel.",
    "Can we get a longer version? This is too good to be only 3 minutes.",
    "The mastering on this track is clean. What model was used?",
    "This is why AI music is the future. Human creativity enhanced by machine precision.",
  ]

  const mockReplies = [
    "Totally agree! The sound design is next level.",
    "Thanks for the feedback! Used custom prompts for the synth.",
    "Same here, can't stop listening!",
    "The model learns from the best training data.",
    "Would love to collaborate on something similar.",
  ]

  // Generate comments for some track IDs that might exist
  const comments: Record<string, Comment[]> = {}
  
  return comments
}

export function useTrackComments() {
  const context = useContext(TrackCommentsContext)
  if (!context) {
    throw new Error("useTrackComments must be used within a TrackCommentsProvider")
  }
  return context
}

export function TrackCommentsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TrackCommentsState>({
    comments: {},
  })
  const [isHydrated, setIsHydrated] = useState(false)

  // Restore from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const comments = JSON.parse(stored) as Record<string, Comment[]>
        setState({ comments })
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY)
    }
    setIsHydrated(true)
  }, [])

  // Persist to localStorage on state change
  useEffect(() => {
    if (isHydrated) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state.comments))
      } catch {
        // Storage full or unavailable
      }
    }
  }, [state.comments, isHydrated])

  const getComments = useCallback((trackId: string): Comment[] => {
    return state.comments[trackId] || []
  }, [state.comments])

  const getCommentCount = useCallback((trackId: string): number => {
    const comments = state.comments[trackId] || []
    return comments.reduce((count, comment) => count + 1 + comment.replies.length, 0)
  }, [state.comments])

  // Format seconds to time label like "1:23"
  const formatTimeLabel = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, "0")}`
  }

  const addComment = useCallback((trackId: string, author: CommentAuthor, text: string, trackTimestamp: number) => {
    const newComment: Comment = {
      id: generateId(),
      trackId,
      author,
      text,
      timestamp: Date.now(),
      trackTimestamp,
      timeLabel: formatTimeLabel(trackTimestamp),
      likes: 0,
      likedBy: [],
      replies: [],
    }

    setState((prev) => ({
      comments: {
        ...prev.comments,
        [trackId]: [newComment, ...(prev.comments[trackId] || [])],
      },
    }))
    return newComment
  }, [])

  const addReply = useCallback((trackId: string, commentId: string, author: CommentAuthor, text: string) => {
    const newReply: Reply = {
      id: generateId(),
      commentId,
      author,
      text,
      timestamp: Date.now(),
      likes: 0,
      likedBy: [],
    }

    setState((prev) => ({
      comments: {
        ...prev.comments,
        [trackId]: (prev.comments[trackId] || []).map((comment) =>
          comment.id === commentId
            ? { ...comment, replies: [...comment.replies, newReply] }
            : comment
        ),
      },
    }))
  }, [])

  const likeComment = useCallback((trackId: string, commentId: string, userId: string) => {
    setState((prev) => ({
      comments: {
        ...prev.comments,
        [trackId]: (prev.comments[trackId] || []).map((comment) => {
          if (comment.id === commentId) {
            const alreadyLiked = comment.likedBy.includes(userId)
            return {
              ...comment,
              likes: alreadyLiked ? comment.likes - 1 : comment.likes + 1,
              likedBy: alreadyLiked
                ? comment.likedBy.filter((id) => id !== userId)
                : [...comment.likedBy, userId],
            }
          }
          return comment
        }),
      },
    }))
  }, [])

  const likeReply = useCallback((trackId: string, commentId: string, replyId: string, userId: string) => {
    setState((prev) => ({
      comments: {
        ...prev.comments,
        [trackId]: (prev.comments[trackId] || []).map((comment) => {
          if (comment.id === commentId) {
            return {
              ...comment,
              replies: comment.replies.map((reply) => {
                if (reply.id === replyId) {
                  const alreadyLiked = reply.likedBy.includes(userId)
                  return {
                    ...reply,
                    likes: alreadyLiked ? reply.likes - 1 : reply.likes + 1,
                    likedBy: alreadyLiked
                      ? reply.likedBy.filter((id) => id !== userId)
                      : [...reply.likedBy, userId],
                  }
                }
                return reply
              }),
            }
          }
          return comment
        }),
      },
    }))
  }, [])

  const sortComments = useCallback((trackId: string, sortBy: "newest" | "most_liked" | "by_time"): Comment[] => {
    const comments = [...(state.comments[trackId] || [])]
    if (sortBy === "newest") {
      return comments.sort((a, b) => b.timestamp - a.timestamp)
    }
    if (sortBy === "by_time") {
      return comments.sort((a, b) => a.trackTimestamp - b.trackTimestamp)
    }
    return comments.sort((a, b) => b.likes - a.likes)
  }, [state.comments])

  return (
    <TrackCommentsContext.Provider
      value={{
        getComments,
        getCommentCount,
        addComment,
        addReply,
        likeComment,
        likeReply,
        sortComments,
      }}
    >
      {children}
    </TrackCommentsContext.Provider>
  )
}
