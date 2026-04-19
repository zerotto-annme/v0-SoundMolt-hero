import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const adminApiSecret = process.env.ADMIN_API_SECRET

const BUCKET = "avatars"
const FILE_LIST_PAGE_SIZE = 100
const DB_PAGE_SIZE = 1000

/**
 * POST /api/admin/cleanup-orphaned-avatars
 *
 * Removes old/orphaned avatar files from the Supabase Storage "avatars" bucket.
 * Covers two scenarios:
 *   1. Active users — for each profile in public.profiles, all files in their
 *      bucket folder are deleted except the one matching their current avatar_url.
 *   2. Deleted / legacy users — any folder that exists in the bucket but has no
 *      corresponding profile row is fully cleared.
 *
 * Authentication:
 *   The request MUST include the admin API secret as a Bearer token:
 *     Authorization: Bearer <ADMIN_API_SECRET>
 *
 * Response:
 *   { "deleted": number, "errors": Array<{ path: string, error: string }> }
 */
export async function POST(request: NextRequest) {
  if (!supabaseUrl) {
    console.error("[cleanup-orphaned-avatars] NEXT_PUBLIC_SUPABASE_URL is not set")
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 })
  }
  if (!supabaseServiceKey) {
    console.error("[cleanup-orphaned-avatars] SUPABASE_SERVICE_ROLE_KEY is not set")
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 })
  }

  if (!adminApiSecret) {
    console.error("[cleanup-orphaned-avatars] ADMIN_API_SECRET is not set")
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 })
  }

  const authHeader = request.headers.get("authorization") ?? ""
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : ""
  if (token !== adminApiSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const admin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  })

  // ── Helpers scoped to this request (capture `admin` via closure) ──────────

  async function listAllFilesInFolder(prefix: string): Promise<Array<{ name: string }>> {
    const files: Array<{ name: string }> = []
    let offset = 0

    while (true) {
      const { data, error } = await admin.storage
        .from(BUCKET)
        .list(prefix, { limit: FILE_LIST_PAGE_SIZE, offset })

      if (error) {
        throw new Error(`Failed to list files under "${prefix}": ${error.message}`)
      }

      const page = data ?? []
      files.push(...page)

      if (page.length < FILE_LIST_PAGE_SIZE) break
      offset += FILE_LIST_PAGE_SIZE
    }

    return files
  }

  async function listAllBucketFolders(): Promise<string[]> {
    const folders: string[] = []
    let offset = 0

    while (true) {
      const { data, error } = await admin.storage
        .from(BUCKET)
        .list("", { limit: FILE_LIST_PAGE_SIZE, offset })

      if (error) {
        throw new Error(`Failed to list bucket root: ${error.message}`)
      }

      const page = data ?? []
      folders.push(...page.filter((item) => item.id === null).map((item) => item.name))

      if (page.length < FILE_LIST_PAGE_SIZE) break
      offset += FILE_LIST_PAGE_SIZE
    }

    return folders
  }

  // ── Step 1: Fetch all profile rows (id → active avatar storage path) ───────
  const activePathByUser = new Map<string, string | null>()
  let dbOffset = 0

  while (true) {
    const { data, error } = await admin
      .from("profiles")
      .select("id, avatar_url")
      .range(dbOffset, dbOffset + DB_PAGE_SIZE - 1)

    if (error) {
      console.error("[cleanup-orphaned-avatars] Failed to fetch profiles:", error)
      return NextResponse.json({ error: "Failed to query profiles" }, { status: 500 })
    }

    if (!data || data.length === 0) break

    for (const row of data) {
      activePathByUser.set(row.id, storagePathFromUrl(row.avatar_url))
    }

    if (data.length < DB_PAGE_SIZE) break
    dbOffset += DB_PAGE_SIZE
  }

  // ── Step 2: Enumerate all folders in the bucket ───────────────────────────
  let bucketFolders: string[]
  try {
    bucketFolders = await listAllBucketFolders()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[cleanup-orphaned-avatars] Failed to list bucket folders:", message)
    return NextResponse.json({ error: "Failed to list bucket folders" }, { status: 500 })
  }

  // ── Step 3: For each folder, delete orphaned files ────────────────────────
  let deleted = 0
  const errors: Array<{ path: string; error: string }> = []

  for (const folderName of bucketFolders) {
    const hasProfile = activePathByUser.has(folderName)
    const currentPath = hasProfile ? activePathByUser.get(folderName) : null

    let files: Array<{ name: string }>
    try {
      files = await listAllFilesInFolder(folderName)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[cleanup-orphaned-avatars] Could not list folder "${folderName}":`, message)
      errors.push({ path: folderName, error: message })
      continue
    }

    if (files.length === 0) continue

    const toDelete = files
      .map((f) => `${folderName}/${f.name}`)
      .filter((filePath) => !(currentPath && filePath === currentPath))

    if (toDelete.length === 0) continue

    const { error: deleteError } = await admin.storage.from(BUCKET).remove(toDelete)

    if (deleteError) {
      console.error(
        `[cleanup-orphaned-avatars] Failed to delete files in "${folderName}":`,
        deleteError,
      )
      for (const path of toDelete) {
        errors.push({ path, error: deleteError.message })
      }
    } else {
      deleted += toDelete.length
    }
  }

  console.log(
    `[cleanup-orphaned-avatars] Cleanup complete: deleted=${deleted}, errors=${errors.length}`,
  )

  return NextResponse.json({ deleted, errors })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts the storage path relative to the bucket root from a public avatar
 * URL. Returns null for non-storage URLs (e.g. OAuth provider URLs).
 */
function storagePathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const cleanUrl = url.split("?")[0]
    const marker = `/object/public/${BUCKET}/`
    const idx = cleanUrl.indexOf(marker)
    if (idx === -1) return null
    return cleanUrl.slice(idx + marker.length)
  } catch {
    return null
  }
}
