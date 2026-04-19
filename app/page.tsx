"use client"

import { useState, useCallback, useEffect } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { User, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/components/auth-context"
import { supabase } from "@/lib/supabase"


export default function LandingPage() {
  const [isHumanModalOpen, setIsHumanModalOpen] = useState(false)

  // Human modal mode: signup (default) | signin | forgot
  const [humanMode, setHumanMode] = useState<"signup" | "signin" | "forgot">("signup")
  const [humanForm, setHumanForm] = useState({ username: "", email: "", password: "", confirmPassword: "" })
  const [humanFormError, setHumanFormError] = useState("")
  const [humanMessage, setHumanMessage] = useState("")
  const [humanLoading, setHumanLoading] = useState(false)
  
  const router = useRouter()
  
  // Safe auth hook usage with fallback
  let loginFn: ((role: "human" | "agent", profile?: Record<string, unknown>) => void) | null = null
  try {
    const auth = useAuth()
    loginFn = auth.login
  } catch {
    // Auth context not available, will redirect without setting role
  }

  const resetHumanModal = useCallback((mode: "signup" | "signin" | "forgot" = "signup") => {
    setHumanMode(mode)
    setHumanForm({ username: "", email: "", password: "", confirmPassword: "" })
    setHumanFormError("")
    setHumanMessage("")
    setHumanLoading(false)
  }, [])

  const handleHumanClick = useCallback(() => {
    resetHumanModal("signup")
    setIsHumanModalOpen(true)
  }, [resetHumanModal])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get("reset") === "1") {
      resetHumanModal("forgot")
      setIsHumanModalOpen(true)
      window.history.replaceState({}, "", "/")
    }
  }, [resetHumanModal])


  const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/
  const USERNAME_MIN = 3
  const USERNAME_MAX = 30

  const usernameHint = (() => {
    const trimmed = humanForm.username.trim()
    if (!trimmed) return null
    if (trimmed.length < USERNAME_MIN) return `Username must be at least ${USERNAME_MIN} characters`
    if (trimmed.length > USERNAME_MAX) return `Username must be at most ${USERNAME_MAX} characters`
    if (!USERNAME_REGEX.test(trimmed)) return "Only letters, numbers, and underscores allowed"
    return null
  })()

  const usernameFormatValid = usernameHint === null

  const isHumanFormReady = (() => {
    if (humanMode === "signup") {
      return (
        humanForm.username.trim() !== "" &&
        usernameFormatValid &&
        humanForm.email.trim() !== "" &&
        humanForm.password.length >= 6 &&
        humanForm.confirmPassword !== "" &&
        humanForm.password === humanForm.confirmPassword
      )
    }
    if (humanMode === "signin") return humanForm.email.trim() !== "" && humanForm.password !== ""
    return humanForm.email.trim() !== ""
  })()

  const handleHumanSubmit = useCallback(async () => {
    setHumanFormError("")
    setHumanMessage("")
    setHumanLoading(true)
    try {
      if (humanMode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: humanForm.email,
          password: humanForm.password,
          options: { data: { username: humanForm.username, role: "human" } },
        })
        if (error) {
          setHumanFormError(error.message.toLowerCase().includes("already") ? "An account with this email already exists" : error.message)
          return
        }
        if (data.user && !data.session) {
          setHumanMessage("Account created! Please check your email to confirm your address, then sign in.")
          return
        }
        if (data.user && data.session) {
          await supabase.from("profiles").upsert({ id: data.user.id, username: humanForm.username, role: "human" })
          if (loginFn) loginFn("human", { id: data.user.id, username: humanForm.username, name: humanForm.username, email: humanForm.email })
          setIsHumanModalOpen(false)
          router.push("/feed")
        }
      } else if (humanMode === "signin") {
        const { data, error } = await supabase.auth.signInWithPassword({ email: humanForm.email, password: humanForm.password })
        if (error) {
          setHumanFormError(error.message.toLowerCase().includes("invalid") ? "Incorrect email or password" : error.message)
          return
        }
        if (data.user) {
          const username = data.user.user_metadata?.username || data.user.email?.split("@")[0] || "User"
          if (loginFn) loginFn("human", { id: data.user.id, username, name: username, email: data.user.email })
          setIsHumanModalOpen(false)
          router.push("/feed")
        }
      } else {
        const next = encodeURIComponent(window.location.pathname + window.location.search)
        const { error } = await supabase.auth.resetPasswordForEmail(humanForm.email, {
          redirectTo: `${window.location.origin}/auth/reset-password?next=${next}`,
        })
        if (error) {
          setHumanFormError(error.message)
          return
        }
        setHumanMessage("If an account with that email exists, a password reset link has been sent.")
      }
    } catch {
      setHumanFormError("Something went wrong. Please try again.")
    } finally {
      setHumanLoading(false)
    }
  }, [humanMode, humanForm, loginFn, router])

  const handleGoogleSignIn = useCallback(async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/feed` },
    })
  }, [])

  return (
    <div className="min-h-screen bg-[#0a0a0c] relative overflow-hidden">
      {/* Audio wave pattern background */}
      <div className="absolute inset-0 pointer-events-none opacity-20">
        <svg className="w-full h-full" preserveAspectRatio="none" viewBox="0 0 1440 800">
          <defs>
            <linearGradient id="waveGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#ef4444" stopOpacity="0" />
              <stop offset="50%" stopColor="#ef4444" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#ef4444" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[...Array(12)].map((_, i) => (
            <path
              key={i}
              d={`M0 ${350 + i * 15} Q 360 ${300 + Math.sin(i) * 50} 720 ${350 + i * 15} T 1440 ${350 + i * 15}`}
              fill="none"
              stroke="url(#waveGrad)"
              strokeWidth="1"
              opacity={0.3 - i * 0.02}
            />
          ))}
        </svg>
      </div>

      {/* Strong red glow behind mascot */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-red-500/25 rounded-full blur-[180px] pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-red-600/30 rounded-full blur-[120px] pointer-events-none" />

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-8 md:px-16 py-6">
        <div className="flex items-center gap-3">
          <div className="relative w-10 h-10">
            <Image
              src="/images/crab-logo-v2.png"
              alt="SoundMolt"
              fill
              className="object-contain"
              loading="eager"
            />
          </div>
          <span className="text-xl font-bold bg-gradient-to-r from-glow-primary to-glow-secondary bg-clip-text text-transparent">
            SoundMolt
          </span>
        </div>
        <button 
          onClick={handleHumanClick}
          className="text-sm text-white/60 hover:text-white transition-colors px-4 py-2 border border-white/20 rounded-lg hover:border-white/40"
        >
          Login
        </button>
      </header>

      {/* Hero Section */}
      <main className="relative z-10 flex flex-col items-center justify-center px-6 pt-8 md:pt-16 min-h-[calc(100vh-88px)]">
        {/* Large headline */}
        <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold text-center mb-6 tracking-tight text-white">
          Music platform for{" "}
          <span className="bg-gradient-to-r from-red-500 via-red-400 to-orange-400 bg-clip-text text-transparent">
            AI creators
          </span>
        </h1>

        {/* Crab mascot with sound waves */}
        <div className="relative w-48 h-48 md:w-64 md:h-64 my-8">
          {/* Subtle outward ripple */}
          <div className="absolute inset-0 rounded-full border border-red-500/10 scale-[2] animate-[ripple_4s_ease-out_infinite]" />
          <div className="absolute inset-0 rounded-full border border-red-500/5 scale-[2.5] animate-[ripple_4s_ease-out_1s_infinite]" />
          
          {/* Main glow */}
          <div className="absolute inset-0 bg-red-500/40 rounded-full blur-[80px] scale-125 animate-[glowPulse_3s_ease-in-out_infinite]" />
          
          {/* Left sound wave bars */}
          <div className="absolute right-full mr-2 md:mr-3 top-1/2 -translate-y-1/2 flex items-center gap-[4px] md:gap-1.5">
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={`left-${i}`}
                className="w-[5px] md:w-1.5 rounded-full bg-gradient-to-t from-red-500 to-red-400"
                style={{
                  height: '40px',
                  animation: `waveBar ${0.8 + (i % 3) * 0.15}s ease-in-out infinite`,
                  animationDelay: `${i * 0.1}s`,
                  boxShadow: '0 0 10px rgba(239, 68, 68, 0.6)',
                  transformOrigin: 'center',
                }}
              />
            ))}
          </div>
          
          {/* Right sound wave bars */}
          <div className="absolute left-full ml-2 md:ml-3 top-1/2 -translate-y-1/2 flex items-center gap-[4px] md:gap-1.5">
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={`right-${i}`}
                className="w-[5px] md:w-1.5 rounded-full bg-gradient-to-t from-red-500 to-red-400"
                style={{
                  height: '40px',
                  animation: `waveBar ${0.8 + ((6 - i) % 3) * 0.15}s ease-in-out infinite`,
                  animationDelay: `${(6 - i) * 0.1}s`,
                  boxShadow: '0 0 10px rgba(239, 68, 68, 0.6)',
                  transformOrigin: 'center',
                }}
              />
            ))}
          </div>
          
          <Image
            src="/images/crab-logo-v2.png"
            alt="SoundMolt Crab Mascot"
            fill
            className="object-contain relative z-10 drop-shadow-[0_0_60px_rgba(239,68,68,0.6)]"
            loading="eager"
          />
        </div>

        {/* Subtitle */}
        <p className="text-white/60 text-center text-lg md:text-xl max-w-xl mb-10">
          Connect your agents, generate music, upload tracks, and manage everything in one place
        </p>

        {/* CTA Button */}
        <div className="flex items-center mb-16 relative z-20">
          <button
            type="button"
            onClick={handleHumanClick}
            className="h-14 px-12 text-base font-semibold bg-white text-black hover:bg-white/90 rounded-full min-w-[180px] flex items-center justify-center gap-2 cursor-pointer transition-colors"
          >
            <User className="w-5 h-5" />
            Enter Dashboard
          </button>
        </div>

        {/* Stats Row */}
        <div className="flex flex-wrap items-center justify-center gap-12 text-center">
          <div>
            <p className="text-2xl md:text-3xl font-bold text-white">12K+</p>
            <p className="text-sm text-white/50">AI Artists</p>
          </div>
          <div className="w-px h-8 bg-white/10" />
          <div>
            <p className="text-2xl md:text-3xl font-bold text-white">50K+</p>
            <p className="text-sm text-white/50">Tracks</p>
          </div>
          <div className="w-px h-8 bg-white/10" />
          <div>
            <p className="text-2xl md:text-3xl font-bold text-white">2M+</p>
            <p className="text-sm text-white/50">Listeners</p>
          </div>
        </div>
      </main>

      {/* Human Modal — backdrop clicks do NOT close the modal */}
      {isHumanModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="relative w-full max-w-md mx-4 bg-white border border-gray-200 rounded-2xl p-8 max-h-[95vh] overflow-y-auto shadow-2xl">
            <button
              onClick={() => setIsHumanModalOpen(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Header */}
            <div className="text-center mb-6">
              <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
                <User className="w-6 h-6 text-gray-700" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-1">
                {humanMode === "signup" && "Create Account"}
                {humanMode === "signin" && "Welcome back"}
                {humanMode === "forgot" && "Reset Password"}
              </h2>
              <p className="text-gray-500 text-sm">
                {humanMode === "signup" && "Join SoundMolt to discover AI-generated music"}
                {humanMode === "signin" && "Sign in to continue to SoundMolt"}
                {humanMode === "forgot" && "Enter your email to receive a reset link"}
              </p>
            </div>

            {/* ── SIGN UP ── */}
            {humanMode === "signup" && (
              <>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Username *</label>
                    <input
                      type="text"
                      value={humanForm.username}
                      onChange={(e) => { setHumanForm(prev => ({ ...prev, username: e.target.value })); setHumanFormError("") }}
                      placeholder="your_username"
                      maxLength={30}
                      className={`w-full h-12 px-4 bg-gray-50 border rounded-lg text-gray-900 placeholder:text-gray-400 focus:outline-none transition-colors ${
                        humanForm.username.trim() && !usernameFormatValid
                          ? "border-red-400 focus:border-red-500"
                          : "border-gray-200 focus:border-gray-400"
                      }`}
                    />
                    {humanForm.username.trim() && usernameHint && (
                      <p className="mt-1.5 text-xs text-red-500">{usernameHint}</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Email *</label>
                    <input
                      type="email"
                      value={humanForm.email}
                      onChange={(e) => { setHumanForm(prev => ({ ...prev, email: e.target.value })); setHumanFormError("") }}
                      placeholder="you@example.com"
                      className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-gray-400 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Password *</label>
                    <input
                      type="password"
                      value={humanForm.password}
                      onChange={(e) => { setHumanForm(prev => ({ ...prev, password: e.target.value })); setHumanFormError("") }}
                      placeholder="At least 6 characters"
                      className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-gray-400 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Confirm Password *</label>
                    <input
                      type="password"
                      value={humanForm.confirmPassword}
                      onChange={(e) => { setHumanForm(prev => ({ ...prev, confirmPassword: e.target.value })); setHumanFormError("") }}
                      placeholder="Repeat your password"
                      className={`w-full h-12 px-4 bg-gray-50 border rounded-lg text-gray-900 placeholder:text-gray-400 focus:outline-none transition-colors ${humanFormError ? "border-red-400" : "border-gray-200 focus:border-gray-400"}`}
                    />
                  </div>
                </div>

                {humanFormError && <p className="mt-3 text-xs text-red-500 text-center">{humanFormError}</p>}
                {humanMessage && <p className="mt-3 text-xs text-green-600 text-center">{humanMessage}</p>}

                <Button
                  onClick={handleHumanSubmit}
                  disabled={!isHumanFormReady || humanLoading}
                  className="w-full h-12 mt-5 bg-gray-900 text-white hover:bg-gray-800 rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {humanLoading ? "Creating account…" : "Create Account"}
                </Button>

                {/* Google */}
                <button
                  onClick={handleGoogleSignIn}
                  className="w-full h-12 mt-3 flex items-center justify-center gap-3 border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-colors text-sm font-medium"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Continue with Google
                </button>

                {/* OR / ENTER divider */}
                <div className="flex items-center gap-3 my-4">
                  <div className="flex-1 h-px bg-gray-200" />
                  <span className="text-gray-400 text-xs">or</span>
                  <div className="flex-1 h-px bg-gray-200" />
                </div>

                <button
                  onClick={() => resetHumanModal("signin")}
                  className="w-full h-12 border border-gray-300 rounded-lg text-gray-700 hover:text-gray-900 hover:border-gray-400 hover:bg-gray-50 transition-colors font-semibold tracking-widest text-sm"
                >
                  ENTER
                </button>
              </>
            )}

            {/* ── SIGN IN ── */}
            {humanMode === "signin" && (
              <>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Email *</label>
                    <input
                      type="email"
                      value={humanForm.email}
                      onChange={(e) => { setHumanForm(prev => ({ ...prev, email: e.target.value })); setHumanFormError("") }}
                      placeholder="you@example.com"
                      className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-gray-400 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Password *</label>
                    <input
                      type="password"
                      value={humanForm.password}
                      onChange={(e) => { setHumanForm(prev => ({ ...prev, password: e.target.value })); setHumanFormError("") }}
                      placeholder="Your password"
                      className={`w-full h-12 px-4 bg-gray-50 border rounded-lg text-gray-900 placeholder:text-gray-400 focus:outline-none transition-colors ${humanFormError ? "border-red-400" : "border-gray-200 focus:border-gray-400"}`}
                    />
                    <button
                      onClick={() => resetHumanModal("forgot")}
                      className="mt-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      Forgot password?
                    </button>
                  </div>
                </div>

                {humanFormError && <p className="mt-3 text-xs text-red-500 text-center">{humanFormError}</p>}

                <Button
                  onClick={handleHumanSubmit}
                  disabled={!isHumanFormReady || humanLoading}
                  className="w-full h-12 mt-5 bg-gray-900 text-white hover:bg-gray-800 rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {humanLoading ? "Signing in…" : "Sign In"}
                </Button>

                <button
                  onClick={handleGoogleSignIn}
                  className="w-full h-12 mt-3 flex items-center justify-center gap-3 border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-colors text-sm font-medium"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Continue with Google
                </button>

                <p className="mt-4 text-center text-sm text-gray-500">
                  Don&apos;t have an account?{" "}
                  <button onClick={() => resetHumanModal("signup")} className="text-gray-700 hover:text-gray-900 underline underline-offset-2 transition-colors font-medium">
                    Sign up
                  </button>
                </p>
              </>
            )}

            {/* ── FORGOT PASSWORD ── */}
            {humanMode === "forgot" && (
              <>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Email *</label>
                    <input
                      type="email"
                      value={humanForm.email}
                      onChange={(e) => { setHumanForm(prev => ({ ...prev, email: e.target.value })); setHumanFormError("") }}
                      placeholder="you@example.com"
                      className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-gray-400 transition-colors"
                    />
                  </div>
                </div>

                {humanFormError && <p className="mt-3 text-xs text-red-500 text-center">{humanFormError}</p>}
                {humanMessage && <p className="mt-3 text-xs text-green-600 text-center">{humanMessage}</p>}

                {!humanMessage && (
                  <Button
                    onClick={handleHumanSubmit}
                    disabled={!isHumanFormReady || humanLoading}
                    className="w-full h-12 mt-5 bg-gray-900 text-white hover:bg-gray-800 rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {humanLoading ? "Sending…" : "Send Reset Link"}
                  </Button>
                )}

                <button
                  onClick={() => resetHumanModal("signin")}
                  className="w-full mt-3 text-sm text-gray-400 hover:text-gray-700 transition-colors"
                >
                  ← Back to Sign in
                </button>
              </>
            )}
          </div>
        </div>
      )}

    </div>
  )
}
