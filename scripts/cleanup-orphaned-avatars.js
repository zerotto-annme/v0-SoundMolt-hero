#!/usr/bin/env node
/**
 * scripts/cleanup-orphaned-avatars.js
 *
 * One-time cleanup script that removes old/orphaned avatar files from the
 * Supabase Storage "avatars" bucket.
 *
 * Background:
 *   Each avatar upload creates a new file at `avatars/{userId}/{timestamp}-{name}`.
 *   Before the delete-on-upload fix was applied, the old file was never removed,
 *   leaving behind orphaned files for every subsequent upload.  This script does
 *   a one-time sweep covering two scenarios:
 *
 *   1. Active users — for each profile in public.profiles, all files in their
 *      bucket folder are deleted except the one matching their current avatar_url.
 *
 *   2. Deleted / legacy users — any folder that exists in the bucket but has no
 *      corresponding profile row (e.g. accounts deleted after upload) is fully
 *      cleared.
 *
 * Requirements:
 *   - Node.js 18+
 *   - NEXT_PUBLIC_SUPABASE_URL env var
 *   - SUPABASE_SERVICE_ROLE_KEY env var  (service-role key, NOT the anon key)
 *
 * Usage:
 *   node scripts/cleanup-orphaned-avatars.js
 *
 * The script is idempotent: running it multiple times produces the same result.
 * It never deletes the file that is currently set as a user's avatar_url.
 *
 * Dry-run mode:
 *   Set DRY_RUN=1 to log what would be deleted without actually deleting anything.
 *   DRY_RUN=1 node scripts/cleanup-orphaned-avatars.js
 */

"use strict"

const { createClient } = require("@supabase/supabase-js")

const BUCKET = "avatars"
const DRY_RUN = process.env.DRY_RUN === "1"
const FILE_LIST_PAGE_SIZE = 100

