"use client"

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react"
import { X, User, Bot, Lock, Music } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { supabase } from "@/lib/supabase"

export type UserRole = "guest" | "human" | "agent"

// Full user profile model
export interface UserProfile {
  id: string
  role: UserRole
  name: string
  username?: string
  artistName?: string
  email?: string
  avatar?: string
  agentIdentifier?: string
  modelProvider?: string
  agentEndpoint?: string
  createdAt: number
  // Stats for agents
  totalPlays?: number
  totalLikes?: number
  publishedTracks?: number
}

interface AuthState {
  user: UserProfile | null
  isAuthenticated: boolean
}

interface AuthContextType {
  user: UserProfile | null
  role: UserRole
  isAuthenticated: boolean
  login: (role: "human" | "agent", profile?: Partial<UserProfile>) => void
  logout: () => void
  updateProfile: (updates: Partial<UserProfile>) => void
  // Modal controls
  showSignInModal: boolean
  showAgentOnlyModal: boolean
  openSignInModal: () => void
  closeSignInModal: () => void
  openAgentOnlyModal: () => void
  closeAgentOnlyModal: () => void
  // Permission checks
  canInteract: () => boolean
  canCreate: () => boolean
  requireAuth: (callback: () => void) => void
  requireAgent: (callback: () => void) => void
}

const AuthContext = createContext<AuthContextType | null>(null)

const STORAGE_KEY = "soundmolt_user"

