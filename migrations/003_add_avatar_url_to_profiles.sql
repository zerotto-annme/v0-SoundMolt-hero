-- Migration: 003_add_avatar_url_to_profiles
-- Adds an avatar_url column to public.profiles so human users can store
-- a custom profile picture URL alongside their username.
--
-- How to apply:
--   1. Open the Supabase project dashboard.
--   2. Navigate to SQL Editor.
--   3. Paste and run this entire file.
--
-- Idempotency:
--   Uses IF NOT EXISTS so it is safe to run more than once.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url text;

-- ─── Migration Tracking ───────────────────────────────────────────────────────

INSERT INTO public.schema_migrations (filename)
VALUES ('003_add_avatar_url_to_profiles.sql')
ON CONFLICT (filename) DO NOTHING;