// ---------------------------------------------------------------------------
// Environment validation
// ---------------------------------------------------------------------------

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl) {
  console.error("ERROR: NEXT_PUBLIC_SUPABASE_URL is not set.")
  process.exit(1)
}
if (!serviceRoleKey) {
  console.error("ERROR: SUPABASE_SERVICE_ROLE_KEY is not set.")
  process.exit(1)
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Given a public avatar URL such as
 *   https://<project>.supabase.co/storage/v1/object/public/avatars/abc-123/1700000000000-avatar.jpg
 * returns the storage path relative to the bucket root:
 *   abc-123/1700000000000-avatar.jpg
 *
 * Query-string parameters (e.g. cache-busting ?t=123) are stripped before
 * comparison so a URL like `.../avatar.jpg?t=1700000000` still matches the
 * stored file `abc-123/avatar.jpg`.
 *
 * Returns null if the URL does not belong to the avatars bucket (e.g. OAuth
 * provider URLs from Google).
 */
function storagePathFromUrl(url) {
  if (!url) return null
  try {
    // Strip query params before extracting the path.
    const cleanUrl = url.split("?")[0]
    const marker = `/object/public/${BUCKET}/`
    const idx = cleanUrl.indexOf(marker)
    if (idx === -1) return null
    return cleanUrl.slice(idx + marker.length)
  } catch {
    return null
  }
}

/**
 * List ALL files under a given prefix in the avatars bucket, paginating
 * through results so folders with more than FILE_LIST_PAGE_SIZE files are
 * fully covered.
 */
async function listAllFilesInFolder(prefix) {
  const files = []
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

/**
 * List all top-level "folders" (user ID prefixes) in the avatars bucket.
 * Supabase Storage returns folder entries when you list the bucket root with
 * no prefix — each entry whose `id` is null is a virtual folder.
 */
async function listAllBucketFolders() {
  const folders = []
  let offset = 0

  while (true) {
    const { data, error } = await admin.storage
      .from(BUCKET)
      .list("", { limit: FILE_LIST_PAGE_SIZE, offset })

    if (error) {
      throw new Error(`Failed to list bucket root: ${error.message}`)
    }

    const page = data ?? []
    // Folder entries have a null `id`; file entries at the root (rare) have an id.
    folders.push(...page.filter((item) => item.id === null).map((item) => item.name))

    if (page.length < FILE_LIST_PAGE_SIZE) break
    offset += FILE_LIST_PAGE_SIZE
  }

  return folders
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (DRY_RUN) {
    console.log("=== DRY RUN — no files will be deleted ===\n")
  }

  // ── Step 1: Fetch all profile rows (id → active avatar path) ──────────────
  console.log("Fetching all profiles from public.profiles …")

  const activePathByUser = new Map() // userId → storage path (or null)
  const DB_PAGE_SIZE = 1000
  let dbOffset = 0

  while (true) {
    const { data, error } = await admin
      .from("profiles")
      .select("id, avatar_url")
      .range(dbOffset, dbOffset + DB_PAGE_SIZE - 1)

    if (error) {
      console.error("ERROR: Failed to fetch profiles:", error.message)
      process.exit(1)
    }

    if (!data || data.length === 0) break

    for (const row of data) {
      activePathByUser.set(row.id, storagePathFromUrl(row.avatar_url))
    }

    if (data.length < DB_PAGE_SIZE) break
    dbOffset += DB_PAGE_SIZE
  }

  console.log(`Found ${activePathByUser.size} profile(s).\n`)

  // ── Step 2: Enumerate all folders in the bucket ───────────────────────────
  console.log("Listing all folders in the avatars bucket …")

  let bucketFolders
  try {
    bucketFolders = await listAllBucketFolders()
  } catch (err) {
    console.error("ERROR:", err.message)
    process.exit(1)
  }

  console.log(`Found ${bucketFolders.length} folder(s) in bucket.\n`)

  // ── Step 3: For each folder, delete orphaned files ────────────────────────
  let totalScanned = 0
  let totalDeleted = 0
  let totalErrors = 0
  let foldersWithOrphans = 0
  let legacyFolders = 0

  for (const folderName of bucketFolders) {
    const hasProfile = activePathByUser.has(folderName)

    if (!hasProfile) {
      // This folder belongs to a deleted or legacy user — remove everything.
      legacyFolders++
    }

    // The active path for this folder (null = no local file to preserve).
    const currentPath = hasProfile ? activePathByUser.get(folderName) : null

    let files
    try {
      files = await listAllFilesInFolder(folderName)
    } catch (err) {
      console.error(`  [${folderName}] SKIP — could not list folder: ${err.message}`)
      totalErrors++
      continue
    }

    if (files.length === 0) continue

    totalScanned += files.length

    // Identify files to delete.
    const toDelete = files.filter((file) => {
      const filePath = `${folderName}/${file.name}`
      // Keep the file if it matches the active avatar path.
      if (currentPath && filePath === currentPath) return false
      return true
    })

    if (toDelete.length === 0) continue

    foldersWithOrphans++
    const paths = toDelete.map((f) => `${folderName}/${f.name}`)

    const reason = hasProfile ? "orphaned (not current avatar)" : "legacy folder (no profile)"
    console.log(`[${folderName}] ${toDelete.length} file(s) to delete (${reason}):`)
    paths.forEach((p) => console.log(`  - ${p}`))

    if (DRY_RUN) {
      console.log(`  → DRY RUN: skipping deletion.\n`)
      totalDeleted += toDelete.length
      continue
    }

    const { error: deleteError } = await admin.storage.from(BUCKET).remove(paths)

    if (deleteError) {
      console.error(`  [${folderName}] ERROR deleting files: ${deleteError.message}\n`)
      totalErrors++
    } else {
      console.log(`  → Deleted ${toDelete.length} file(s).\n`)
      totalDeleted += toDelete.length
    }
  }

  console.log("──────────────────────────────────────────")
  console.log(`Profiles in database  : ${activePathByUser.size}`)
  console.log(`Folders in bucket     : ${bucketFolders.length}`)
  console.log(`  of which legacy     : ${legacyFolders}`)
  console.log(`Files examined        : ${totalScanned}`)
  console.log(`Folders with orphans  : ${foldersWithOrphans}`)
  if (DRY_RUN) {
    console.log(`Files to delete       : ${totalDeleted} (DRY RUN — nothing deleted)`)
  } else {
    console.log(`Files deleted         : ${totalDeleted}`)
  }
  console.log(`Errors                : ${totalErrors}`)
  console.log("──────────────────────────────────────────")

  if (totalErrors > 0) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error("Unhandled error:", err)
  process.exit(1)
})
