"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { supabase } from "@/lib/supabase"

export default function AuthCallbackPage() {
  const router = useRouter()
  const [status, setStatus] = useState<"loading" | "error">("loading")
  const [errorMsg, setErrorMsg] = useState("")

  useEffect(() => {
    // --- 1. Fast-fail on provider-side errors in the URL ---
    const params = new URLSearchParams(window.location.search)
    const hashParams = new URLSearchParams(window.location.hash.replace("#", "?"))

    const urlError = params.get("error") || hashParams.get("error")
    const urlErrorDesc = params.get("error_description") || hashParams.get("error_description")
    if (urlError) {
      console.error("[callback] OAuth provider error:", urlError, urlErrorDesc)
      setErrorMsg(urlErrorDesc || urlError)
      setStatus("error")
      return
    }

    console.log("[callback] Handling OAuth callback — waiting for session")

    let redirected = false

    // --- 2. Primary: listen for SIGNED_IN / INITIAL_SESSION with a session.
    //         Supabase's detectSessionInUrl processes the implicit-flow hash
    //         (access_token) or PKCE code automatically and fires this event.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log("[callback] onAuthStateChange:", event, "session:", !!session, "user:", session?.user?.id ?? null)

      if (redirected) return

      if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && session?.user) {
        redirected = true
        subscription.unsubscribe()
        clearTimeout(fallbackTimer)
        console.log("[callback] Session established via", event, "— redirecting to /feed")
        router.replace("/feed")
        return
      }

      // INITIAL_SESSION with no session means the auto-exchange hasn't finished
      // yet (or there really is no session). We keep waiting for SIGNED_IN.
      if (event === "INITIAL_SESSION" && !session) {
        console.log("[callback] INITIAL_SESSION has no session yet — waiting for SIGNED_IN")
      }
    })

    // --- 3. Fallback: if SIGNED_IN never fires within 8 seconds, try
    //         exchanging a PKCE code manually (covers edge-cases where
    //         detectSessionInUrl didn't handle it), then check getSession().
    const fallbackTimer = setTimeout(async () => {
      if (redirected) return
      console.warn("[callback] Fallback timer fired — checking session directly")

      // Try PKCE manual exchange if there is a code in the URL
      const code = params.get("code")
      if (code) {
        console.log("[callback] Attempting manual PKCE code exchange")
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
        if (exchangeError) {
          console.warn("[callback] Manual exchange failed:", exchangeError.message)
        } else {
          console.log("[callback] Manual exchange succeeded")
        }
      }

      const { data, error: sessionError } = await supabase.auth.getSession()
      console.log("[callback] Fallback getSession:", !!data?.session, sessionError?.message)

      if (data?.session) {
        redirected = true
        subscription.unsubscribe()
        console.log("[callback] Fallback session found — redirecting to /feed")
        router.replace("/feed")
      } else {
        subscription.unsubscribe()
        console.error("[callback] No session after fallback:", sessionError?.message)
        setErrorMsg(sessionError?.message || "Could not establish session. Please try again.")
        setStatus("error")
      }
    }, 8000)

    return () => {
      clearTimeout(fallbackTimer)
      subscription.unsubscribe()
    }
  }, [router])

  return (
    <div className="min-h-screen bg-[#0a0a0c] flex flex-col items-center justify-center p-4">
      <div className="flex items-center gap-3 mb-10">
        <div className="relative w-10 h-10">
          <Image src="/images/crab-logo-v2.png" alt="SoundMolt" fill className="object-contain" />
        </div>
        <span className="text-xl font-bold bg-gradient-to-r from-red-500 via-red-400 to-orange-400 bg-clip-text text-transparent">
          SoundMolt
        </span>
      </div>

      {status === "loading" && (
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-full border-2 border-white/10 border-t-red-500 animate-spin" />
          <p className="text-white/60 text-sm">Signing you in…</p>
        </div>
      )}

      {status === "error" && (
        <div className="w-full max-w-sm bg-white/5 border border-white/10 rounded-2xl p-6 text-center space-y-4">
          <p className="text-red-400 font-semibold">Sign-in failed</p>
          <p className="text-white/50 text-sm">{errorMsg}</p>
          <button
            onClick={() => router.replace("/")}
            className="w-full h-10 bg-white/10 hover:bg-white/20 rounded-lg text-white text-sm font-medium transition-colors"
          >
            Back to home
          </button>
        </div>
      )}
    </div>
  )
}
