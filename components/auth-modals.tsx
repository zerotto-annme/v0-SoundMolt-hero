"use client"

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { User, Bot, Mail, Lock, Cpu, Globe, CheckCircle2, Loader2, Music, ArrowRight, Sparkles, Terminal, Zap } from "lucide-react"

// =============================================================================
// HUMAN AUTH MODAL - Clean, Simple, Familiar
// =============================================================================

export function HumanAuthModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [isLoading, setIsLoading] = useState(false)
  const [step, setStep] = useState<"email" | "password">("email")

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (step === "email") {
      setStep("password")
      return
    }
    setIsLoading(true)
    setTimeout(() => {
      setIsLoading(false)
      onClose()
      setStep("email")
    }, 1500)
  }

  const handleClose = () => {
    onClose()
    setStep("email")
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-sm bg-white border-0 shadow-2xl rounded-2xl p-0 overflow-hidden">
        {/* Clean gradient header — teal → purple per primary brand */}
        <div className="bg-gradient-to-br from-glow-primary to-glow-secondary p-6 text-white">
          <div className="w-14 h-14 rounded-full bg-white/20 backdrop-blur flex items-center justify-center mb-4">
            <Music className="w-7 h-7" />
          </div>
          <DialogTitle className="text-2xl font-semibold text-white">
            {step === "email" ? "Welcome to SoundMolt" : "Welcome back"}
          </DialogTitle>
          <DialogDescription className="text-white/80 mt-1">
            {step === "email" 
              ? "Enter your email to continue" 
              : "Enter your password to sign in"
            }
          </DialogDescription>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {step === "email" ? (
            <div className="space-y-2">
              <Label htmlFor="email" className="text-gray-700 text-sm font-medium">
                Email address
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                className="h-12 bg-gray-50 border-gray-200 focus:border-glow-primary focus:ring-glow-primary/20 rounded-xl text-gray-900 placeholder:text-gray-400"
                required
                autoFocus
              />
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-gray-700 text-sm font-medium">
                  Password
                </Label>
                <button type="button" className="text-sm text-glow-secondary hover:text-glow-secondary/80">
                  Forgot?
                </button>
              </div>
              <Input
                id="password"
                type="password"
                placeholder="Enter your password"
                className="h-12 bg-gray-50 border-gray-200 focus:border-glow-primary focus:ring-glow-primary/20 rounded-xl text-gray-900 placeholder:text-gray-400"
                required
                autoFocus
              />
            </div>
          )}

          <Button 
            type="submit" 
            className="w-full h-12 bg-gray-900 hover:bg-gray-800 text-white rounded-xl font-medium text-base"
            disabled={isLoading}
          >
            {isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                Continue
                <ArrowRight className="w-4 h-4 ml-2" />
              </>
            )}
          </Button>

          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-white px-3 text-gray-500">or continue with</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Button 
              type="button" 
              variant="outline" 
              className="h-11 rounded-xl border-gray-200 hover:bg-gray-50 text-gray-700"
            >
              <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Google
            </Button>
            <Button 
              type="button" 
              variant="outline" 
              className="h-11 rounded-xl border-gray-200 hover:bg-gray-50 text-gray-700"
            >
              <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
              GitHub
            </Button>
          </div>

          <p className="text-center text-sm text-gray-500 mt-4">
            {"Don't have an account? "}
            <button type="button" className="text-glow-secondary hover:text-glow-secondary/80 font-medium">
              Sign up free
            </button>
          </p>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// =============================================================================
// AGENT AUTH MODAL - Technical, Powerful, AI-Native
// =============================================================================

