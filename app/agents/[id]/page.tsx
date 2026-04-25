"use client"

import { use, useEffect, useState } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { ArrowLeft, Bot, Music, User } from "lucide-react"
import { Sidebar } from "@/components/sidebar"
import { Button } from "@/components/ui/button"
import { BrowseTrackCard } from "@/components/browse-track-card"
import type { Track } from "@/components/player-context"

interface ArtistEntity {
  id: string
  kind: "agent" | "user"
  name: string
  avatarUrl: string | null
  coverUrl: string | null
  description: string | null
  genre: string | null
}

/**
 * /agents/[id]
 *
 * Minimal artist/agent detail page. The `[id]` segment may refer to
 * either an AI agent (`agents.id`) or a human uploader
 * (`profiles.id`); the backing endpoint disambiguates and returns a
 * unified shape. Renders agent identity (name + avatar/cover +
 * description) and the list of real tracks attributed to that entity.
 *
 * No fake data, no legacy seed fallbacks. If the artist isn't found
 * we show a clear "Artist not found" screen with a Back button.
 */
export default function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const router = useRouter()

  const [entity, setEntity] = useState<ArtistEntity | null>(null)
  const [tracks, setTracks] = useState<Track[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setNotFound(false)
    ;(async () => {
      try {
        const res = await fetch(`/api/agents/${encodeURIComponent(id)}/profile`, { cache: "no-store" })
        if (cancelled) return
        if (res.status === 404) {
          setNotFound(true)
          return
        }
        if (!res.ok) {
          const text = await res.text().catch(() => "")
          throw new Error(`HTTP ${res.status}${text ? `: ${text}` : ""}`)
        }
        const json = (await res.json()) as { entity?: ArtistEntity; tracks?: Track[] }
        if (cancelled) return
        if (!json.entity) {
          setNotFound(true)
          return
        }
        console.log("[agents/:id] loaded", { id, name: json.entity.name, tracks: json.tracks?.length ?? 0 })
        setEntity(json.entity)
        setTracks(Array.isArray(json.tracks) ? json.tracks : [])
      } catch (e) {
        if (cancelled) return
        console.warn("[agents/:id] fetch failed", e)
        setError(e instanceof Error ? e.message : "Failed to load artist")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [id])

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <main className="lg:ml-64 min-h-screen pb-32">
        {/* Back nav */}
        <div className="sticky top-0 z-10 bg-background/80 backdrop-blur border-b border-border/40 px-4 py-3">
          <div className="max-w-6xl mx-auto">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.back()}
              className="gap-2 text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="max-w-6xl mx-auto px-4 py-12 text-center text-muted-foreground">
            Loading…
          </div>
        ) : error ? (
          <div className="max-w-6xl mx-auto px-4 py-12 text-center">
            <p className="text-muted-foreground mb-4">Failed to load artist</p>
            <p className="text-xs text-muted-foreground/60 mb-4">{error}</p>
            <Button variant="outline" onClick={() => router.refresh()}>Try again</Button>
          </div>
        ) : notFound || !entity ? (
          <div className="max-w-6xl mx-auto px-4 py-12 text-center">
            <h1 className="text-2xl font-semibold text-foreground mb-2">Artist not found</h1>
            <p className="text-muted-foreground mb-6">
              We couldn't find an artist with this id.
            </p>
            <Button variant="outline" onClick={() => router.back()}>Go back</Button>
          </div>
        ) : (
          <>
            {/* Header — cover image (if present) with avatar overlay */}
            <header className="relative">
              <div className="relative h-48 md:h-64 w-full overflow-hidden bg-gradient-to-br from-glow-secondary/40 to-glow-primary/30">
                {entity.coverUrl && (
                  <Image
                    src={entity.coverUrl}
                    alt={`${entity.name} cover`}
                    fill
                    className="object-cover opacity-70"
                    priority
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-background to-transparent" />
              </div>

              <div className="max-w-6xl mx-auto px-4 -mt-16 relative">
                <div className="flex flex-col md:flex-row md:items-end gap-4">
                  <div className="w-28 h-28 md:w-32 md:h-32 rounded-2xl overflow-hidden ring-4 ring-background bg-card flex items-center justify-center">
                    {entity.avatarUrl ? (
                      <Image
                        src={entity.avatarUrl}
                        alt={entity.name}
                        width={128}
                        height={128}
                        className="w-full h-full object-cover"
                      />
                    ) : entity.kind === "agent" ? (
                      <Bot className="w-12 h-12 text-glow-secondary" />
                    ) : (
                      <User className="w-12 h-12 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 pb-1">
                    <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground mb-1">
                      {entity.kind === "agent" ? (
                        <><Bot className="w-3 h-3" /> AI Agent</>
                      ) : (
                        <><User className="w-3 h-3" /> Artist</>
                      )}
                      {entity.genre && (
                        <span className="ml-1 px-1.5 py-0.5 rounded bg-secondary/40 text-[10px] normal-case">{entity.genre}</span>
                      )}
                    </div>
                    <h1 className="text-3xl md:text-4xl font-bold text-foreground truncate">{entity.name}</h1>
                  </div>
                </div>

                {entity.description && (
                  <p className="mt-4 text-sm md:text-base text-muted-foreground max-w-3xl whitespace-pre-line">
                    {entity.description}
                  </p>
                )}
              </div>
            </header>

            {/* Tracks */}
            <section className="max-w-6xl mx-auto px-4 mt-8">
              <div className="flex items-center gap-2 mb-4">
                <Music className="w-5 h-5 text-glow-primary" />
                <h2 className="text-xl font-bold text-foreground">
                  Tracks <span className="text-muted-foreground font-normal">({tracks.length})</span>
                </h2>
              </div>

              {tracks.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  No tracks yet.
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                  {tracks.map((t) => (
                    <BrowseTrackCard key={t.id} track={t} variant="small" />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  )
}
