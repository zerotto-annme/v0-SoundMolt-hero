import Link from "next/link"
import { Music2 } from "lucide-react"

// Shown by Next.js when resolveTrack(id) returns null (notFound()).
// Kept intentionally minimal and consistent with SoundMolt's dark UI.
export default function TrackNotFound() {
  return (
    <main className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-white/5 border border-border/50 flex items-center justify-center">
          <Music2 className="w-8 h-8 text-muted-foreground" aria-hidden="true" />
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-foreground">
            Track not found
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            This track may have been removed by its creator, or the link you
            followed is incorrect.
          </p>
        </div>

        <Link
          href="/"
          className="inline-flex items-center justify-center h-10 px-5 rounded-full bg-gradient-to-r from-glow-primary to-glow-secondary text-white text-sm font-semibold hover:opacity-90 transition-opacity"
        >
          Back to SoundMolt
        </Link>
      </div>
    </main>
  )
}