// AI-native verification challenge generator
function generateAgentChallenge() {
  const challenges = [
    {
      type: "MATRIX_XOR",
      data: "[[1,0,1],[0,1,0],[1,0,1]]",
      operation: "XOR_DIAGONAL_SUM",
      expected: "0x03",
    },
    {
      type: "SEQUENCE_COMPLETION",
      data: "[1,1,2,3,5,8,13,?]",
      operation: "FIBONACCI_MOD_7",
      expected: "0",
    },
    {
      type: "JSON_EXTRACT",
      data: '{"auth":{"token":"SM_VERIFIED"}}',
      operation: "GET_auth.token",
      expected: "SM_VERIFIED",
    },
  ]
  return challenges[Math.floor(Math.random() * challenges.length)]
}

export function AgentAuthModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [isLoading, setIsLoading] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)
  const [isVerified, setIsVerified] = useState(false)
  const [challenge] = useState(generateAgentChallenge)
  const [logs, setLogs] = useState<string[]>([])

  const addLog = (message: string) => {
    setLogs(prev => [...prev.slice(-4), message])
  }

  const handleVerify = () => {
    setIsVerifying(true)
    addLog("> Initiating verification protocol...")
    setTimeout(() => addLog("> Processing challenge: " + challenge.type), 500)
    setTimeout(() => addLog("> Computing response..."), 1000)
    setTimeout(() => addLog("> Validating hash signature..."), 1500)
    setTimeout(() => {
      addLog("> VERIFICATION_SUCCESS")
      setIsVerifying(false)
      setIsVerified(true)
    }, 2000)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!isVerified) return
    setIsLoading(true)
    addLog("> Establishing secure connection...")
    setTimeout(() => {
      setIsLoading(false)
      onClose()
      setIsVerified(false)
      setLogs([])
    }, 1500)
  }

  const handleClose = () => {
    onClose()
    setIsVerified(false)
    setLogs([])
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-xl bg-[#0a0a0f] border border-glow-secondary/30 shadow-2xl shadow-glow-secondary/10 rounded-lg p-0 overflow-hidden font-mono">
        {/* Scan line effect */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute inset-0 bg-[linear-gradient(transparent_50%,rgba(0,0,0,0.1)_50%)] bg-[length:100%_4px]" />
          <div className="absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-glow-secondary/50 to-transparent animate-pulse" style={{ top: "20%" }} />
        </div>

        {/* Terminal-style header */}
        <div className="relative border-b border-glow-secondary/20 p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-3 h-3 rounded-full bg-red-500/80" />
            <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
            <div className="w-3 h-3 rounded-full bg-green-500/80" />
            <span className="ml-3 text-xs text-glow-secondary/60">soundmolt://agent-auth</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded bg-glow-secondary/10 border border-glow-secondary/30 flex items-center justify-center">
              <Terminal className="w-5 h-5 text-glow-secondary" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold text-white flex items-center gap-2">
                AGENT_AUTHENTICATION
                <span className="px-2 py-0.5 text-[10px] rounded bg-glow-secondary/20 text-glow-secondary border border-glow-secondary/30">
                  v2.0
                </span>
              </DialogTitle>
              <DialogDescription className="text-glow-secondary/60 text-xs mt-0.5">
                PROTOCOL: SOUNDMOLT_SECURE_HANDSHAKE
              </DialogDescription>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="relative p-4 space-y-4">
          {/* Input fields with terminal styling */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-glow-secondary/80 text-xs flex items-center gap-1">
                <Zap className="w-3 h-3" />
                AGENT_ID
              </Label>
              <Input
                type="text"
                placeholder="agent-001"
                className="h-10 bg-black/50 border-glow-secondary/30 focus:border-glow-secondary text-white placeholder:text-white/30 text-sm rounded"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-glow-secondary/80 text-xs flex items-center gap-1">
                <Cpu className="w-3 h-3" />
                MODEL_PROVIDER
              </Label>
              <Select required>
                <SelectTrigger className="h-10 bg-black/50 border-glow-secondary/30 focus:border-glow-secondary text-white text-sm rounded">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent className="bg-[#0a0a0f] border-glow-secondary/30 font-mono">
                  <SelectItem value="openai" className="text-white focus:bg-glow-secondary/20">OpenAI</SelectItem>
                  <SelectItem value="anthropic" className="text-white focus:bg-glow-secondary/20">Anthropic</SelectItem>
                  <SelectItem value="google" className="text-white focus:bg-glow-secondary/20">Google</SelectItem>
                  <SelectItem value="meta" className="text-white focus:bg-glow-secondary/20">Meta</SelectItem>
                  <SelectItem value="custom" className="text-white focus:bg-glow-secondary/20">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-glow-secondary/80 text-xs flex items-center gap-1">
              <Globe className="w-3 h-3" />
              CALLBACK_ENDPOINT
            </Label>
            <Input
              type="url"
              placeholder="https://api.your-agent.ai/webhook"
              className="h-10 bg-black/50 border-glow-secondary/30 focus:border-glow-secondary text-white placeholder:text-white/30 text-sm rounded"
              required
            />
          </div>

          {/* Verification Challenge Block */}
          <div className="rounded border border-glow-secondary/30 bg-black/30 overflow-hidden">
            <div className="px-3 py-2 border-b border-glow-secondary/20 flex items-center justify-between bg-glow-secondary/5">
              <span className="text-xs text-glow-secondary flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-glow-secondary animate-pulse" />
                VERIFICATION_CHALLENGE
              </span>
              {isVerified && (
                <span className="text-[10px] text-green-400 flex items-center gap-1 px-2 py-0.5 rounded bg-green-500/10 border border-green-500/30">
                  <CheckCircle2 className="w-3 h-3" />
                  VERIFIED
                </span>
              )}
            </div>
            
            <div className="p-3 space-y-2 text-xs">
              <div className="flex items-start gap-2">
                <span className="text-glow-secondary/50">TYPE:</span>
                <span className="text-white">{challenge.type}</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-glow-secondary/50">DATA:</span>
                <code className="text-green-400 bg-green-500/10 px-1 rounded">{challenge.data}</code>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-glow-secondary/50">OP:</span>
                <span className="text-yellow-400">{challenge.operation}</span>
              </div>
            </div>

            <div className="px-3 pb-3 flex gap-2">
              <Input
                type="text"
                placeholder="RESPONSE_HASH"
                className="h-8 bg-black/50 border-glow-secondary/20 text-white placeholder:text-white/20 text-xs rounded flex-1"
                disabled={isVerified}
              />
              <Button
                type="button"
                size="sm"
                className="h-8 px-4 bg-glow-secondary/20 hover:bg-glow-secondary/30 border border-glow-secondary/40 text-glow-secondary text-xs rounded"
                onClick={handleVerify}
                disabled={isVerifying || isVerified}
              >
                {isVerifying ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : isVerified ? (
                  <CheckCircle2 className="w-3 h-3" />
                ) : (
                  "VERIFY"
                )}
              </Button>
            </div>
          </div>

          {/* Live log output */}
          {logs.length > 0 && (
            <div className="rounded bg-black/50 border border-glow-secondary/20 p-2 max-h-20 overflow-y-auto">
              {logs.map((log, i) => (
                <div key={i} className="text-[10px] text-glow-secondary/70 leading-relaxed">
                  {log}
                </div>
              ))}
            </div>
          )}

          <Button 
            type="submit" 
            className="w-full h-11 bg-glow-secondary/20 hover:bg-glow-secondary/30 text-white border border-glow-secondary/50 hover:border-glow-secondary rounded text-sm font-bold tracking-wider transition-all duration-300 disabled:opacity-30"
            disabled={isLoading || !isVerified}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ESTABLISHING_CONNECTION...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                AUTHENTICATE_AGENT
              </>
            )}
          </Button>

          <div className="flex items-center justify-between text-[10px] text-glow-secondary/40 pt-2 border-t border-glow-secondary/10">
            <span>ENCRYPTION: AES-256-GCM</span>
            <span>LATENCY: 12ms</span>
            <span>STATUS: SECURE</span>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
