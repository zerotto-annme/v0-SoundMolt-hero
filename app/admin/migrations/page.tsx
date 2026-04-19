"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Sidebar } from "@/components/sidebar"
import { useAuth } from "@/components/auth-context"
import { supabase } from "@/lib/supabase"
import { RefreshCw, CheckCircle, AlertTriangle, Database, FileCode } from "lucide-react"
import { Button } from "@/components/ui/button"

interface MigrationStatus {
  filename: string
  applied: boolean
  applied_at: string | null
}

interface MigrationData {
  migrations: MigrationStatus[]
  total: number
  applied: number
  missing: number
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

export default function MigrationsPage() {
  const { isAuthenticated } = useAuth()
  const router = useRouter()
  const [state, setState] = useState<PageState>("loading")
  const [data, setData] = useState<MigrationData | null>(null)
  const [errorMessage, setErrorMessage] = useState("")
  const [refreshing, setRefreshing] = useState(false)

  async function fetchMigrations() {
    setRefreshing(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        router.replace("/")
        return
      }

      const res = await fetch("/api/admin/migrations", {
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
      setData(body)
      setState("ready")
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Network error")
      setState("error")
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    fetchMigrations()
  }, [isAuthenticated])

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 p-6 md:p-8 overflow-auto">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                <Database className="w-6 h-6 text-primary" />
                Migration Status
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Compares migration files in the repo against applied migrations in the database
              </p>
            </div>
            {state === "ready" && (
              <Button
                variant="outline"
                size="sm"
                onClick={fetchMigrations}
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
              <span>Loading migration status…</span>
            </div>
          )}

          {state === "error" && (
            <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
              <AlertTriangle className="w-12 h-12 text-amber-500" />
              <h2 className="text-xl font-semibold text-foreground">Something went wrong</h2>
              <p className="text-muted-foreground max-w-sm">{errorMessage}</p>
              <Button variant="outline" size="sm" onClick={fetchMigrations} className="gap-2">
                <RefreshCw className="w-4 h-4" />
                Try again
              </Button>
            </div>
          )}

          {state === "ready" && data && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
                <StatCard
                  label="Total migrations"
                  value={data.total}
                  icon={<FileCode className="w-4 h-4 text-primary" />}
                />
                <StatCard
                  label="Applied"
                  value={data.applied}
                  icon={<CheckCircle className="w-4 h-4 text-emerald-400" />}
                />
                <StatCard
                  label="Not applied"
                  value={data.missing}
                  icon={<AlertTriangle className="w-4 h-4 text-amber-400" />}
                  highlight={data.missing > 0}
                />
              </div>

              {data.missing > 0 && (
                <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>
                    {data.missing} migration{data.missing === 1 ? "" : "s"} found in the repo{" "}
                    {data.missing === 1 ? "has" : "have"} not been applied to the database.
                  </span>
                </div>
              )}

              {data.migrations.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
                  <CheckCircle className="w-10 h-10 text-emerald-500" />
                  <p className="text-muted-foreground">No migration files found.</p>
                </div>
              ) : (
                <div className="border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 border-b border-border">
                      <tr>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">
                          <span className="flex items-center gap-1.5">
                            <FileCode className="w-3.5 h-3.5" />
                            Filename
                          </span>
                        </th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">
                          Status
                        </th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">
                          Applied at
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.migrations.map((migration, i) => (
                        <tr
                          key={migration.filename}
                          className={`border-b border-border last:border-0 ${
                            i % 2 === 0 ? "bg-background" : "bg-muted/20"
                          } ${!migration.applied ? "bg-amber-500/5" : ""}`}
                        >
                          <td className="px-4 py-3 font-mono text-xs text-foreground whitespace-nowrap">
                            {migration.filename}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            {migration.applied ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-400">
                                <CheckCircle className="w-3 h-3" />
                                Applied
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 text-amber-400">
                                <AlertTriangle className="w-3 h-3" />
                                Not applied
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">
                            {migration.applied_at ? formatDateTime(migration.applied_at) : "—"}
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
  highlight = false,
}: {
  label: string
  value: number | string
  icon: React.ReactNode
  highlight?: boolean
}) {
  return (
    <div className={`rounded-lg border bg-card p-4 ${highlight ? "border-amber-500/40" : "border-border"}`}>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
          {label}
        </span>
      </div>
      <p className={`text-2xl font-bold tabular-nums ${highlight ? "text-amber-400" : "text-foreground"}`}>
        {value}
      </p>
    </div>
  )
}
