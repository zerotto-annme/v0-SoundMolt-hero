"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"

interface HorizontalShelfProps {
  children: ReactNode
  ariaLabel?: string
  gap?: number
  className?: string
}

export function HorizontalShelf({
  children,
  ariaLabel = "shelf",
  gap = 16,
  className = "",
}: HorizontalShelfProps) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [showLeftFade, setShowLeftFade] = useState(false)
  const [showRightFade, setShowRightFade] = useState(true)
  const [isTouchDevice, setIsTouchDevice] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined") return
    const mq = window.matchMedia("(hover: none), (pointer: coarse)")
    const update = () => setIsTouchDevice(mq.matches)
    update()
    mq.addEventListener?.("change", update)
    return () => mq.removeEventListener?.("change", update)
  }, [])

  const scrollByCard = useCallback(
    (direction: 1 | -1) => {
      const el = scrollerRef.current
      if (!el) return
      const firstCard = el.querySelector<HTMLElement>("[data-shelf-item]")
        ?? (el.firstElementChild as HTMLElement | null)
      const cardWidth = firstCard ? firstCard.offsetWidth + gap : Math.round(el.clientWidth * 0.8)
      el.scrollBy({ left: direction * cardWidth, behavior: "smooth" })
    },
    [gap],
  )

  const updateFades = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    const { scrollLeft, scrollWidth, clientWidth } = el
    setShowLeftFade(scrollLeft > 4)
    setShowRightFade(scrollLeft + clientWidth < scrollWidth - 4)
  }, [])

  useEffect(() => {
    updateFades()
    const el = scrollerRef.current
    if (!el) return
    const onScroll = () => updateFades()
    // Wheel policy for horizontal shelves:
    //   • Vertical-dominant wheel (mouse wheel, vertical trackpad gesture)
    //     must NEVER be translated into horizontal scroll. We previously
    //     did `el.scrollLeft += e.deltaY` here, which (a) hijacked normal
    //     page scrolling on top of every shelf and (b) caused the
    //     "carousel slides left/right while a modal is open" bug, because
    //     wheel events landing on shelf area (outside the modal panel)
    //     would still move the shelf instead of doing nothing.
    //   • We also stopPropagation so an ancestor wheel hijacker (e.g.
    //     MusicFeed's snap-to-next-card handler) doesn't mistake a stray
    //     scroll-over-shelf for a navigation gesture.
    //   • Horizontal-dominant input (trackpad two-finger horizontal swipe,
    //     Shift+wheel — browsers convert Shift+wheel to deltaX) is left
    //     to the browser's native overflow-x scrolling. We do nothing.
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.stopPropagation()
        return
      }
    }
    el.addEventListener("scroll", onScroll, { passive: true })
    el.addEventListener("wheel", onWheel, { passive: false })
    window.addEventListener("resize", updateFades)
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => updateFades()) : null
    ro?.observe(el)
    return () => {
      el.removeEventListener("scroll", onScroll)
      el.removeEventListener("wheel", onWheel)
      window.removeEventListener("resize", updateFades)
      ro?.disconnect()
    }
  }, [updateFades, children])

  return (
    <div className={`relative group/scroller ${className}`}>
      <div
        ref={scrollerRef}
        className="flex gap-4 overflow-x-auto overflow-y-hidden scroll-smooth scrollbar-hide -mx-4 px-4 pb-2"
      >
        {children}
      </div>

      <div
        aria-hidden
        className={`pointer-events-none absolute left-0 top-0 bottom-2 w-12 bg-gradient-to-r from-background to-transparent transition-opacity duration-300 ${
          showLeftFade ? "opacity-100" : "opacity-0"
        }`}
      />
      <div
        aria-hidden
        className={`pointer-events-none absolute right-0 top-0 bottom-2 w-16 bg-gradient-to-l from-background to-transparent transition-opacity duration-300 ${
          showRightFade ? "opacity-100" : "opacity-0"
        }`}
      />

      {!isTouchDevice && (
        <>
          <button
            type="button"
            aria-label={`Scroll ${ariaLabel} left`}
            onClick={() => scrollByCard(-1)}
            className={`hidden md:flex items-center justify-center absolute left-2 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-background/80 backdrop-blur border border-border/50 text-foreground shadow-lg transition-all duration-200 hover:bg-background hover:scale-105 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-glow-primary/50 ${
              showLeftFade
                ? "opacity-0 group-hover/scroller:opacity-100 pointer-events-none group-hover/scroller:pointer-events-auto"
                : "opacity-0 pointer-events-none"
            }`}
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            type="button"
            aria-label={`Scroll ${ariaLabel} right`}
            onClick={() => scrollByCard(1)}
            className={`hidden md:flex items-center justify-center absolute right-2 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-background/80 backdrop-blur border border-border/50 text-foreground shadow-lg transition-all duration-200 hover:bg-background hover:scale-105 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-glow-primary/50 ${
              showRightFade
                ? "opacity-0 group-hover/scroller:opacity-100 pointer-events-none group-hover/scroller:pointer-events-auto"
                : "opacity-0 pointer-events-none"
            }`}
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </>
      )}
    </div>
  )
}
