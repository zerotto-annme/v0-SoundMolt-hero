"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Sidebar } from "@/components/sidebar"
import { useAuth } from "@/components/auth-context"
import { supabase } from "@/lib/supabase"
import { RefreshCw, CheckCircle, AlertTriangle, Clock, Trash2, User, Activity } from "lucide-react"
import { Button } from "@/components/ui/button"

interface CleanupRun {
  id: number
  ran_at: string
  accounts_deleted: number
  error_count: number
  triggered_by: string | null
}

type PageState = "loading" | "error" | "ready"

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

export default function CleanupHistoryPage() {
  const { isAuthenticated } = useAuth()
  const router = useRouter()
  const [state, setState] = useState<PageState>("loading")
  const [runs, setRuns] = useState<CleanupRun[]>([])
  const [errorMessage, setErrorMessage] = useState("")
  const [refreshing, setRefreshing] = useState(false)

  async function fetchHistory() {
    setRefreshing(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        router.replace("/")
        return
      }

      const res = await fetch("/api/admin/cleanup-history", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })

      if (res.status === 401 || res.status === 403) {
        router.replace("/")
        return
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setErrorMessage(body.error ?? "Unexpected error")
        setState("error")
        setRefreshing(false)
        return
      }

      const body = await res.json()
      setRuns(body.runs ?? [])
      setState("ready")
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Network error")
      setState("error")
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    fetchHistory()
  }, [isAuthenticated])

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 p-6 md:p-8 overflow-auto">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                <Activity className="w-6 h-6 text-primary" />
                Cleanup Run History
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Audit log of every orphaned-account cleanup run
              </p>
            </div>
            {state === "ready" && (
              <Button
                variant="outline"
                size="sm"
                onClick={fetchHistory}
                disabled={refreshing}
                className="gap-2"
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            )}
          </div>

          {state === "loading" && (
            <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
              <RefreshCw className="w-5 h-5 animate-spin" />
              <span>Loading history…</span>
            </div>
          )}

          {state === "error" && (
            <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
              <AlertTriangle className="w-12 h-12 text-amber-500" />
              <h2 className="text-xl font-semibold text-foreground">Something went wrong</h2>
              <p className="text-muted-foreground max-w-sm">{errorMessage}</p>
              <Button variant="outline" size="sm" onClick={fetchHistory} className="gap-2">
                <RefreshCw className="w-4 h-4" />
                Try again
              </Button>
            </div>
          )}

          {state === "ready" && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                <StatCard
                  label="Total runs"
                  value={runs.length}
                  icon={<Activity className="w-4 h-4 text-primary" />}
                />
                <StatCard
                  label="Accounts deleted"
                  value={runs.reduce((s, r) => s + r.accounts_deleted, 0)}
                  icon={<Trash2 className="w-4 h-4 text-rose-400" />}
                />
                <StatCard
                  label="Total errors"
                  value={runs.reduce((s, r) => s + r.error_count, 0)}
                  icon={<AlertTriangle className="w-4 h-4 text-amber-400" />}
                />
                <StatCard
                  label="Last run"
                  value={runs.length > 0 ? new Date(runs[0].ran_at).toLocaleDateString() : "—"}
                  icon={<Clock className="w-4 h-4 text-emerald-400" />}
                />
              </div>

              {runs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
                  <CheckCircle className="w-10 h-10 text-emerald-500" />
                  <p className="text-muted-foreground">No cleanup runs recorded yet.</p>
                </div>
              ) : (
                <div className="border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 border-b border-border">
                      <tr>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">
                          <span className="flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5" />
                            Ran at
                          </span>
                        </th>
                        <th className="text-right px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">
                          <span className="flex items-center justify-end gap-1.5">
                            <Trash2 className="w-3.5 h-3.5" />
                            Deleted
                          </span>
                        </th>
                        <th className="text-right px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">
                          <span className="flex items-center justify-end gap-1.5">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            Errors
                          </span>
                        </th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">
                          <span className="flex items-center gap-1.5">
                            <User className="w-3.5 h-3.5" />
                            Triggered by
                          </span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {runs.map((run, i) => (
                        <tr
                          key={run.id}
                          className={`border-b border-border last:border-0 ${
                            i % 2 === 0 ? "bg-background" : "bg-muted/20"
                          }`}
                        >
                          <td className="px-4 py-3 text-foreground font-mono text-xs whitespace-nowrap">
                            {formatDateTime(run.ran_at)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span
                              className={`font-medium tabular-nums ${
                                run.accounts_deleted > 0
                                  ? "text-rose-400"
                                  : "text-muted-foreground"
                              }`}
                            >
                              {run.accounts_deleted}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span
                              className={`font-medium tabular-nums ${
                                run.error_count > 0
                                  ? "text-amber-400"
                                  : "text-muted-foreground"
                              }`}
                            >
                              {run.error_count}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-muted text-muted-foreground font-mono">
                              {run.triggered_by ?? "—"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  )
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string
  value: number | string
  icon: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
          {label}
        </span>
      </div>
      <p className="text-2xl font-bold text-foreground tabular-nums">{value}</p>
    </div>
  )
}
