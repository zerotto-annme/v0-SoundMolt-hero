"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import {
  Loader2, ShieldAlert, RefreshCw, Sparkles, ExternalLink,
  Coins, Plus, RotateCcw, AlertCircle, Check,
} from "lucide-react"
import { useAuth } from "@/components/auth-context"
import { isClientAdminEmail } from "@/lib/admin-emails-client"
import { supabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"

// ─── Types ──────────────────────────────────────────────────────────────
interface AdminReview {
  id: string
  user_id: string
  owner_email: string | null
  title: string | null
  status: "processing" | "ready" | "failed"
  access_type: "free" | "full"
  credits_used: number
  source_type: "uploaded_file" | "existing_track"
  genre: string | null
  daw: string | null
  feedback_focus: string | null
  created_at: string
}

interface CreditRow {
  user_id: string
  owner_email: string | null
  credits_balance: number
  updated_at: string
}

interface AdjustResult {
  ok: true
  user_id: string
  previous_balance: number
  credits_balance: number
  delta: number
}

// ─── Helpers ────────────────────────────────────────────────────────────
async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) throw new Error("Session expired — please refresh the page and sign in again.")
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  })
  const text = await res.text()
  let json: any = null
  try { json = text ? JSON.parse(text) : null } catch { /* not JSON */ }
  if (!res.ok) {
    const msg = json?.message || json?.error || text || `HTTP ${res.status}`
    throw new Error(msg)
  }
  return (json ?? {}) as T
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  try { return new Date(iso).toLocaleString() } catch { return iso }
}

function shortId(id: string | null | undefined): string {
  if (!id) return "—"
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id
}

