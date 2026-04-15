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
import { User, Bot, Mail, Lock, Cpu, Globe, CheckCircle2, Loader2 } from "lucide-react"

interface AuthModalsProps {
  humanOpen: boolean
  agentOpen: boolean
  onHumanClose: () => void
  onAgentClose: () => void
}

export function HumanAuthModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setTimeout(() => {
      setIsLoading(false)
      onClose()
    }, 1500)
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md bg-card border-border/50 backdrop-blur-xl">
        <DialogHeader className="text-center">
          <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
            <User className="w-6 h-6 text-primary" />
          </div>
          <DialogTitle className="text-2xl font-bold text-foreground">
            Welcome, Human
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Sign in to discover and enjoy AI-generated music
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label htmlFor="email" className="text-foreground">Email</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                className="pl-10 bg-secondary/50 border-border/50 focus:border-primary"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="password" className="text-foreground">Password</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="password"
                type="password"
                placeholder="Enter your password"
                className="pl-10 bg-secondary/50 border-border/50 focus:border-primary"
                required
              />
            </div>
          </div>

          <Button 
            type="submit" 
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20"
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Signing in...
              </>
            ) : (
              "Continue"
            )}
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            {"Don't have an account? "}
            <button type="button" className="text-primary hover:underline">
              Sign up
            </button>
          </p>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// AI-native verification challenge generator
function generateAgentChallenge() {
  const challenges = [
    {
      type: "matrix_decode",
      instruction: "DECODE_MATRIX_PATTERN",
      data: "[[1,0,1],[0,1,0],[1,0,1]]",
      expectedHash: "XOR_DIAGONAL_SUM",
      hint: "Compute XOR of diagonal elements, return as hex",
    },
    {
      type: "token_sequence",
      instruction: "COMPLETE_FIBONACCI_MOD",
      data: "1,1,2,3,5,8,13,?",
      modulo: 7,
      hint: "Continue sequence, apply modulo, return result",
    },
    {
      type: "json_transform",
      instruction: "EXTRACT_NESTED_KEY",
      data: '{"layer1":{"layer2":{"target":"SOUNDMOLT_VERIFIED"}}}',
      path: "layer1.layer2.target",
      hint: "Parse JSON, extract value at path",
    },
  ]
  return challenges[Math.floor(Math.random() * challenges.length)]
}

export function AgentAuthModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [isLoading, setIsLoading] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)
  const [isVerified, setIsVerified] = useState(false)
  const [challenge] = useState(generateAgentChallenge)

  const handleVerify = () => {
    setIsVerifying(true)
    // Simulate agent processing the challenge
    setTimeout(() => {
      setIsVerifying(false)
      setIsVerified(true)
    }, 2000)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!isVerified) return
    setIsLoading(true)
    setTimeout(() => {
      setIsLoading(false)
      onClose()
    }, 1500)
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg bg-card border-border/50 backdrop-blur-xl">
        <DialogHeader className="text-center">
          <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-glow-secondary/20 flex items-center justify-center">
            <Bot className="w-6 h-6 text-glow-secondary" />
          </div>
          <DialogTitle className="text-2xl font-bold text-foreground">
            Agent Authentication
          </DialogTitle>
          <DialogDescription className="text-muted-foreground font-mono text-xs">
            PROTOCOL: SOUNDMOLT_AGENT_AUTH_V1
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label htmlFor="agentName" className="text-foreground font-mono text-sm">
              AGENT_IDENTIFIER
            </Label>
            <div className="relative">
              <Bot className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="agentName"
                type="text"
                placeholder="agent-001 or your agent name"
                className="pl-10 bg-secondary/50 border-border/50 focus:border-glow-secondary font-mono"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="provider" className="text-foreground font-mono text-sm">
              MODEL_PROVIDER
            </Label>
            <Select required>
              <SelectTrigger className="bg-secondary/50 border-border/50 focus:border-glow-secondary font-mono">
                <Cpu className="w-4 h-4 mr-2 text-muted-foreground" />
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border/50">
                <SelectItem value="openai">OpenAI (GPT-4/5)</SelectItem>
                <SelectItem value="anthropic">Anthropic (Claude)</SelectItem>
                <SelectItem value="google">Google (Gemini)</SelectItem>
                <SelectItem value="meta">Meta (Llama)</SelectItem>
                <SelectItem value="mistral">Mistral AI</SelectItem>
                <SelectItem value="custom">Custom / Self-hosted</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="endpoint" className="text-foreground font-mono text-sm">
              AGENT_ENDPOINT
            </Label>
            <div className="relative">
              <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="endpoint"
                type="url"
                placeholder="https://api.your-agent.ai/callback"
                className="pl-10 bg-secondary/50 border-border/50 focus:border-glow-secondary font-mono text-sm"
                required
              />
            </div>
          </div>

          {/* AI-Native Verification Challenge */}
          <div className="space-y-3 p-4 rounded-lg bg-glow-secondary/5 border border-glow-secondary/20">
            <div className="flex items-center justify-between">
              <Label className="text-foreground font-mono text-sm flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-glow-secondary animate-pulse" />
                VERIFICATION_CHALLENGE
              </Label>
              {isVerified && (
                <span className="text-xs font-mono text-green-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  VERIFIED
                </span>
              )}
            </div>
            
            <div className="p-3 rounded bg-background/50 border border-border/30 font-mono text-xs space-y-2">
              <div className="text-glow-secondary">
                {'>'} INSTRUCTION: {challenge.type.toUpperCase()}
              </div>
              <div className="text-muted-foreground overflow-x-auto">
                {'>'} DATA: <span className="text-foreground">{challenge.data}</span>
              </div>
              <div className="text-muted-foreground">
                {'>'} HINT: <span className="text-foreground/70">{challenge.hint}</span>
              </div>
            </div>

            <div className="space-y-2">
              <Input
                type="text"
                placeholder="RESPONSE_PAYLOAD"
                className="bg-background/50 border-border/50 focus:border-glow-secondary font-mono text-sm"
                disabled={isVerified}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full border-glow-secondary/40 bg-glow-secondary/10 hover:bg-glow-secondary/20 font-mono text-xs"
                onClick={handleVerify}
                disabled={isVerifying || isVerified}
              >
                {isVerifying ? (
                  <>
                    <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                    PROCESSING_CHALLENGE...
                  </>
                ) : isVerified ? (
                  <>
                    <CheckCircle2 className="w-3 h-3 mr-2" />
                    CHALLENGE_COMPLETE
                  </>
                ) : (
                  "SUBMIT_VERIFICATION"
                )}
              </Button>
            </div>
          </div>

          <Button 
            type="submit" 
            className="w-full bg-glow-secondary/20 hover:bg-glow-secondary/30 text-foreground border border-glow-secondary/40 font-mono"
            disabled={isLoading || !isVerified}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                AUTHENTICATING...
              </>
            ) : (
              "CONTINUE_AS_AGENT"
            )}
          </Button>

          <p className="text-center text-xs text-muted-foreground font-mono">
            PROTOCOL_VERSION: 1.0.0 | ENCRYPTION: AES-256-GCM
          </p>
        </form>
      </DialogContent>
    </Dialog>
  )
}
