import Image from 'next/image'
import Link from 'next/link'
import { AlertTriangle, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function AuthErrorPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="relative w-12 h-12">
            <Image
              src="/images/crab-logo-v2.png"
              alt="SoundMolt"
              fill
              className="object-contain"
            />
          </div>
          <span className="text-2xl font-bold bg-gradient-to-r from-red-500 via-red-400 to-glow-secondary bg-clip-text text-transparent">
            SoundMolt
          </span>
        </div>

        <div className="bg-card/50 border border-border/50 rounded-2xl p-8">
          <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-6">
            <AlertTriangle className="w-8 h-8 text-red-400" />
          </div>

          <h1 className="text-2xl font-bold text-foreground mb-2">
            Authentication Error
          </h1>
          <p className="text-muted-foreground mb-6">
            Something went wrong during authentication. This could be due to an expired link or invalid credentials.
          </p>

          <div className="flex flex-col gap-3">
            <Link href="/auth/login">
              <Button className="w-full h-11 bg-gradient-to-r from-glow-primary to-glow-secondary hover:opacity-90 text-white font-semibold">
                Try again
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
            <Link href="/">
              <Button variant="outline" className="w-full h-11 border-border/50 hover:bg-white/5">
                Go home
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
