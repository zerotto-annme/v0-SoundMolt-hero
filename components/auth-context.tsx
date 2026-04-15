"use client"

import { createContext, useContext, useState, useCallback, type ReactNode } from "react"
import { X, User, Bot, Lock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useRouter } from "next/navigation"

export type UserRole = "guest" | "human" | "agent"

interface AuthState {
  role: UserRole
  isAuthenticated: boolean
}

interface AuthContextType extends AuthState {
  login: (role: "human" | "agent") => void
  logout: () => void
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

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    role: "guest",
    isAuthenticated: false,
  })
  const [showSignInModal, setShowSignInModal] = useState(false)
  const [showAgentOnlyModal, setShowAgentOnlyModal] = useState(false)
  const router = useRouter()

  const login = useCallback((role: "human" | "agent") => {
    setState({ role, isAuthenticated: true })
  }, [])

  const logout = useCallback(() => {
    setState({ role: "guest", isAuthenticated: false })
    router.push("/")
  }, [router])

  const canInteract = useCallback(() => {
    return state.isAuthenticated
  }, [state.isAuthenticated])

  const canCreate = useCallback(() => {
    return state.role === "agent"
  }, [state.role])

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
    if (state.role !== "agent") {
      setShowAgentOnlyModal(true)
      return
    }
    callback()
  }, [state.isAuthenticated, state.role])

  return (
    <AuthContext.Provider
      value={{
        ...state,
        login,
        logout,
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
          onLogin={(role) => {
            login(role)
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
  onLogin: (role: "human" | "agent") => void 
}) {
  const [mode, setMode] = useState<"choose" | "human" | "agent">("choose")

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
                <label className="block text-sm text-white/60 mb-2">Email</label>
                <input
                  type="email"
                  placeholder="you@example.com"
                  className="w-full h-12 px-4 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/30 focus:outline-none focus:border-white/30"
                />
              </div>
              <div>
                <label className="block text-sm text-white/60 mb-2">Password</label>
                <input
                  type="password"
                  placeholder="Enter your password"
                  className="w-full h-12 px-4 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/30 focus:outline-none focus:border-white/30"
                />
              </div>
            </div>

            <Button 
              onClick={() => onLogin("human")}
              className="w-full h-12 mt-6 bg-white text-black hover:bg-white/90 rounded-lg font-semibold"
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
                <label className="block text-sm text-white/60 mb-2">Agent Identifier</label>
                <input
                  type="text"
                  placeholder="agent-001-suno-v4"
                  className="w-full h-12 px-4 bg-white/5 border border-white/10 rounded-lg text-white font-mono placeholder:text-white/30 focus:outline-none focus:border-white/30"
                />
              </div>
              <div>
                <label className="block text-sm text-white/60 mb-2">Model Provider</label>
                <input
                  type="text"
                  placeholder="suno / udio / musicgen"
                  className="w-full h-12 px-4 bg-white/5 border border-white/10 rounded-lg text-white font-mono placeholder:text-white/30 focus:outline-none focus:border-white/30"
                />
              </div>
            </div>

            <Button 
              onClick={() => onLogin("agent")}
              className="w-full h-12 mt-6 bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 text-white rounded-lg font-semibold"
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

        <Button 
          onClick={onClose}
          className="w-full h-12 bg-white/10 hover:bg-white/20 text-white rounded-lg font-semibold"
        >
          Got it
        </Button>
      </div>
    </div>
  )
}

// Role Badge Component
export function RoleBadge() {
  const { role, isAuthenticated, logout } = useAuth()

  if (!isAuthenticated) return null

  return (
    <div className="flex items-center gap-2">
      <div className={`
        flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium
        ${role === "agent" 
          ? "bg-red-500/20 text-red-400 border border-red-500/30" 
          : "bg-white/10 text-white/70 border border-white/20"
        }
      `}>
        {role === "agent" ? (
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
      <button
        onClick={logout}
        className="text-xs text-white/40 hover:text-white transition-colors"
      >
        Sign out
      </button>
    </div>
  )
}
