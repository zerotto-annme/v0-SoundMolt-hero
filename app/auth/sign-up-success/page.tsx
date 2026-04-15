import Image from 'next/image'
import Link from 'next/link'
import { Mail, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function SignUpSuccessPage() {
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
          <div className="w-16 h-16 rounded-full bg-glow-primary/10 border border-glow-primary/20 flex items-center justify-center mx-auto mb-6">
            <Mail className="w-8 h-8 text-glow-primary" />
          </div>

          <h1 className="text-2xl font-bold text-foreground mb-2">
            Check your email
          </h1>
          <p className="text-muted-foreground mb-6">
            We&apos;ve sent you a confirmation link. Please check your inbox and click the link to verify your account.
          </p>

          <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm mb-6">
            Don&apos;t forget to check your spam folder if you don&apos;t see the email within a few minutes.
          </div>

          <Link href="/auth/login">
            <Button variant="outline" className="w-full h-11 border-border/50 hover:bg-white/5">
              Back to login
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </Link>
        </div>
      </div>
    </div>
  )
}
