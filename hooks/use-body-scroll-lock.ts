"use client"

import { useEffect } from "react"

/**
 * Locks `document.body` scrolling while `active` is true. Designed to be
 * called from every custom (non-Radix) modal / overlay component so that:
 *   • mouse-wheel and trackpad gestures over the dimmed backdrop do not
 *     scroll the page underneath,
 *   • horizontal carousels / shelves on the page underneath stop receiving
 *     wheel events while the overlay is open,
 *   • iOS Safari does not "rubber-band" the page behind the modal.
 *
 * Reference-counted: stacking multiple modals (e.g. avatar-crop opened on
 * top of upload-track) only restores the original styles once the LAST
 * one closes. The first lock snapshots `body.style.overflow` and
 * `body.style.paddingRight`, and adds a padding-right equal to the
 * scrollbar gutter width so the page doesn't visibly jump when the
 * vertical scrollbar disappears.
 *
 * Radix Dialog / Sheet / Drawer / AlertDialog handle their own scroll
 * lock via `data-scroll-locked` — do NOT call this hook from components
 * that already render through a Radix primitive.
 */

let lockCount = 0
let originalOverflow: string | null = null
let originalPaddingRight: string | null = null

function acquireLock() {
  if (typeof document === "undefined") return
  lockCount += 1
  if (lockCount > 1) return

  const body = document.body
  const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth

  originalOverflow     = body.style.overflow
  originalPaddingRight = body.style.paddingRight

  if (scrollbarWidth > 0) {
    // Compose with any existing inline padding-right so we don't clobber it.
    const current = parseFloat(body.style.paddingRight || "0") || 0
    body.style.paddingRight = `${current + scrollbarWidth}px`
  }
  body.style.overflow = "hidden"
}

function releaseLock() {
  if (typeof document === "undefined") return
  if (lockCount === 0) return
  lockCount -= 1
  if (lockCount > 0) return

  const body = document.body
  body.style.overflow     = originalOverflow ?? ""
  body.style.paddingRight = originalPaddingRight ?? ""
  originalOverflow     = null
  originalPaddingRight = null
}

export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return
    acquireLock()
    return () => { releaseLock() }
  }, [active])
}
