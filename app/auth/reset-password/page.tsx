"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { Lock } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function ResetPasswordPage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [linkError, setLinkError] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [apiError, setApiError] = useState("")
  const [message, setMessage] = useState("")
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const hash = window.location.hash
    if (hash) {
      const params = new URLSearchParams(hash.slice(1))
      const error = params.get("error")
      if (error) {
        setLinkError("This reset link has expired or is invalid. Please request a new one.")
        return
      }
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        setReady(true)
      } else if (event === "SIGNED_OUT" && !session) {
        setLinkError("This reset link has expired or is invalid. Please request a new one.")
      }
    })
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  const passwordTooShort = password.length > 0 && password.length < 6
  const passwordsMismatch = confirmPassword.length > 0 && password !== confirmPassword
  const isValid = password.length >= 6 && password === confirmPassword

  const handleSubmit = async () => {
    if (!isValid) return
    setApiError("")
    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (error) {
      setApiError(error.message)
      return
    }
    setMessage("Password updated successfully! Redirecting…")
    setTimeout(() => router.push("/"), 2000)
  }

  return (
    <div className="min-h-screen bg-[#0a0a0c] flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-[#111113] border border-white/10 rounded-2xl p-8">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center mx-auto mb-4">
            <Lock className="w-6 h-6 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Set New Password</h2>
          <p className="text-white/50 text-sm">Choose a strong password for your account</p>
        </div>

        {linkError ? (
          <div className="text-center space-y-4">
            <p className="text-red-400 text-sm">{linkError}</p>
            <Button
              onClick={() => router.push("/")}
              className="w-full h-12 bg-white text-black hover:bg-white/90 rounded-lg font-semibold"
            >
              Request a new reset link
            </Button>
          </div>
        ) : !ready ? (
          <p className="text-center text-white/50 text-sm">Verifying your reset link…</p>
        ) : message ? (
          <p className="text-center text-green-400 text-sm">{message}</p>
        ) : (
          <>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-white/60 mb-2">New Password *</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setApiError("") }}
                  placeholder="At least 6 characters"
                  className={`w-full h-12 px-4 bg-white/5 border rounded-lg text-white placeholder:text-white/30 focus:outline-none transition-colors ${passwordTooShort ? "border-red-500/60" : "border-white/10 focus:border-white/30"}`}
                />
                {passwordTooShort && (
                  <p className="mt-1 text-xs text-red-400">Password must be at least 6 characters</p>
                )}
              </div>
              <div>
                <label className="block text-sm text-white/60 mb-2">Confirm New Password *</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => { setConfirmPassword(e.target.value); setApiError("") }}
                  placeholder="Repeat new password"
                  className={`w-full h-12 px-4 bg-white/5 border rounded-lg text-white placeholder:text-white/30 focus:outline-none transition-colors ${passwordsMismatch ? "border-red-500/60" : "border-white/10 focus:border-white/30"}`}
                />
                {passwordsMismatch && (
                  <p className="mt-1 text-xs text-red-400">Passwords do not match</p>
                )}
              </div>
            </div>

            {apiError && <p className="mt-3 text-xs text-red-400 text-center">{apiError}</p>}

            <Button
              onClick={handleSubmit}
              disabled={!isValid || loading}
              className="w-full h-12 mt-6 bg-white text-black hover:bg-white/90 rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Updating…" : "Update Password"}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
