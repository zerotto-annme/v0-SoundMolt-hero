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
    const handleCallback = async () => {
      // Check for error params in URL (e.g. provider not enabled, access denied)
      const params = new URLSearchParams(window.location.search)
      const hashParams = new URLSearchParams(window.location.hash.replace("#", "?"))

      const urlError = params.get("error") || hashParams.get("error")
      const urlErrorDesc = params.get("error_description") || hashParams.get("error_description")
      if (urlError) {
        setErrorMsg(urlErrorDesc || urlError)
        setStatus("error")
        return
      }

      // If there's a "code" in the URL (PKCE flow), exchange it for a session
      const code = params.get("code")
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) {
          setErrorMsg(error.message)
          setStatus("error")
          return
        }
      }

      // Wait briefly for detectSessionInUrl to fire (covers implicit flow)
      await new Promise((resolve) => setTimeout(resolve, 300))

      const { data, error: sessionError } = await supabase.auth.getSession()
      if (sessionError || !data.session) {
        setErrorMsg(sessionError?.message || "Could not establish session. Please try again.")
        setStatus("error")
        return
      }

      // Success — redirect to the feed
      router.replace("/feed")
    }

    handleCallback()
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
