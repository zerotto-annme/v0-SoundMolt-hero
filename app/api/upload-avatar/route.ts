import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp"]
const MAX_SIZE_BYTES = 5 * 1024 * 1024

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export async function POST(request: NextRequest) {
  if (!supabaseServiceKey) {
    console.error("[upload-avatar] SUPABASE_SERVICE_ROLE_KEY is not set")
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 })
  }

  const authHeader = request.headers.get("authorization")
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const userJwt = authHeader.slice(7)

  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
  })
  const { data: { user }, error: userError } = await userClient.auth.getUser()
  if (userError || !user) {
    console.error("[upload-avatar] Failed to verify user:", userError?.message)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 })
  }

  const file = formData.get("file") as File | null
  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 })
  }

  console.log("[upload-avatar] Upload request:", {
    userId: user.id,
    fileType: file.type,
    fileSizeBytes: file.size,
    bucket: "avatars",
  })

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: `Invalid file type: ${file.type}. Allowed: png, jpg, jpeg, webp` },
      { status: 400 }
    )
  }

  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json(
      { error: `File too large: ${file.size} bytes. Max: ${MAX_SIZE_BYTES}` },
      { status: 400 }
    )
  }

  const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  })

  const { data: buckets } = await adminClient.storage.listBuckets()
  const avatarsBucket = buckets?.find((b) => b.id === "avatars")
  if (!avatarsBucket) {
    console.log("[upload-avatar] Creating avatars bucket...")
    const { error: createBucketError } = await adminClient.storage.createBucket("avatars", {
      public: true,
    })
    if (createBucketError) {
      console.error("[upload-avatar] Failed to create avatars bucket:", createBucketError.message)
      return NextResponse.json(
        { error: "Storage bucket unavailable. Please contact support." },
        { status: 500 }
      )
    }
  }

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg"
  const path = `${user.id}/${Date.now()}.${ext}`

  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  const { error: uploadError } = await adminClient.storage
    .from("avatars")
    .upload(path, buffer, {
      contentType: file.type,
      upsert: true,
    })

  if (uploadError) {
    console.error("[upload-avatar] Storage upload failed:", {
      bucket: "avatars",
      path,
      fileType: file.type,
      fileSizeBytes: file.size,
      error: uploadError.message,
    })
    return NextResponse.json(
      { error: `Upload failed: ${uploadError.message}` },
      { status: 500 }
    )
  }

  const { data: urlData } = adminClient.storage.from("avatars").getPublicUrl(path)
  const publicUrl = urlData.publicUrl

  const { error: profileError } = await adminClient
    .from("profiles")
    .upsert(
      {
        id: user.id,
        avatar_url: publicUrl,
      },
      { onConflict: "id" }
    )

  if (profileError) {
    console.error("[upload-avatar] Profile update failed:", profileError.message)
    return NextResponse.json(
      { error: `Avatar uploaded but profile update failed: ${profileError.message}` },
      { status: 500 }
    )
  }

  console.log("[upload-avatar] Success:", { userId: user.id, publicUrl })
  return NextResponse.json({ url: publicUrl }, { status: 200 })
}
