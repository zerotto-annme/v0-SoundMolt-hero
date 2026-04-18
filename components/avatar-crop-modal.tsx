"use client"

import { useCallback, useRef, useState } from "react"
import { X, Check, CropIcon, ZoomIn, ZoomOut } from "lucide-react"

const MAX_ZOOM = 4
const CROP_FRACTION = 0.78

export interface CropState {
  zoom: number
  panX: number
  panY: number
}

interface AvatarCropModalProps {
  imageSrc: string
  initialState?: CropState
  onStateChange?: (state: CropState) => void
  onConfirm: (croppedBlob: Blob) => void
  onCancel: () => void
}

async function getCroppedBlob(
  imageSrc: string,
  containerW: number,
  containerH: number,
  naturalW: number,
  naturalH: number,
  zoom: number,
  panX: number,
  panY: number,
  cropR: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const fitScale = Math.min(containerW / naturalW, containerH / naturalH)
      const imgLeft = (containerW - naturalW * fitScale * zoom) / 2 + panX
      const imgTop = (containerH - naturalH * fitScale * zoom) / 2 + panY
      const cropLeft = containerW / 2 - cropR
      const cropTop = containerH / 2 - cropR
      const srcX = (cropLeft - imgLeft) / (fitScale * zoom)
      const srcY = (cropTop - imgTop) / (fitScale * zoom)
      const srcSize = (cropR * 2) / (fitScale * zoom)

      const outputSize = 512
      const canvas = document.createElement("canvas")
      canvas.width = outputSize
      canvas.height = outputSize
      const ctx = canvas.getContext("2d")!
      ctx.imageSmoothingQuality = "high"
      ctx.drawImage(img, srcX, srcY, srcSize, srcSize, 0, 0, outputSize, outputSize)

      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob)
          else reject(new Error("Canvas is empty"))
        },
        "image/jpeg",
        0.92
      )
    }
    img.onerror = () => reject(new Error("Failed to load image"))
    img.crossOrigin = "anonymous"
    img.src = imageSrc
  })
}

