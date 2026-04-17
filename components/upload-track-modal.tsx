"use client"

import { useState, useRef, useCallback } from "react"
import { X, Upload, Music, Image as ImageIcon, FileAudio, Loader2, Check, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { usePlayer, type Track } from "./player-context"
import Image from "next/image"

interface UploadTrackModalProps {
  isOpen: boolean
  onClose: () => void
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

export function UploadTrackModal({ isOpen, onClose }: UploadTrackModalProps) {
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [coverPreview, setCoverPreview] = useState<string | null>(null)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [genre, setGenre] = useState("")
  const [isUploading, setIsUploading] = useState(false)
  const [errors, setErrors] = useState<{ audio?: string; cover?: string; title?: string }>({})
  const [isDraggingAudio, setIsDraggingAudio] = useState(false)
  const [isDraggingCover, setIsDraggingCover] = useState(false)

  const audioInputRef = useRef<HTMLInputElement>(null)
  const coverInputRef = useRef<HTMLInputElement>(null)
  const { addCreatedTrack, playTrack } = usePlayer()

  const validateAudioFile = (file: File): boolean => {
    if (!file.name.toLowerCase().endsWith('.wav')) {
      setErrors(prev => ({ ...prev, audio: "Only WAV files are supported" }))
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
    // Validate required fields
    const newErrors: { audio?: string; cover?: string; title?: string } = {}
    
    if (!audioFile) {
      newErrors.audio = "Audio file is required"
    }
    if (!coverFile) {
      newErrors.cover = "Cover image is required"
    }
    if (!title.trim()) {
      newErrors.title = "Track title is required"
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    setIsUploading(true)

    // Simulate upload delay
    await new Promise(resolve => setTimeout(resolve, 1500))

    // Create the uploaded track
    const newTrack: Track = {
      id: `uploaded_${Date.now()}`,
      title: title.trim(),
      agentName: "You", // User's own upload
      modelType: "Uploaded",
      modelProvider: "user",
      coverUrl: coverPreview || "",
      audioUrl: URL.createObjectURL(audioFile!),
      duration: 0, // Will be determined when played
      plays: 0,
      style: genre || undefined,
      sourceType: "uploaded" as const,
      description: description.trim() || undefined,
    }

    addCreatedTrack(newTrack)
    setIsUploading(false)
    
    // Play the uploaded track
    playTrack(newTrack)
    handleClose()
  }

  const handleClose = () => {
    setAudioFile(null)
    setCoverFile(null)
    setCoverPreview(null)
    setTitle("")
    setDescription("")
    setGenre("")
    setErrors({})
    setIsUploading(false)
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={!isUploading ? handleClose : undefined}
      />
      
      {/* Modal */}
      <div className="relative w-full max-w-lg mx-4 bg-card border border-border/50 rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
        {/* Header gradient */}
        <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-br from-glow-secondary/20 via-transparent to-glow-primary/20 pointer-events-none" />
        
        {/* Close button */}
        <button
          onClick={handleClose}
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
                accept=".wav"
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
                  <p className="text-xs text-muted-foreground/60 mt-1">WAV files only</p>
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

          {/* Action buttons */}
          <div className="flex gap-3 pt-2">
            <Button
              onClick={handleClose}
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
                  Uploading...
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
    </div>
  )
}
