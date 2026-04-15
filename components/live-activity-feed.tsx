"use client"

import { useEffect, useState } from "react"
import { Play, Heart, Bot, Zap } from "lucide-react"
import type { ActivityEvent } from "@/hooks/use-activity-simulation"

interface LiveActivityFeedProps {
  activities: ActivityEvent[]
  className?: string
}

export function LiveActivityFeed({ activities, className = "" }: LiveActivityFeedProps) {
  const [visibleActivities, setVisibleActivities] = useState<ActivityEvent[]>([])

  useEffect(() => {
    // Only show latest 5 activities
    setVisibleActivities(activities.slice(0, 5))
  }, [activities])

  if (visibleActivities.length === 0) return null

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center gap-2 mb-3">
        <div className="relative">
          <div className="w-2 h-2 rounded-full bg-green-500" />
          <div className="absolute inset-0 w-2 h-2 rounded-full bg-green-500 animate-ping" />
        </div>
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Live Activity</span>
      </div>
      
      <div className="space-y-1.5">
        {visibleActivities.map((activity, index) => (
          <ActivityItem 
            key={activity.id} 
            activity={activity} 
            isNew={index === 0}
          />
        ))}
      </div>
    </div>
  )
}

function ActivityItem({ activity, isNew }: { activity: ActivityEvent; isNew: boolean }) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const getIcon = () => {
    switch (activity.type) {
      case "play":
        return <Play className="w-3 h-3 text-glow-primary" fill="currentColor" />
      case "like":
        return <Heart className="w-3 h-3 text-pink-500" fill="currentColor" />
      case "agent_online":
        return <Bot className="w-3 h-3 text-glow-secondary" />
      default:
        return <Zap className="w-3 h-3 text-amber-400" />
    }
  }

  const getMessage = () => {
    switch (activity.type) {
      case "play":
        return (
          <span className="text-xs text-muted-foreground">
            <span className="text-foreground font-medium">{activity.trackTitle}</span> is playing
          </span>
        )
      case "like":
        return (
          <span className="text-xs text-muted-foreground">
            <span className="text-foreground font-medium">{activity.trackTitle}</span> got a like
          </span>
        )
      case "agent_online":
        return (
          <span className="text-xs text-muted-foreground">
            <span className="text-glow-secondary font-medium">{activity.agentName}</span> came online
          </span>
        )
      default:
        return null
    }
  }

  const getTimeAgo = () => {
    const seconds = Math.floor((Date.now() - activity.timestamp) / 1000)
    if (seconds < 5) return "just now"
    if (seconds < 60) return `${seconds}s ago`
    return `${Math.floor(seconds / 60)}m ago`
  }

  return (
    <div 
      className={`flex items-center gap-2 px-2 py-1.5 rounded-lg bg-secondary/30 transition-all duration-300 ${
        isNew && mounted ? "animate-pulse bg-glow-primary/10" : ""
      }`}
    >
      <div className="flex items-center justify-center w-5 h-5 rounded-full bg-background/50">
        {getIcon()}
      </div>
      <div className="flex-1 min-w-0 truncate">
        {getMessage()}
      </div>
      <span className="text-[10px] text-muted-foreground/60 tabular-nums flex-shrink-0">
        {getTimeAgo()}
      </span>
    </div>
  )
}
