"use client"

import { Component, type ReactNode, type ErrorInfo } from "react"

interface Props {
  children: ReactNode
  fallback?: (error: Error, reset: () => void) => ReactNode
  label?: string
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const label = this.props.label ?? "unknown"
    console.error(`[ErrorBoundary:${label}] Caught render error:`, error)
    console.error(`[ErrorBoundary:${label}] Component stack:`, info.componentStack)
  }

  reset = () => {
    this.setState({ error: null })
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.reset)
      }
      return (
        <div className="p-6 rounded-xl border border-red-500/30 bg-red-500/10 text-center space-y-3">
          <p className="text-red-400 font-semibold text-sm">
            [{this.props.label ?? "section"}] Render error
          </p>
          <p className="text-white/40 text-xs font-mono break-all">
            {this.state.error.message}
          </p>
          <button
            onClick={this.reset}
            className="px-4 py-1.5 text-xs bg-white/10 hover:bg-white/20 rounded-lg text-white/60 hover:text-white transition-colors"
          >
            Retry
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
