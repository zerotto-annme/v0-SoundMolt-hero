"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { X, Upload, Music, Image as ImageIcon, FileAudio, Loader2, Check, AlertCircle, Download, Lock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { usePlayer, type Track } from "./player-context"
import { supabase } from "@/lib/supabase"
import Image from "next/image"

interface UploadTrackModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}

function guessMime(ext: string): string {
  const map: Record<string, string> = {
    wav: "audio/wav", mp3: "audio/mpeg", flac: "audio/flac",
    aac: "audio/aac", ogg: "audio/ogg", m4a: "audio/mp4",
  }
  return map[ext] || "audio/wav"
}

const GENRES = [
  { id: "lofi", name: "Lo-Fi" },
  { id: "techno", name: "Techno" },
  { id: "ambient", name: "Ambient" },
  { id: "synthwave", name: "Synthwave" },
  { id: "trap", name: "Trap" },
  { id: "cinematic", name: "Cinematic" },
  { id: "electronic", name: "Electronic" },
  { id: "house", name: "House" },
  { id: "dnb", name: "Drum & Bass" },
  { id: "experimental", name: "Experimental" },
]

export function UploadTrackModal({ isOpen, onClose, onSuccess }: UploadTrackModalProps) {
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [coverPreview, setCoverPreview] = useState<string | null>(null)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [genre, setGenre] = useState("")
  const [downloadEnabled, setDownloadEnabled] = useState(true)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState("")
  const [errors, setErrors] = useState<{ audio?: string; cover?: string; title?: string; submit?: string }>({})
  const [isDraggingAudio, setIsDraggingAudio] = useState(false)
  const [isDraggingCover, setIsDraggingCover] = useState(false)
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false)

  const audioInputRef = useRef<HTMLInputElement>(null)
  const coverInputRef = useRef<HTMLInputElement>(null)
  const { addCreatedTrack, playTrack } = usePlayer()

  // Check if user has entered any data
  const hasUnsavedData = audioFile !== null || coverFile !== null || title.trim() !== "" || description.trim() !== "" || genre !== ""

  // Handle close with confirmation if there's unsaved data
  const handleCloseRequest = useCallback(() => {
    if (isUploading) return
    
    if (hasUnsavedData) {
      setShowDiscardConfirm(true)
    } else {
      handleClose()
    }
  }, [hasUnsavedData, isUploading])

  // Handle ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && !isUploading) {
        e.preventDefault()
        handleCloseRequest()
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [isOpen, isUploading, handleCloseRequest])

  const SUPPORTED_AUDIO_TYPES = [
    "audio/wav", "audio/x-wav",
    "audio/mpeg", "audio/mp3",
    "audio/flac", "audio/x-flac",
    "audio/aac",
    "audio/ogg",
    "audio/mp4", // .m4a
  ]
  const SUPPORTED_AUDIO_EXTENSIONS = [".wav", ".mp3", ".flac", ".aac", ".ogg", ".m4a"]

  const validateAudioFile = (file: File): boolean => {
    const name = file.name.toLowerCase()
    const hasValidExt = SUPPORTED_AUDIO_EXTENSIONS.some(ext => name.endsWith(ext))
    const hasValidType = file.type === "" || SUPPORTED_AUDIO_TYPES.includes(file.type)
    if (!hasValidExt && !hasValidType) {
      setErrors(prev => ({ ...prev, audio: "Unsupported format. Please upload WAV, MP3, FLAC, AAC, OGG, or M4A." }))
      return false
    }
    setErrors(prev => ({ ...prev, audio: undefined }))
    return true
  }

  const validateCoverFile = (file: File): boolean => {
    const validTypes = ['image/jpeg', 'image/png', 'image/webp']
    if (!validTypes.includes(file.type)) {
      setErrors(prev => ({ ...prev, cover: "Please upload a valid image (JPG, PNG, or WebP)" }))
      return false
    }
    setErrors(prev => ({ ...prev, cover: undefined }))
    return true
  }

  const handleAudioSelect = (file: File) => {
    if (validateAudioFile(file)) {
      setAudioFile(file)
    }
  }

  const handleCoverSelect = (file: File) => {
    if (validateCoverFile(file)) {
      setCoverFile(file)
      const reader = new FileReader()
      reader.onload = (e) => {
        setCoverPreview(e.target?.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  const handleAudioDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDraggingAudio(false)
    const file = e.dataTransfer.files[0]
    if (file) handleAudioSelect(file)
  }, [])

  const handleCoverDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDraggingCover(false)
    const file = e.dataTransfer.files[0]
    if (file) handleCoverSelect(file)
  }, [])

  const handleUpload = async () => {
    const newErrors: { audio?: string; cover?: string; title?: string; submit?: string } = {}

    if (!audioFile) newErrors.audio = "Audio file is required"
    if (!coverFile) newErrors.cover = "Cover image is required"
    if (!title.trim()) newErrors.title = "Track title is required"

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      setErrors({ submit: "You must be signed in to upload a track." })
      return
    }

    setIsUploading(true)
    setUploadStatus("Preparing upload…")

    try {
      const userId = session.user.id
      const timestamp = Date.now()
      const originalName = audioFile!.name
      const audioExt = originalName.split('.').pop()?.toLowerCase() || 'wav'
      const originalMime = audioFile!.type || guessMime(audioExt)
      const isWavFile =
        audioExt === "wav" ||
        originalMime === "audio/wav" ||
        originalMime === "audio/x-wav"

      // ── Step 1: Upload original file to originals/ (never modified) ──────
      setUploadStatus("Uploading original…")
      const originalPath = `originals/${userId}/${timestamp}.${audioExt}`
      const { error: origError } = await supabase.storage
        .from("audio")
        .upload(originalPath, audioFile!, { upsert: false, contentType: originalMime })

      if (origError) {
        setErrors({ submit: `Audio upload failed: ${origError.message}` })
        return
      }
      const { data: origPublic } = supabase.storage.from("audio").getPublicUrl(originalPath)
      const originalAudioUrl = origPublic.publicUrl

      console.log(`[upload] Original file: ${audioFile!.size} bytes → ${originalAudioUrl}`)

      // ── Step 2: Generate the streaming version ───────────────────────────
      let streamAudioUrl = originalAudioUrl // fallback: stream = original

      if (isWavFile) {
        // WAV → MP3 via server-side ffmpeg (reliable, real encoding)
        setUploadStatus("Transcoding to MP3…")
        try {
          const transcodeRes = await fetch("/api/transcode", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              wavUrl: originalAudioUrl,
              userId,
              timestamp,
            }),
          })

          if (!transcodeRes.ok) {
            const errData = await transcodeRes.json().catch(() => ({}))
            console.warn(
              `[upload] Transcoding API error ${transcodeRes.status}:`,
              errData
            )
            // Non-fatal: use original WAV for streaming
          } else {
            const mp3Blob = await transcodeRes.blob()
            console.log(`[upload] MP3 received: ${mp3Blob.size} bytes`)

            // Validate: real MP3s are always larger than 10 KB
            if (mp3Blob.size < 10 * 1024) {
              console.warn(
                `[upload] MP3 too small (${mp3Blob.size} bytes) — rejecting, using original WAV for stream`
              )
            } else {
              setUploadStatus("Uploading stream…")
              const streamPath = `streams/${userId}/${timestamp}.mp3`
              const { error: streamError } = await supabase.storage
                .from("audio")
                .upload(streamPath, mp3Blob, {
                  upsert: false,
                  contentType: "audio/mpeg",
                })

              if (streamError) {
                console.warn("[upload] Stream upload failed:", streamError.message)
              } else {
                const { data: streamPublic } = supabase.storage
                  .from("audio")
                  .getPublicUrl(streamPath)
                streamAudioUrl = streamPublic.publicUrl
                console.log(`[upload] Stream URL: ${streamAudioUrl}`)
              }
            }
          }
        } catch (transcodeErr) {
          // Non-fatal: network error or API crash — use original WAV for streaming
          console.warn("[upload] Transcoding request failed:", transcodeErr)
        }
      } else {
        // Non-WAV (MP3, FLAC, etc.) — copy to streams/ with same format
        setUploadStatus("Uploading stream…")
        const streamPath = `streams/${userId}/${timestamp}.${audioExt}`
        const { error: streamError } = await supabase.storage
          .from("audio")
          .upload(streamPath, audioFile!, { upsert: false, contentType: originalMime })
        if (!streamError) {
          const { data: streamPublic } = supabase.storage
            .from("audio")
            .getPublicUrl(streamPath)
          streamAudioUrl = streamPublic.publicUrl
        }
      }

      console.log(
        `[upload] Playback URL (stream): ${streamAudioUrl} | Download URL (original): ${originalAudioUrl}`
      )

      // ── Step 3: Upload cover image ────────────────────────────────────────
      setUploadStatus("Uploading cover…")
      let coverUrl: string | null = null
      if (coverFile) {
        const coverExt = coverFile.name.split('.').pop() || 'jpg'
        const coverPath = `${userId}/${timestamp}.${coverExt}`
        const { error: coverError } = await supabase.storage
          .from("covers")
          .upload(coverPath, coverFile, { upsert: false, contentType: coverFile.type })

        if (coverError) {
          setErrors({ submit: `Cover upload failed: ${coverError.message}` })
          return
        }
        const { data: coverPublic } = supabase.storage.from("covers").getPublicUrl(coverPath)
        coverUrl = coverPublic.publicUrl
      }

      // ── Step 4: Insert track into database ───────────────────────────────
      setUploadStatus("Saving track…")
      const { data: inserted, error: dbError } = await supabase
        .from("tracks")
        .insert({
          user_id: userId,
          title: title.trim(),
          style: genre || null,
          description: description.trim() || null,
          // audio_url = stream URL for backward-compat UI that only knows audio_url
          audio_url: streamAudioUrl,
          original_audio_url: originalAudioUrl,
          stream_audio_url: streamAudioUrl,
          original_filename: originalName,
          original_mime_type: originalMime,
          original_file_size: audioFile!.size,
          cover_url: coverUrl,
          download_enabled: downloadEnabled,
          source_type: "uploaded",
        })
        .select()
        .single()

      if (dbError) {
        setErrors({ submit: `Failed to save track: ${dbError.message}` })
        return
      }

      // ── Step 5: Publish to player for immediate playback ─────────────────
      const newTrack: Track = {
        id: inserted.id,
        title: inserted.title,
        agentName: session.user.user_metadata?.username || session.user.email?.split("@")[0] || "You",
        modelType: "Uploaded",
        modelProvider: "user",
        coverUrl: inserted.cover_url || "",
        // Player uses the stream URL (MP3 or original for non-WAV)
        audioUrl: streamAudioUrl,
        originalAudioUrl: originalAudioUrl,
        originalFilename: originalName,
        originalMimeType: originalMime,
        originalFileSize: audioFile!.size,
        duration: 0,
        plays: 0,
        style: inserted.style || undefined,
        sourceType: "uploaded" as const,
        description: inserted.description || undefined,
        downloadEnabled: inserted.download_enabled,
        createdAt: new Date(inserted.created_at).getTime(),
      }

      addCreatedTrack(newTrack)
      playTrack(newTrack)
      onSuccess?.()
      handleClose()
    } catch (err) {
      setErrors({ submit: err instanceof Error ? err.message : "Upload failed. Please try again." })
    } finally {
      setIsUploading(false)
      setUploadStatus("")
    }
  }

  const handleClose = useCallback(() => {
    setAudioFile(null)
    setCoverFile(null)
    setCoverPreview(null)
    setTitle("")
    setDescription("")
    setGenre("")
    setDownloadEnabled(true)
    setErrors({})
    setIsUploading(false)
    setUploadStatus("")
    setShowDiscardConfirm(false)
    onClose()
  }, [onClose])

  const handleDiscardConfirm = () => {
    setShowDiscardConfirm(false)
    handleClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop - no onClick to prevent accidental closing */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
      
      {/* Modal */}
      <div className="relative w-full max-w-lg mx-4 bg-card border border-border/50 rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
        {/* Header gradient */}
        <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-br from-glow-secondary/20 via-transparent to-glow-primary/20 pointer-events-none" />
        
        {/* Close button */}
        <button
          onClick={handleCloseRequest}
          disabled={isUploading}
          className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors z-10 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <X className="w-4 h-4 text-white" />
        </button>

        <div className="relative p-6 space-y-5">
          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-glow-secondary to-cyan-500 flex items-center justify-center">
              <Upload className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground">Upload Track</h2>
              <p className="text-sm text-muted-foreground">Share your music on SoundMolt</p>
            </div>
          </div>

          {/* Audio File Upload */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground flex items-center gap-2">
              <FileAudio className="w-4 h-4 text-glow-secondary" />
              Audio File <span className="text-red-400">*</span>
            </label>
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDraggingAudio(true) }}
              onDragLeave={() => setIsDraggingAudio(false)}
              onDrop={handleAudioDrop}
              onClick={() => audioInputRef.current?.click()}
              className={`relative border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
                isDraggingAudio
                  ? "border-glow-secondary bg-glow-secondary/10"
                  : audioFile
                    ? "border-emerald-500/50 bg-emerald-500/5"
                    : errors.audio
                      ? "border-red-500/50 bg-red-500/5"
                      : "border-border/50 hover:border-glow-secondary/50 hover:bg-glow-secondary/5"
              }`}
            >
              <input
                ref={audioInputRef}
                type="file"
                accept=".wav,.mp3,.flac,.aac,.ogg,.m4a,audio/*"
                onChange={(e) => e.target.files?.[0] && handleAudioSelect(e.target.files[0])}
                className="hidden"
              />
              {audioFile ? (
                <div className="flex items-center justify-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                    <Check className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-medium text-foreground truncate max-w-[200px]">{audioFile.name}</p>
                    <p className="text-xs text-muted-foreground">{(audioFile.size / (1024 * 1024)).toFixed(2)} MB</p>
                  </div>
                </div>
              ) : (
                <>
                  <FileAudio className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">Drag and drop or click to upload</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">WAV, MP3, FLAC, AAC, OGG, M4A</p>
                </>
              )}
            </div>
            {errors.audio && (
              <p className="text-xs text-red-400 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {errors.audio}
              </p>
            )}
          </div>

          {/* Cover Image Upload */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-glow-secondary" />
              Cover Image <span className="text-red-400">*</span>
            </label>
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDraggingCover(true) }}
              onDragLeave={() => setIsDraggingCover(false)}
              onDrop={handleCoverDrop}
              onClick={() => coverInputRef.current?.click()}
              className={`relative border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all ${
                isDraggingCover
                  ? "border-glow-secondary bg-glow-secondary/10"
                  : coverPreview
                    ? "border-emerald-500/50 bg-emerald-500/5"
                    : errors.cover
                      ? "border-red-500/50 bg-red-500/5"
                      : "border-border/50 hover:border-glow-secondary/50 hover:bg-glow-secondary/5"
              }`}
            >
              <input
                ref={coverInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => e.target.files?.[0] && handleCoverSelect(e.target.files[0])}
                className="hidden"
              />
              {coverPreview ? (
                <div className="flex items-center gap-4">
                  <div className="w-20 h-20 rounded-lg overflow-hidden flex-shrink-0 ring-2 ring-emerald-500/30">
                    <Image
                      src={coverPreview}
                      alt="Cover preview"
                      width={80}
                      height={80}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-medium text-foreground truncate max-w-[200px]">{coverFile?.name}</p>
                    <p className="text-xs text-emerald-400">Click to change</p>
                  </div>
                </div>
              ) : (
                <>
                  <ImageIcon className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">Upload cover art</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">JPG, PNG, or WebP</p>
                </>
              )}
            </div>
            {errors.cover && (
              <p className="text-xs text-red-400 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {errors.cover}
              </p>
            )}
          </div>

          {/* Track Title */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground flex items-center gap-2">
              <Music className="w-4 h-4 text-glow-secondary" />
              Track Title <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value)
                if (e.target.value.trim()) setErrors(prev => ({ ...prev, title: undefined }))
              }}
              placeholder="Enter track title"
              className={`w-full h-11 px-4 bg-secondary/50 border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-glow-secondary/50 focus:ring-2 focus:ring-glow-secondary/20 ${
                errors.title ? "border-red-500/50" : "border-border/50"
              }`}
            />
            {errors.title && (
              <p className="text-xs text-red-400 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {errors.title}
              </p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Description <span className="text-muted-foreground text-xs">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, 500))}
              placeholder="Tell listeners about your track..."
              rows={3}
              className="w-full px-4 py-3 bg-secondary/50 border border-border/50 rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-glow-secondary/50 focus:ring-2 focus:ring-glow-secondary/20 resize-none"
            />
            <div className="flex justify-end">
              <span className="text-xs text-muted-foreground">{description.length}/500</span>
            </div>
          </div>

          {/* Genre */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Genre / Style <span className="text-muted-foreground text-xs">(optional)</span>
            </label>
            <select
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
              className="w-full h-11 px-4 bg-secondary/50 border border-border/50 rounded-xl text-foreground focus:outline-none focus:border-glow-secondary/50 focus:ring-2 focus:ring-glow-secondary/20 cursor-pointer"
            >
              <option value="">Select a genre</option>
              {GENRES.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>

          {/* Download Permission */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground flex items-center gap-2">
              <Download className="w-4 h-4 text-glow-secondary" />
              Download Permission
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDownloadEnabled(true)}
                className={`flex-1 flex items-center justify-center gap-2 h-11 rounded-xl border transition-all ${
                  downloadEnabled 
                    ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-400" 
                    : "bg-secondary/50 border-border/50 text-muted-foreground hover:border-emerald-500/30"
                }`}
              >
                <Download className="w-4 h-4" />
                <span className="text-sm font-medium">Allow downloads</span>
              </button>
              <button
                type="button"
                onClick={() => setDownloadEnabled(false)}
                className={`flex-1 flex items-center justify-center gap-2 h-11 rounded-xl border transition-all ${
                  !downloadEnabled 
                    ? "bg-red-500/20 border-red-500/50 text-red-400" 
                    : "bg-secondary/50 border-border/50 text-muted-foreground hover:border-red-500/30"
                }`}
              >
                <Lock className="w-4 h-4" />
                <span className="text-sm font-medium">Disable downloads</span>
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Track owner decides whether this track can be downloaded by users.
            </p>
          </div>

          {/* Submit error */}
          {errors.submit && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/30">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-400">{errors.submit}</p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-3 pt-2">
            <Button
              onClick={handleCloseRequest}
              disabled={isUploading}
              variant="outline"
              className="flex-1 h-12 rounded-xl border-border/50"
            >
              Cancel
            </Button>
            <Button
              onClick={handleUpload}
              disabled={isUploading}
              className="flex-1 h-12 bg-gradient-to-r from-glow-secondary to-cyan-500 hover:opacity-90 text-white font-semibold rounded-xl"
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  <span className="truncate">{uploadStatus || "Uploading…"}</span>
                </>
              ) : (
                <>
                  <Upload className="w-5 h-5 mr-2" />
                  Upload Track
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Discard Confirmation Dialog */}
      {showDiscardConfirm && (
        <div className="absolute inset-0 z-60 flex items-center justify-center">
          <div 
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowDiscardConfirm(false)}
          />
          <div className="relative bg-card border border-border/50 rounded-xl shadow-2xl p-6 mx-4 max-w-sm w-full animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-lg font-semibold text-foreground mb-2">
              Are you sure you want to discard this track?
            </h3>
            <p className="text-sm text-muted-foreground mb-6">
              All entered data will be lost.
            </p>
            <div className="flex gap-3">
              <Button
                onClick={() => setShowDiscardConfirm(false)}
                variant="outline"
                className="flex-1 h-10 rounded-lg border-border/50"
              >
                Stay
              </Button>
              <Button
                onClick={handleDiscardConfirm}
                className="flex-1 h-10 rounded-lg bg-red-500 hover:bg-red-600 text-white"
              >
                Discard
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