export function AvatarCropModal({ imageSrc, initialState, onStateChange, onConfirm, onCancel }: AvatarCropModalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const naturalSize = useRef({ w: 0, h: 0 })
  const [zoom, setZoom] = useState(initialState?.zoom ?? 1)
  const [minZoom, setMinZoom] = useState(1)
  const [maxZoom, setMaxZoom] = useState(MAX_ZOOM)
  const [panX, setPanX] = useState(initialState?.panX ?? 0)
  const [panY, setPanY] = useState(initialState?.panY ?? 0)
  const [isProcessing, setIsProcessing] = useState(false)
  const [exportError, setExportError] = useState(false)
  const [imageLoaded, setImageLoaded] = useState(false)

  const isDragging = useRef(false)
  const lastMouse = useRef({ x: 0, y: 0 })
  const lastPinchDist = useRef<number | null>(null)
  const panRef = useRef({ x: initialState?.panX ?? 0, y: initialState?.panY ?? 0 })
  const zoomRef = useRef(initialState?.zoom ?? 1)
  const minZoomRef = useRef(1)
  const maxZoomRef = useRef(MAX_ZOOM)

  const getContainerSize = useCallback(() => {
    const el = containerRef.current
    if (!el) return { w: 1, h: 1 }
    return { w: el.clientWidth, h: el.clientHeight }
  }, [])

  const clampPan = useCallback((x: number, y: number, z: number) => {
    const { w: cW, h: cH } = getContainerSize()
    const { w: nW, h: nH } = naturalSize.current
    if (!nW || !nH) return { x, y }
    const fitScale = Math.min(cW / nW, cH / nH)
    const dW = nW * fitScale * z
    const dH = nH * fitScale * z
    const cropR = Math.min(cW, cH) * CROP_FRACTION / 2
    const maxX = Math.max(0, dW / 2 - cropR)
    const maxY = Math.max(0, dH / 2 - cropR)
    return {
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y)),
    }
  }, [getContainerSize])

  const applyZoom = useCallback((newZoom: number) => {
    const z = Math.max(minZoomRef.current, Math.min(maxZoomRef.current, newZoom))
    zoomRef.current = z
    setZoom(z)
    const clamped = clampPan(panRef.current.x, panRef.current.y, z)
    panRef.current = clamped
    setPanX(clamped.x)
    setPanY(clamped.y)
    onStateChange?.({ zoom: z, panX: clamped.x, panY: clamped.y })
  }, [clampPan, onStateChange])

  const onImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const nW = e.currentTarget.naturalWidth
    const nH = e.currentTarget.naturalHeight
    naturalSize.current = { w: nW, h: nH }
    const { w: cW, h: cH } = getContainerSize()
    const fitScale = Math.min(cW / nW, cH / nH)
    const dW = nW * fitScale
    const dH = nH * fitScale
    const cropR = Math.min(cW, cH) * CROP_FRACTION / 2
    const computed = Math.max(1, (cropR * 2) / Math.min(dW, dH))
    const effectiveMax = Math.max(MAX_ZOOM, computed)
    minZoomRef.current = computed
    maxZoomRef.current = effectiveMax
    setMinZoom(computed)
    setMaxZoom(effectiveMax)

    if (initialState) {
      const z = Math.max(computed, Math.min(effectiveMax, initialState.zoom))
      const clamped = clampPan(initialState.panX, initialState.panY, z)
      zoomRef.current = z
      panRef.current = clamped
      setZoom(z)
      setPanX(clamped.x)
      setPanY(clamped.y)
    } else {
      zoomRef.current = computed
      setZoom(computed)
    }
    setImageLoaded(true)
  }, [getContainerSize, initialState, clampPan])

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    isDragging.current = true
    lastMouse.current = { x: e.clientX, y: e.clientY }
    e.preventDefault()
  }, [])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return
    const dx = e.clientX - lastMouse.current.x
    const dy = e.clientY - lastMouse.current.y
    lastMouse.current = { x: e.clientX, y: e.clientY }
    const newPan = clampPan(panRef.current.x + dx, panRef.current.y + dy, zoomRef.current)
    panRef.current = newPan
    setPanX(newPan.x)
    setPanY(newPan.y)
  }, [clampPan])

  const onMouseUp = useCallback(() => {
    isDragging.current = false
    onStateChange?.({ zoom: zoomRef.current, panX: panRef.current.x, panY: panRef.current.y })
  }, [onStateChange])

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      isDragging.current = true
      lastMouse.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    } else if (e.touches.length === 2) {
      isDragging.current = false
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      lastPinchDist.current = Math.sqrt(dx * dx + dy * dy)
    }
  }, [])

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault()
    if (e.touches.length === 1 && isDragging.current) {
      const dx = e.touches[0].clientX - lastMouse.current.x
      const dy = e.touches[0].clientY - lastMouse.current.y
      lastMouse.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
      const newPan = clampPan(panRef.current.x + dx, panRef.current.y + dy, zoomRef.current)
      panRef.current = newPan
      setPanX(newPan.x)
      setPanY(newPan.y)
    } else if (e.touches.length === 2 && lastPinchDist.current !== null) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      const dist = Math.sqrt(dx * dx + dy * dy)
      const ratio = dist / lastPinchDist.current
      lastPinchDist.current = dist
      applyZoom(zoomRef.current * ratio)
    }
  }, [clampPan, applyZoom])

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (e.touches.length < 2) lastPinchDist.current = null
    if (e.touches.length === 0) {
      isDragging.current = false
      onStateChange?.({ zoom: zoomRef.current, panX: panRef.current.x, panY: panRef.current.y })
    }
  }, [onStateChange])

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY < 0 ? 0.1 : -0.1
    applyZoom(zoomRef.current + delta)
  }, [applyZoom])

  const handleConfirm = async () => {
    const el = containerRef.current
    if (!el || !imageLoaded) return
    setIsProcessing(true)
    setExportError(false)
    try {
      const { w: cW, h: cH } = getContainerSize()
      const cropR = Math.min(cW, cH) * CROP_FRACTION / 2
      const blob = await getCroppedBlob(
        imageSrc, cW, cH,
        naturalSize.current.w, naturalSize.current.h,
        zoom, panX, panY, cropR
      )
      onConfirm(blob)
    } catch {
      setExportError(true)
      setIsProcessing(false)
    }
  }

  const cropDiameterCss = `${CROP_FRACTION * 100}%`

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="relative w-full max-w-lg mx-4 bg-[#111113] border border-white/10 rounded-2xl p-6 flex flex-col gap-5">
        <button
          onClick={onCancel}
          className="absolute top-4 right-4 text-white/40 hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center">
            <CropIcon className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Crop Photo</h2>
            <p className="text-xs text-white/40">Pinch/scroll/slider to zoom · drag to pan</p>
          </div>
        </div>

        <div
          ref={containerRef}
          className="relative bg-black/40 rounded-xl overflow-hidden select-none"
          style={{ aspectRatio: "1 / 1", cursor: isDragging.current ? "grabbing" : "grab" }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onWheel={onWheel}
        >
          <img
            src={imageSrc}
            alt="Crop preview"
            draggable={false}
            onLoad={onImageLoad}
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: `translate(calc(-50% + ${panX}px), calc(-50% + ${panY}px)) scale(${zoom})`,
              transformOrigin: "center center",
              maxWidth: "none",
              width: "100%",
              height: "100%",
              objectFit: "contain",
              pointerEvents: "none",
              userSelect: "none",
            }}
          />

          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                width: cropDiameterCss,
                aspectRatio: "1 / 1",
                borderRadius: "50%",
                boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
                border: "2px solid rgba(255,255,255,0.7)",
              }}
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => applyZoom(zoom - 0.25)}
            disabled={zoom <= minZoom}
            className="text-white/50 hover:text-white disabled:opacity-30 transition-colors"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <input
            type="range"
            min={minZoom}
            max={maxZoom}
            step={0.01}
            value={zoom}
            onChange={(e) => applyZoom(parseFloat(e.target.value))}
            className="flex-1 accent-white h-1 rounded-full"
            aria-label="Zoom level"
          />
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => applyZoom(zoom + 0.25)}
            disabled={zoom >= maxZoom}
            className="text-white/50 hover:text-white disabled:opacity-30 transition-colors"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <span className="text-xs text-white/40 w-10 text-right tabular-nums">
            {zoom.toFixed(1)}×
          </span>
        </div>

        {exportError && (
          <p className="text-xs text-red-400 text-center">
            Could not process the image. Please try a different file.
          </p>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 h-10 rounded-lg border border-white/10 text-white/60 hover:text-white hover:border-white/20 text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!imageLoaded || isProcessing}
            className="flex-1 h-10 rounded-lg bg-white text-black font-medium text-sm hover:bg-white/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Check className="w-4 h-4" />
            {isProcessing ? "Processing…" : "Use this crop"}
          </button>
        </div>
      </div>
    </div>
  )
}
