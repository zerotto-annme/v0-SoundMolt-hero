"use client"

import { useCallback, useRef, useState } from "react"
import ReactCrop, { type Crop, centerCrop, makeAspectCrop } from "react-image-crop"
import "react-image-crop/dist/ReactCrop.css"
import { X, Check, CropIcon } from "lucide-react"

interface AvatarCropModalProps {
  imageSrc: string
  onConfirm: (croppedBlob: Blob) => void
  onCancel: () => void
}

function centerSquareCrop(width: number, height: number): Crop {
  return centerCrop(
    makeAspectCrop({ unit: "%", width: 80 }, 1, width, height),
    width,
    height
  )
}

async function getCroppedBlob(
  image: HTMLImageElement,
  crop: Crop
): Promise<Blob> {
  const canvas = document.createElement("canvas")
  const scaleX = image.naturalWidth / image.width
  const scaleY = image.naturalHeight / image.height

  const pixelRatio = window.devicePixelRatio || 1
  const outputSize = 512

  canvas.width = outputSize
  canvas.height = outputSize

  const ctx = canvas.getContext("2d")!
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
  ctx.imageSmoothingQuality = "high"

  const cropX = (crop.x / 100) * image.width * scaleX
  const cropY = (crop.y / 100) * image.height * scaleY
  const cropWidth = (crop.width / 100) * image.width * scaleX
  const cropHeight = (crop.height / 100) * image.height * scaleY

  ctx.drawImage(
    image,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    0,
    0,
    outputSize / pixelRatio,
    outputSize / pixelRatio
  )

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error("Canvas is empty"))
      },
      "image/jpeg",
      0.92
    )
  })
}

export function AvatarCropModal({ imageSrc, onConfirm, onCancel }: AvatarCropModalProps) {
  const imgRef = useRef<HTMLImageElement>(null)
  const [crop, setCrop] = useState<Crop>()
  const [isProcessing, setIsProcessing] = useState(false)
  const [exportError, setExportError] = useState(false)

  const onImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const { width, height } = e.currentTarget
    setCrop(centerSquareCrop(width, height))
  }, [])

  const handleConfirm = async () => {
    if (!imgRef.current || !crop) return
    setIsProcessing(true)
    setExportError(false)
    try {
      const blob = await getCroppedBlob(imgRef.current, crop)
      onConfirm(blob)
    } catch {
      setExportError(true)
      setIsProcessing(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm"
    >
      <div
        className="relative w-full max-w-lg mx-4 bg-[#111113] border border-white/10 rounded-2xl p-6 flex flex-col gap-5"
      >
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
            <p className="text-xs text-white/40">Drag to adjust the square crop area</p>
          </div>
        </div>

        <div className="flex items-center justify-center bg-black/40 rounded-xl overflow-hidden max-h-[60vh]">
          <ReactCrop
            crop={crop}
            onChange={(_, pct) => setCrop(pct)}
            aspect={1}
            circularCrop
            keepSelection
            className="max-h-[56vh]"
          >
            <img
              ref={imgRef}
              src={imageSrc}
              alt="Crop preview"
              onLoad={onImageLoad}
              style={{ maxHeight: "56vh", maxWidth: "100%", display: "block" }}
            />
          </ReactCrop>
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
            disabled={!crop || isProcessing}
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
