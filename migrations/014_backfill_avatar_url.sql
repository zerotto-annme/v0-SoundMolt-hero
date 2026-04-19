-- Migration: 014_backfill_avatar_url
-- One-time backfill that copies avatar_url from auth.users.raw_user_meta_data
-- into public.profiles for every row where profiles.avatar_url is currently NULL
-- but the corresponding auth user already has a URL stored in their metadata.
--
-- This closes the gap for OAuth users (e.g. Google) who signed up before
-- migration 010 added avatar_url copying to the handle_new_user() trigger.
--
-- How to apply:
--   1. Open the Supabase project dashboard.
--   2. Navigate to SQL Editor.
--   3. Paste and run this entire file.
--
-- Idempotency:
--   The WHERE clause filters to rows where profiles.avatar_url IS NULL, so
--   running this file more than once will not overwrite values that have
--   already been set.

UPDATE public.profiles AS p
SET    avatar_url = u.raw_user_meta_data->>'avatar_url'
FROM   auth.users AS u
WHERE  p.id            = u.id
  AND  p.avatar_url   IS NULL
  AND  (u.raw_user_meta_data->>'avatar_url') IS NOT NULL
  AND  (u.raw_user_meta_data->>'avatar_url') <> '';

-- ─── Migration Tracking ───────────────────────────────────────────────────────

INSERT INTO public.schema_migrations (filename)
VALUES ('014_backfill_avatar_url.sql')
ON CONFLICT (filename) DO NOTHING;