// ─── Page ───────────────────────────────────────────────────────────────
export default function AdminAiProducerPage() {
  const { user, isAuthenticated, authReady } = useAuth()

  const adminAllowed =
    !!user?.email && isClientAdminEmail(user.email)

  const [reviews, setReviews] = useState<AdminReview[]>([])
  const [reviewsLoading, setReviewsLoading] = useState(false)
  const [reviewsError, setReviewsError] = useState<string | null>(null)

  const [credits, setCredits] = useState<CreditRow[]>([])
  const [creditsLoading, setCreditsLoading] = useState(false)
  const [creditsError, setCreditsError] = useState<string | null>(null)

  const [pendingUserId, setPendingUserId] = useState<string | null>(null)
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({})
  const [flashUserId, setFlashUserId] = useState<string | null>(null)

  // Grant-to-new-user form
  const [grantUserId, setGrantUserId] = useState("")
  const [grantAmount, setGrantAmount] = useState("1")
  const [grantError, setGrantError] = useState<string | null>(null)
  const [grantBusy, setGrantBusy] = useState(false)

  const refreshReviews = useCallback(async () => {
    setReviewsLoading(true)
    setReviewsError(null)
    try {
      const json = await adminFetch<{ ok: true; reviews: AdminReview[] }>(
        "/api/admin/ai-producer/reviews",
      )
      setReviews(json.reviews ?? [])
    } catch (err: any) {
      setReviewsError(err?.message || "Failed to load reviews.")
    } finally {
      setReviewsLoading(false)
    }
  }, [])

  const refreshCredits = useCallback(async () => {
    setCreditsLoading(true)
    setCreditsError(null)
    try {
      const json = await adminFetch<{ ok: true; credits: CreditRow[] }>(
        "/api/admin/ai-producer/credits",
      )
      setCredits(json.credits ?? [])
    } catch (err: any) {
      setCreditsError(err?.message || "Failed to load credits.")
    } finally {
      setCreditsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!authReady || !adminAllowed) return
    refreshReviews()
    refreshCredits()
  }, [authReady, adminAllowed, refreshReviews, refreshCredits])

  const adjustCredits = async (
    userId: string,
    action: "add" | "set" | "reset",
    amount?: number,
  ) => {
    setPendingUserId(userId)
    try {
      const body: any = { user_id: userId, action }
      if (action !== "reset") body.amount = amount
      const result = await adminFetch<AdjustResult>(
        "/api/admin/ai-producer/credits",
        { method: "POST", body: JSON.stringify(body) },
      )
      // Optimistic refresh of just this row
      setCredits((prev) => {
        const idx = prev.findIndex((r) => r.user_id === userId)
        const updatedAt = new Date().toISOString()
        if (idx === -1) {
          return [
            {
              user_id: userId,
              owner_email: null,
              credits_balance: result.credits_balance,
              updated_at: updatedAt,
            },
            ...prev,
          ]
        }
        const copy = [...prev]
        copy[idx] = { ...copy[idx], credits_balance: result.credits_balance, updated_at: updatedAt }
        return copy
      })
      setFlashUserId(userId)
      setTimeout(() => setFlashUserId((cur) => (cur === userId ? null : cur)), 1500)
    } catch (err: any) {
      alert(err?.message || "Adjustment failed.")
    } finally {
      setPendingUserId(null)
    }
  }

  const handleGrantNew = async (e: React.FormEvent) => {
    e.preventDefault()
    setGrantError(null)
    const uid = grantUserId.trim()
    const amt = Number(grantAmount)
    if (!/^[0-9a-f-]{32,36}$/i.test(uid)) {
      setGrantError("user_id must be a UUID.")
      return
    }
    if (!Number.isFinite(amt) || amt < 0) {
      setGrantError("Amount must be a non-negative number.")
      return
    }
    setGrantBusy(true)
    try {
      await adjustCredits(uid, "add", Math.trunc(amt))
      setGrantUserId("")
      setGrantAmount("1")
      // Force a full credits refresh so the email gets enriched.
      refreshCredits()
    } catch (err: any) {
      setGrantError(err?.message || "Grant failed.")
    } finally {
      setGrantBusy(false)
    }
  }

  // ── Render branches ─────────────────────────────────────────────────
  if (!authReady) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-4">
        <div className="max-w-md w-full rounded-2xl border border-border/50 bg-card/40 p-8 text-center space-y-3">
          <ShieldAlert className="w-8 h-8 mx-auto text-amber-300" />
          <div className="text-lg font-semibold">Sign in required</div>
          <p className="text-sm text-muted-foreground">
            This admin page is for testing. Please log in to continue.
          </p>
        </div>
      </div>
    )
  }

  if (!adminAllowed) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-4">
        <div className="max-w-md w-full rounded-2xl border border-red-400/30 bg-red-500/10 p-8 text-center space-y-3">
          <ShieldAlert className="w-8 h-8 mx-auto text-red-300" />
          <div className="text-lg font-semibold text-red-100">Admin only</div>
          <p className="text-sm text-red-200/80">
            Your account is not on the admin allow-list.
          </p>
          <Link href="/feed">
            <Button variant="outline">Back to feed</Button>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-purple-600 to-fuchsia-600 flex items-center justify-center shadow-lg shadow-purple-900/30">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">AI Producer — Admin</h1>
              <p className="text-xs text-muted-foreground">
                Testing console for reviews and credits. No payment integration.
              </p>
            </div>
          </div>
          <Link href="/admin">
            <Button variant="outline" size="sm">
              ← Admin home
            </Button>
          </Link>
        </header>

        {/* ─── 1. All Reviews ───────────────────────────────────────── */}
        <section className="rounded-2xl border border-border/50 bg-card/40">
          <div className="p-5 sm:p-6 border-b border-border/50 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold">All Reviews</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Most recent 500 reviews across all users.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={refreshReviews}
              disabled={reviewsLoading}
            >
              {reviewsLoading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              Refresh
            </Button>
          </div>

          <div className="p-5 sm:p-6">
            {reviewsError && (
              <div className="flex items-start gap-2 text-sm text-red-200 bg-red-500/10 border border-red-400/30 rounded-lg px-3 py-2 mb-4">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{reviewsError}</span>
              </div>
            )}

            {reviewsLoading && reviews.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
                <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading reviews…
              </div>
            ) : reviews.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                No reviews yet.
              </div>
            ) : (
              <div className="overflow-x-auto -mx-5 sm:-mx-6">
                <table className="min-w-full text-sm">
                  <thead className="text-xs uppercase tracking-wider text-muted-foreground">
                    <tr className="border-b border-border/40">
                      <th className="text-left font-medium px-4 py-2">User</th>
                      <th className="text-left font-medium px-4 py-2">Title</th>
                      <th className="text-left font-medium px-4 py-2">Status</th>
                      <th className="text-left font-medium px-4 py-2">Access</th>
                      <th className="text-left font-medium px-4 py-2">Credits</th>
                      <th className="text-left font-medium px-4 py-2">Created</th>
                      <th className="text-right font-medium px-4 py-2">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30">
                    {reviews.map((r) => (
                      <tr key={r.id} className="hover:bg-white/5">
                        <td className="px-4 py-2 font-mono text-xs">
                          <div className="text-foreground">{r.owner_email ?? "—"}</div>
                          <div className="text-muted-foreground">{shortId(r.user_id)}</div>
                        </td>
                        <td className="px-4 py-2">{r.title || <span className="text-muted-foreground">Untitled</span>}</td>
                        <td className="px-4 py-2">
                          <span className={`text-[10px] uppercase tracking-wider font-mono px-2 py-0.5 rounded-full border ${
                            r.status === "ready"
                              ? "bg-emerald-500/10 border-emerald-400/30 text-emerald-300"
                              : r.status === "processing"
                              ? "bg-amber-500/10 border-amber-400/30 text-amber-300"
                              : "bg-red-500/10 border-red-400/30 text-red-300"
                          }`}>
                            {r.status}
                          </span>
                        </td>
                        <td className="px-4 py-2">
                          <span className={`text-[10px] uppercase tracking-wider font-mono px-2 py-0.5 rounded-full border ${
                            r.access_type === "full"
                              ? "bg-emerald-500/10 border-emerald-400/30 text-emerald-300"
                              : "bg-purple-500/10 border-purple-400/30 text-purple-300"
                          }`}>
                            {r.access_type}
                          </span>
                        </td>
                        <td className="px-4 py-2 font-mono text-xs">{r.credits_used}</td>
                        <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">
                          {formatDate(r.created_at)}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <Link
                            href={`/ai-producer/reviews/${r.id}`}
                            target="_blank"
                            className="inline-flex items-center gap-1 text-xs text-purple-300 hover:text-purple-200"
                          >
                            Open Review <ExternalLink className="w-3 h-3" />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        {/* ─── 2. User Credits ──────────────────────────────────────── */}
        <section className="rounded-2xl border border-border/50 bg-card/40">
          <div className="p-5 sm:p-6 border-b border-border/50 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Coins className="w-5 h-5 text-purple-300" />
              <div>
                <h2 className="text-xl font-bold">User Credits</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Adjust balances manually. Every change is logged in credit_transactions.
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={refreshCredits}
              disabled={creditsLoading}
            >
              {creditsLoading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              Refresh
            </Button>
          </div>

          {/* Grant credits to any user */}
          <div className="p-5 sm:p-6 border-b border-border/40 bg-purple-500/5">
            <div className="text-xs uppercase tracking-wider text-muted-foreground font-mono mb-2">
              Grant credits to a user
            </div>
            <form
              onSubmit={handleGrantNew}
              className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-end"
            >
              <div className="flex-1">
                <label className="text-[11px] text-muted-foreground">User ID (UUID)</label>
                <input
                  type="text"
                  value={grantUserId}
                  onChange={(e) => setGrantUserId(e.target.value)}
                  placeholder="00000000-0000-0000-0000-000000000000"
                  className="mt-1 w-full px-3 py-2 rounded-lg bg-background/60 border border-border/50 focus:border-purple-400/60 focus:outline-none text-sm font-mono"
                />
              </div>
              <div className="w-full sm:w-32">
                <label className="text-[11px] text-muted-foreground">Amount</label>
                <input
                  type="number"
                  min={0}
                  value={grantAmount}
                  onChange={(e) => setGrantAmount(e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-lg bg-background/60 border border-border/50 focus:border-purple-400/60 focus:outline-none text-sm"
                />
              </div>
              <Button
                type="submit"
                disabled={grantBusy}
                className="bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:opacity-90 text-white"
              >
                {grantBusy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                Grant
              </Button>
            </form>
            {grantError && (
              <div className="mt-2 text-xs text-red-300 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" /> {grantError}
              </div>
            )}
          </div>

          <div className="p-5 sm:p-6">
            {creditsError && (
              <div className="flex items-start gap-2 text-sm text-red-200 bg-red-500/10 border border-red-400/30 rounded-lg px-3 py-2 mb-4">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{creditsError}</span>
              </div>
            )}

            {creditsLoading && credits.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
                <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading balances…
              </div>
            ) : credits.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                No credit balances yet. Use the form above to grant credits.
              </div>
            ) : (
              <div className="overflow-x-auto -mx-5 sm:-mx-6">
                <table className="min-w-full text-sm">
                  <thead className="text-xs uppercase tracking-wider text-muted-foreground">
                    <tr className="border-b border-border/40">
                      <th className="text-left font-medium px-4 py-2">User</th>
                      <th className="text-left font-medium px-4 py-2">Balance</th>
                      <th className="text-left font-medium px-4 py-2">Updated</th>
                      <th className="text-right font-medium px-4 py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30">
                    {credits.map((c) => {
                      const busy = pendingUserId === c.user_id
                      const flash = flashUserId === c.user_id
                      const customRaw = customAmounts[c.user_id] ?? ""
                      const customNum = Number(customRaw)
                      const customValid = customRaw !== "" && Number.isFinite(customNum) && customNum >= 0
                      return (
                        <tr key={c.user_id} className={`align-top ${flash ? "bg-emerald-500/5" : "hover:bg-white/5"}`}>
                          <td className="px-4 py-2 font-mono text-xs">
                            <div className="text-foreground">{c.owner_email ?? "—"}</div>
                            <div className="text-muted-foreground">{shortId(c.user_id)}</div>
                          </td>
                          <td className="px-4 py-2">
                            <div className="inline-flex items-center gap-1 text-base font-semibold">
                              {c.credits_balance}
                              {flash && <Check className="w-4 h-4 text-emerald-300" />}
                            </div>
                          </td>
                          <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">
                            {formatDate(c.updated_at)}
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex flex-wrap items-center gap-1.5 justify-end">
                              <Button
                                size="sm" variant="outline"
                                disabled={busy}
                                onClick={() => adjustCredits(c.user_id, "add", 1)}
                              >+1</Button>
                              <Button
                                size="sm" variant="outline"
                                disabled={busy}
                                onClick={() => adjustCredits(c.user_id, "add", 5)}
                              >+5</Button>
                              <Button
                                size="sm" variant="outline"
                                disabled={busy}
                                onClick={() => adjustCredits(c.user_id, "add", 10)}
                              >+10</Button>
                              <input
                                type="number"
                                min={0}
                                placeholder="Set…"
                                value={customRaw}
                                onChange={(e) =>
                                  setCustomAmounts((prev) => ({ ...prev, [c.user_id]: e.target.value }))
                                }
                                className="w-20 px-2 py-1 rounded-md bg-background/60 border border-border/50 text-sm"
                              />
                              <Button
                                size="sm" variant="outline"
                                disabled={busy || !customValid}
                                onClick={() => {
                                  if (!customValid) return
                                  adjustCredits(c.user_id, "set", Math.trunc(customNum))
                                  setCustomAmounts((prev) => ({ ...prev, [c.user_id]: "" }))
                                }}
                              >Set</Button>
                              <Button
                                size="sm" variant="outline"
                                disabled={busy}
                                className="text-red-300 hover:text-red-200 border-red-400/30 hover:bg-red-500/10"
                                onClick={() => {
                                  if (confirm(`Reset balance for ${c.owner_email ?? c.user_id} to 0?`)) {
                                    adjustCredits(c.user_id, "reset")
                                  }
                                }}
                              >
                                <RotateCcw className="w-3.5 h-3.5 mr-1" /> Reset
                              </Button>
                              {busy && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
