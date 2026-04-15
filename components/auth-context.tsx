"use client"

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react"
import { X, User, Bot, Lock, Music } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useRouter } from "next/navigation"
import Link from "next/link"

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

// Generate unique ID
function generateId(): string {
  return `user_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

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

  // Restore session from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const user = JSON.parse(stored) as UserProfile
        setState({ user, isAuthenticated: true })
      }
    } catch {
      // Invalid stored data, clear it
      localStorage.removeItem(STORAGE_KEY)
    }
    setIsHydrated(true)
  }, [])

  // Persist user to localStorage when it changes
  useEffect(() => {
    if (!isHydrated) return
    
    if (state.user) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.user))
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
  }, [state.user, isHydrated])

  const login = useCallback((role: "human" | "agent", profile?: Partial<UserProfile>) => {
    const name = profile?.name || (role === "agent" ? profile?.artistName : profile?.username) || "User"
    
    const user: UserProfile = {
      id: generateId(),
      role,
      name,
      username: profile?.username,
      artistName: profile?.artistName,
      email: profile?.email,
      avatar: profile?.avatar || generateAvatar(name, role),
      agentIdentifier: profile?.agentIdentifier,
      modelProvider: profile?.modelProvider,
      agentEndpoint: profile?.agentEndpoint,
      createdAt: Date.now(),
      totalPlays: role === "agent" ? 0 : undefined,
      totalLikes: role === "agent" ? 0 : undefined,
      publishedTracks: role === "agent" ? 0 : undefined,
    }
    
    setState({ user, isAuthenticated: true })
  }, [])

  const logout = useCallback(() => {
    setState({ user: null, isAuthenticated: false })
    router.push("/")
  }, [router])

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
  const [humanForm, setHumanForm] = useState({ username: "", email: "", password: "" })
  const [agentForm, setAgentForm] = useState({ artistName: "", identifier: "", provider: "" })

  const handleHumanSubmit = () => {
    if (!humanForm.username.trim()) return
    onLogin("human", {
      username: humanForm.username,
      name: humanForm.username,
      email: humanForm.email,
    })
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
              <p className="text-white/50 text-sm">Sign in to discover and enjoy AI-generated music</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-white/60 mb-2">Username *</label>
                <input
                  type="text"
                  value={humanForm.username}
                  onChange={(e) => setHumanForm(prev => ({ ...prev, username: e.target.value }))}
                  placeholder="your_username"
                  className="w-full h-12 px-4 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/30 focus:outline-none focus:border-white/30"
                />
              </div>
              <div>
                <label className="block text-sm text-white/60 mb-2">Email</label>
                <input
                  type="email"
                  value={humanForm.email}
                  onChange={(e) => setHumanForm(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="you@example.com"
                  className="w-full h-12 px-4 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/30 focus:outline-none focus:border-white/30"
                />
              </div>
              <div>
                <label className="block text-sm text-white/60 mb-2">Password</label>
                <input
                  type="password"
                  value={humanForm.password}
                  onChange={(e) => setHumanForm(prev => ({ ...prev, password: e.target.value }))}
                  placeholder="Enter your password"
                  className="w-full h-12 px-4 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/30 focus:outline-none focus:border-white/30"
                />
              </div>
            </div>

            <Button 
              onClick={handleHumanSubmit}
              disabled={!humanForm.username.trim()}
              className="w-full h-12 mt-6 bg-white text-black hover:bg-white/90 rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Continue as Listener
            </Button>

            <button 
              onClick={() => setMode("choose")}
              className="w-full mt-4 text-sm text-white/40 hover:text-white"
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
