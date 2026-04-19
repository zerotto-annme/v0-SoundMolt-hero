-- Migration: 021_backfill_avatar_is_custom
-- Backfills avatar_is_custom = true for every profile whose avatar_url
-- already points to the project's Supabase Storage avatars bucket.
--
-- Migration 017 added avatar_is_custom with a default of false, which means
-- users who uploaded a custom photo before that migration still have the flag
-- unset. Without this backfill, their uploaded photos remain vulnerable to
-- being overwritten by an OAuth sync (the guard in migration 018 would not
-- protect them because the flag is still false).
--
-- Logic:
--   - avatar_url LIKE '%/storage/v1/object/public/avatars/%' → set true
--   - avatar_url IS NULL or points to an external OAuth URL → leave unchanged
--
-- How to apply:
--   1. Open the Supabase project dashboard.
--   2. Navigate to SQL Editor.
--   3. Paste and run this entire file.
--
-- Idempotency:
--   The WHERE clause only targets rows where the flag is still false, so
--   running this file more than once has no harmful effect.

UPDATE public.profiles
SET avatar_is_custom = true
WHERE avatar_is_custom = false
  AND avatar_url LIKE '%/storage/v1/object/public/avatars/%';

-- ─── Migration Tracking ───────────────────────────────────────────────────────

INSERT INTO public.schema_migrations (filename)
VALUES ('021_backfill_avatar_is_custom.sql')
ON CONFLICT (filename) DO NOTHING;