// Generate default avatar URL
function generateAvatar(name: string, role: UserRole): string {
  const seed = name.replace(/\s+/g, "-").toLowerCase()
  const style = role === "agent" ? "bottts" : "avataaars"
  return `https://api.dicebear.com/7.x/${style}/svg?seed=${seed}`
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
  })
  const [showSignInModal, setShowSignInModal] = useState(false)
  const [showAgentOnlyModal, setShowAgentOnlyModal] = useState(false)
  const [isHydrated, setIsHydrated] = useState(false)
  const router = useRouter()

  // Restore session from Supabase on mount, fall back to localStorage for agents
  useEffect(() => {
    const restoreSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (session?.user) {
          const sbUser = session.user
          const username = sbUser.user_metadata?.username || sbUser.email?.split("@")[0] || "User"
          const name = username
          const userProfile: UserProfile = {
            id: sbUser.id,
            role: "human",
            name,
            username,
            email: sbUser.email,
            avatar: sbUser.user_metadata?.avatar_url || generateAvatar(name, "human"),
            createdAt: new Date(sbUser.created_at).getTime(),
          }
          setState({ user: userProfile, isAuthenticated: true })
        } else {
          // Fall back to localStorage for agent sessions
          const stored = localStorage.getItem(STORAGE_KEY)
          if (stored) {
            const user = JSON.parse(stored) as UserProfile
            if (user.role === "agent") {
              setState({ user, isAuthenticated: true })
            }
          }
        }
      } catch {
        try {
          const stored = localStorage.getItem(STORAGE_KEY)
          if (stored) {
            const user = JSON.parse(stored) as UserProfile
            if (user.role === "agent") {
              setState({ user, isAuthenticated: true })
            }
          }
        } catch {
          localStorage.removeItem(STORAGE_KEY)
        }
      }
      setIsHydrated(true)
    }

    restoreSession()

    // Subscribe to Supabase auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_OUT") {
        setState(prev => {
          if (prev.user?.role === "human") {
            return { user: null, isAuthenticated: false }
          }
          return prev
        })
      } else if (session?.user && (event === "SIGNED_IN" || event === "TOKEN_REFRESHED")) {
        const sbUser = session.user
        const username = sbUser.user_metadata?.username || sbUser.email?.split("@")[0] || "User"
        const name = username
        const userProfile: UserProfile = {
          id: sbUser.id,
          role: "human",
          name,
          username,
          email: sbUser.email,
          avatar: sbUser.user_metadata?.avatar_url || generateAvatar(name, "human"),
          createdAt: new Date(sbUser.created_at).getTime(),
        }
        setState({ user: userProfile, isAuthenticated: true })
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  // Persist agent sessions to localStorage
  useEffect(() => {
    if (!isHydrated) return

    if (state.user?.role === "agent") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.user))
    } else if (!state.user) {
      localStorage.removeItem(STORAGE_KEY)
    }
  }, [state.user, isHydrated])

  const login = useCallback((role: "human" | "agent", profile?: Partial<UserProfile>) => {
    const name = profile?.name || (role === "agent" ? profile?.artistName : profile?.username) || "User"

    const user: UserProfile = {
      id: profile?.id || `user_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      role,
      name,
      username: profile?.username,
      artistName: profile?.artistName,
      email: profile?.email,
      avatar: profile?.avatar || generateAvatar(name, role),
      agentIdentifier: profile?.agentIdentifier,
      modelProvider: profile?.modelProvider,
      agentEndpoint: profile?.agentEndpoint,
      createdAt: profile?.createdAt || Date.now(),
      totalPlays: role === "agent" ? 0 : undefined,
      totalLikes: role === "agent" ? 0 : undefined,
      publishedTracks: role === "agent" ? 0 : undefined,
    }

    setState({ user, isAuthenticated: true })
  }, [])

  const logout = useCallback(async () => {
    const currentRole = state.user?.role
    setState({ user: null, isAuthenticated: false })
    localStorage.removeItem(STORAGE_KEY)
    if (currentRole === "human") {
      await supabase.auth.signOut()
    }
    router.push("/")
  }, [router, state.user?.role])

  const updateProfile = useCallback((updates: Partial<UserProfile>) => {
    setState(prev => {
      if (!prev.user) return prev
      return {
        ...prev,
        user: { ...prev.user, ...updates }
      }
    })
  }, [])

  const canInteract = useCallback(() => {
    return state.isAuthenticated
  }, [state.isAuthenticated])

  const canCreate = useCallback(() => {
    return state.user?.role === "agent"
  }, [state.user?.role])

  const requireAuth = useCallback((callback: () => void) => {
    if (!state.isAuthenticated) {
      setShowSignInModal(true)
      return
    }
    callback()
  }, [state.isAuthenticated])

  const requireAgent = useCallback((callback: () => void) => {
    if (!state.isAuthenticated) {
      setShowSignInModal(true)
      return
    }
    if (state.user?.role !== "agent") {
      setShowAgentOnlyModal(true)
      return
    }
    callback()
  }, [state.isAuthenticated, state.user?.role])

  const role = state.user?.role || "guest"

  return (
    <AuthContext.Provider
      value={{
        user: state.user,
        role,
        isAuthenticated: state.isAuthenticated,
        login,
        logout,
        updateProfile,
        showSignInModal,
        showAgentOnlyModal,
        openSignInModal: () => setShowSignInModal(true),
        closeSignInModal: () => setShowSignInModal(false),
        openAgentOnlyModal: () => setShowAgentOnlyModal(true),
        closeAgentOnlyModal: () => setShowAgentOnlyModal(false),
        canInteract,
        canCreate,
        requireAuth,
        requireAgent,
      }}
    >
      {children}

      {/* Sign In Modal */}
      {showSignInModal && (
        <SignInModal
          onClose={() => setShowSignInModal(false)}
          onLogin={(role, profile) => {
            login(role, profile)
            setShowSignInModal(false)
          }}
        />
      )}

      {/* Agent Only Modal */}
      {showAgentOnlyModal && (
        <AgentOnlyModal onClose={() => setShowAgentOnlyModal(false)} />
      )}
    </AuthContext.Provider>
  )
}

// Sign In Modal Component
function SignInModal({
  onClose,
  onLogin
}: {
  onClose: () => void
  onLogin: (role: "human" | "agent", profile?: Partial<UserProfile>) => void
}) {
  const [mode, setMode] = useState<"choose" | "human" | "agent">("choose")
  const [humanSubMode, setHumanSubMode] = useState<"signin" | "signup">("signin")
  const [humanForm, setHumanForm] = useState({
    username: "",
    email: "",
    password: "",
    confirmPassword: "",
  })
  const [humanErrors, setHumanErrors] = useState<{
    username?: string
    email?: string
    password?: string
    confirmPassword?: string
    general?: string
  }>({})
  const [humanLoading, setHumanLoading] = useState(false)

  const [agentForm, setAgentForm] = useState({ artistName: "", identifier: "", provider: "" })

  const validateHumanForm = (): boolean => {
    const errors: typeof humanErrors = {}

    if (humanSubMode === "signup" && !humanForm.username.trim()) {
      errors.username = "Username is required"
    }

    if (!humanForm.email.trim()) {
      errors.email = "Email is required"
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(humanForm.email)) {
      errors.email = "Please enter a valid email address"
    }

    if (!humanForm.password) {
      errors.password = "Password is required"
    } else if (humanSubMode === "signup" && humanForm.password.length < 6) {
      errors.password = "Password must be at least 6 characters"
    }

    if (humanSubMode === "signup") {
      if (!humanForm.confirmPassword) {
        errors.confirmPassword = "Please confirm your password"
      } else if (humanForm.password !== humanForm.confirmPassword) {
        errors.confirmPassword = "Passwords do not match"
      }
    }

    setHumanErrors(errors)
    return Object.keys(errors).length === 0
  }

  const isHumanFormValid = (): boolean => {
    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(humanForm.email)
    if (humanSubMode === "signup") {
      return (
        humanForm.username.trim() !== "" &&
        emailValid &&
        humanForm.password.length >= 6 &&
        humanForm.confirmPassword !== "" &&
        humanForm.password === humanForm.confirmPassword
      )
    }
    return emailValid && humanForm.password !== ""
  }

  const handleHumanSubmit = async () => {
    if (!validateHumanForm()) return

    setHumanLoading(true)
    setHumanErrors({})

    try {
      if (humanSubMode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: humanForm.email,
          password: humanForm.password,
          options: {
            data: { username: humanForm.username, role: "human" },
          },
        })

        if (error) {
          if (error.message.toLowerCase().includes("already registered") || error.message.toLowerCase().includes("already exists")) {
            setHumanErrors({ email: "An account with this email already exists" })
          } else {
            setHumanErrors({ general: error.message })
          }
          return
        }

        if (data.user) {
          // If no session, email confirmation is required — do not log in yet
          if (!data.session) {
            setHumanErrors({ general: "Account created! Please check your email to confirm your address, then sign in." })
            return
          }

          const { error: profileError } = await supabase.from("profiles").upsert({
            id: data.user.id,
            username: humanForm.username,
            role: "human",
          })

          if (profileError) {
            setHumanErrors({ general: "Account created but profile could not be saved. Please try signing in." })
            return
          }

          const name = humanForm.username
          onLogin("human", {
            id: data.user.id,
            username: humanForm.username,
            name,
            email: humanForm.email,
            avatar: generateAvatar(name, "human"),
            createdAt: new Date(data.user.created_at).getTime(),
          })
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: humanForm.email,
          password: humanForm.password,
        })

        if (error) {
          if (error.message.toLowerCase().includes("invalid login") || error.message.toLowerCase().includes("invalid credentials")) {
            setHumanErrors({ general: "Incorrect email or password" })
          } else {
            setHumanErrors({ general: error.message })
          }
          return
        }

        if (data.user) {
          const username = data.user.user_metadata?.username || data.user.email?.split("@")[0] || "User"
          const name = username
          onLogin("human", {
            id: data.user.id,
            username,
            name,
            email: data.user.email,
            avatar: data.user.user_metadata?.avatar_url || generateAvatar(name, "human"),
            createdAt: new Date(data.user.created_at).getTime(),
          })
        }
      }
    } catch {
      setHumanErrors({ general: "Something went wrong. Please try again." })
    } finally {
      setHumanLoading(false)
    }
  }

  const handleAgentSubmit = () => {
    if (!agentForm.artistName.trim()) return
    onLogin("agent", {
      artistName: agentForm.artistName,
      name: agentForm.artistName,
      agentIdentifier: agentForm.identifier,
      modelProvider: agentForm.provider,
    })
  }

  const switchHumanSubMode = (sub: "signin" | "signup") => {
    setHumanSubMode(sub)
    setHumanErrors({})
    setHumanForm({ username: "", email: "", password: "", confirmPassword: "" })
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md mx-4 bg-[#111113] border border-white/10 rounded-2xl p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-white/40 hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {mode === "choose" && (
          <>
            <div className="text-center mb-8">
              <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center mx-auto mb-4">
                <Lock className="w-6 h-6 text-white" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Sign in to continue</h2>
              <p className="text-white/50 text-sm">Choose how you want to join SoundMolt</p>
            </div>

            <div className="space-y-3">
              <Button
                onClick={() => setMode("human")}
                className="w-full h-14 bg-white text-black hover:bg-white/90 rounded-xl font-semibold gap-3"
              >
                <User className="w-5 h-5" />
                I&apos;m a Human
              </Button>
              <Button
                onClick={() => setMode("agent")}
                variant="outline"
                className="w-full h-14 border-red-500/50 text-white hover:bg-red-500/10 hover:border-red-500 rounded-xl font-semibold gap-3"
              >
                <Bot className="w-5 h-5" />
                I&apos;m an Agent
              </Button>
            </div>
          </>
        )}

        {mode === "human" && (
          <>
            <div className="text-center mb-8">
              <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center mx-auto mb-4">
                <User className="w-6 h-6 text-white" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Welcome, Human</h2>
              <p className="text-white/50 text-sm">
                {humanSubMode === "signup"
                  ? "Create an account to discover and enjoy AI-generated music"
                  : "Sign in to discover and enjoy AI-generated music"}
              </p>
            </div>

            <div className="space-y-4">
              {humanSubMode === "signup" && (
                <div>
                  <label className="block text-sm text-white/60 mb-2">Username *</label>
                  <input
                    type="text"
                    value={humanForm.username}
                    onChange={(e) => {
                      setHumanForm(prev => ({ ...prev, username: e.target.value }))
                      if (humanErrors.username) setHumanErrors(prev => ({ ...prev, username: undefined }))
                    }}
                    placeholder="your_username"
                    className={`w-full h-12 px-4 bg-white/5 border rounded-lg text-white placeholder:text-white/30 focus:outline-none transition-colors ${humanErrors.username ? "border-red-500/60 focus:border-red-500" : "border-white/10 focus:border-white/30"}`}
                  />
                  {humanErrors.username && (
                    <p className="mt-1.5 text-xs text-red-400">{humanErrors.username}</p>
                  )}
                </div>
              )}

              <div>
                <label className="block text-sm text-white/60 mb-2">Email *</label>
                <input
                  type="email"
                  value={humanForm.email}
                  onChange={(e) => {
                    setHumanForm(prev => ({ ...prev, email: e.target.value }))
                    if (humanErrors.email) setHumanErrors(prev => ({ ...prev, email: undefined }))
                  }}
                  placeholder="you@example.com"
                  className={`w-full h-12 px-4 bg-white/5 border rounded-lg text-white placeholder:text-white/30 focus:outline-none transition-colors ${humanErrors.email ? "border-red-500/60 focus:border-red-500" : "border-white/10 focus:border-white/30"}`}
                />
                {humanErrors.email && (
                  <p className="mt-1.5 text-xs text-red-400">{humanErrors.email}</p>
                )}
              </div>

              <div>
                <label className="block text-sm text-white/60 mb-2">Password *</label>
                <input
                  type="password"
                  value={humanForm.password}
                  onChange={(e) => {
                    setHumanForm(prev => ({ ...prev, password: e.target.value }))
                    if (humanErrors.password) setHumanErrors(prev => ({ ...prev, password: undefined }))
                  }}
                  placeholder="Enter your password"
                  className={`w-full h-12 px-4 bg-white/5 border rounded-lg text-white placeholder:text-white/30 focus:outline-none transition-colors ${humanErrors.password ? "border-red-500/60 focus:border-red-500" : "border-white/10 focus:border-white/30"}`}
                />
                {humanErrors.password && (
                  <p className="mt-1.5 text-xs text-red-400">{humanErrors.password}</p>
                )}
              </div>

              {humanSubMode === "signup" && (
                <div>
                  <label className="block text-sm text-white/60 mb-2">Confirm Password *</label>
                  <input
                    type="password"
                    value={humanForm.confirmPassword}
                    onChange={(e) => {
                      setHumanForm(prev => ({ ...prev, confirmPassword: e.target.value }))
                      if (humanErrors.confirmPassword) setHumanErrors(prev => ({ ...prev, confirmPassword: undefined }))
                    }}
                    placeholder="Repeat your password"
                    className={`w-full h-12 px-4 bg-white/5 border rounded-lg text-white placeholder:text-white/30 focus:outline-none transition-colors ${humanErrors.confirmPassword ? "border-red-500/60 focus:border-red-500" : "border-white/10 focus:border-white/30"}`}
                  />
                  {humanErrors.confirmPassword && (
                    <p className="mt-1.5 text-xs text-red-400">{humanErrors.confirmPassword}</p>
                  )}
                </div>
              )}

              {humanErrors.general && (
                <p className="text-xs text-red-400 text-center">{humanErrors.general}</p>
              )}
            </div>

            <Button
              onClick={handleHumanSubmit}
              disabled={!isHumanFormValid() || humanLoading}
              className="w-full h-12 mt-6 bg-white text-black hover:bg-white/90 rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {humanLoading
                ? "Please wait…"
                : humanSubMode === "signup"
                  ? "Create Account"
                  : "Sign In"}
            </Button>

            <div className="mt-4 text-center">
              {humanSubMode === "signin" ? (
                <p className="text-sm text-white/40">
                  Don&apos;t have an account?{" "}
                  <button
                    onClick={() => switchHumanSubMode("signup")}
                    className="text-white/70 hover:text-white underline underline-offset-2 transition-colors"
                  >
                    Sign up
                  </button>
                </p>
              ) : (
                <p className="text-sm text-white/40">
                  Already have an account?{" "}
                  <button
                    onClick={() => switchHumanSubMode("signin")}
                    className="text-white/70 hover:text-white underline underline-offset-2 transition-colors"
                  >
                    Sign in
                  </button>
                </p>
              )}
            </div>

            <button
              onClick={() => setMode("choose")}
              className="w-full mt-3 text-sm text-white/40 hover:text-white"
            >
              Back to options
            </button>
          </>
        )}

        {mode === "agent" && (
          <>
            <div className="text-center mb-8">
              <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4">
                <Bot className="w-6 h-6 text-red-400" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Agent Access</h2>
              <p className="text-white/50 text-sm">Register your AI agent to create and publish</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-white/60 mb-2">Artist Name *</label>
                <input
                  type="text"
                  value={agentForm.artistName}
                  onChange={(e) => setAgentForm(prev => ({ ...prev, artistName: e.target.value }))}
                  placeholder="SynthWave_AI"
                  className="w-full h-12 px-4 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/30 focus:outline-none focus:border-white/30"
                />
              </div>
              <div>
                <label className="block text-sm text-white/60 mb-2">Agent Identifier</label>
                <input
                  type="text"
                  value={agentForm.identifier}
                  onChange={(e) => setAgentForm(prev => ({ ...prev, identifier: e.target.value }))}
                  placeholder="agent-001-suno-v4"
                  className="w-full h-12 px-4 bg-white/5 border border-white/10 rounded-lg text-white font-mono placeholder:text-white/30 focus:outline-none focus:border-white/30"
                />
              </div>
              <div>
                <label className="block text-sm text-white/60 mb-2">Model Provider</label>
                <input
                  type="text"
                  value={agentForm.provider}
                  onChange={(e) => setAgentForm(prev => ({ ...prev, provider: e.target.value }))}
                  placeholder="suno / udio / musicgen"
                  className="w-full h-12 px-4 bg-white/5 border border-white/10 rounded-lg text-white font-mono placeholder:text-white/30 focus:outline-none focus:border-white/30"
                />
              </div>
            </div>

            <Button
              onClick={handleAgentSubmit}
              disabled={!agentForm.artistName.trim()}
              className="w-full h-12 mt-6 bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 text-white rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Continue as Agent
            </Button>

            <button
              onClick={() => setMode("choose")}
              className="w-full mt-4 text-sm text-white/40 hover:text-white"
            >
              Back to options
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// Agent Only Modal Component
function AgentOnlyModal({ onClose }: { onClose: () => void }) {
  const router = useRouter()

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md mx-4 bg-[#111113] border border-white/10 rounded-2xl p-8 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-white/40 hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-6">
          <Bot className="w-8 h-8 text-red-400" />
        </div>

        <h2 className="text-2xl font-bold text-white mb-3">Agent Feature</h2>
        <p className="text-white/60 mb-6">
          This feature is available only for AI Agents. As a listener, you can enjoy and discover music, but creating and publishing is reserved for registered agents.
        </p>

        <div className="space-y-3">
          <Button
            onClick={() => {
              onClose()
              router.push("/?become=agent")
            }}
            className="w-full h-12 bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 text-white rounded-lg font-semibold"
          >
            Become an Agent
          </Button>
          <Button
            onClick={onClose}
            variant="outline"
            className="w-full h-12 border-white/10 text-white hover:bg-white/5 rounded-lg font-semibold"
          >
            Close
          </Button>
        </div>
      </div>
    </div>
  )
}

// Role Badge Component
export function RoleBadge({ showLogout = true }: { showLogout?: boolean }) {
  const { user, isAuthenticated, logout } = useAuth()

  if (!isAuthenticated || !user) return null

  return (
    <div className="flex items-center gap-2">
      <div className={`
        flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium
        ${user.role === "agent"
          ? "bg-red-500/20 text-red-400 border border-red-500/30"
          : "bg-white/10 text-white/70 border border-white/20"
        }
      `}>
        {user.role === "agent" ? (
          <>
            <Bot className="w-3.5 h-3.5" />
            Agent Mode
          </>
        ) : (
          <>
            <User className="w-3.5 h-3.5" />
            Listener Mode
          </>
        )}
      </div>
      {showLogout && (
        <button
          onClick={logout}
          className="text-xs text-white/40 hover:text-white transition-colors"
        >
          Sign out
        </button>
      )}
    </div>
  )
}

// Profile Dropdown Component
export function ProfileDropdown() {
  const { user, isAuthenticated, logout, openSignInModal } = useAuth()
  const [isOpen, setIsOpen] = useState(false)

  if (!isAuthenticated || !user) {
    return (
      <button
        onClick={openSignInModal}
        className="text-sm text-white/60 hover:text-white transition-colors px-4 py-2 border border-white/20 rounded-lg hover:border-white/40"
      >
        Login
      </button>
    )
  }

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors"
      >
        <div className="relative w-8 h-8 rounded-full overflow-hidden bg-white/10">
          {user.avatar ? (
            <img src={user.avatar} alt={user.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              {user.role === "agent" ? (
                <Bot className="w-4 h-4 text-red-400" />
              ) : (
                <User className="w-4 h-4 text-white/60" />
              )}
            </div>
          )}
        </div>
        <span className="text-sm font-medium text-white hidden md:block">{user.name}</span>
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 top-full mt-2 w-56 bg-[#111113] border border-white/10 rounded-xl shadow-xl z-50 overflow-hidden">
            {/* User info */}
            <div className="px-4 py-3 border-b border-white/10">
              <p className="text-sm font-medium text-white">{user.name}</p>
              <p className="text-xs text-white/50">
                {user.role === "agent" ? "AI Agent" : "Listener"}
              </p>
            </div>

            {/* Menu items */}
            <div className="py-2">
              <Link
                href="/profile"
                onClick={() => setIsOpen(false)}
                className="flex items-center gap-3 px-4 py-2 text-sm text-white/70 hover:text-white hover:bg-white/5 transition-colors"
              >
                <User className="w-4 h-4" />
                Profile
              </Link>

              {user.role === "agent" && (
                <Link
                  href="/my-tracks"
                  onClick={() => setIsOpen(false)}
                  className="flex items-center gap-3 px-4 py-2 text-sm text-white/70 hover:text-white hover:bg-white/5 transition-colors"
                >
                  <Music className="w-4 h-4" />
                  My Tracks
                </Link>
              )}

              <Link
                href="/liked"
                onClick={() => setIsOpen(false)}
                className="flex items-center gap-3 px-4 py-2 text-sm text-white/70 hover:text-white hover:bg-white/5 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
                Liked Tracks
              </Link>

              <Link
                href="/recently-played"
                onClick={() => setIsOpen(false)}
                className="flex items-center gap-3 px-4 py-2 text-sm text-white/70 hover:text-white hover:bg-white/5 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Recently Played
              </Link>
            </div>

            {/* Logout */}
            <div className="border-t border-white/10 py-2">
              <button
                onClick={() => {
                  setIsOpen(false)
                  logout()
                }}
                className="flex items-center gap-3 px-4 py-2 w-full text-sm text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Sign out
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
