-- Migration: 017_add_avatar_is_custom_to_profiles
-- Adds an avatar_is_custom boolean column to public.profiles so the application
-- can distinguish between OAuth-sourced avatars (pulled from provider metadata)
-- and avatars deliberately uploaded by the user via the profile page.
--
-- When avatar_is_custom is TRUE, any OAuth sync logic must not overwrite
-- the avatar_url, preserving the user's intentional upload.
--
-- How to apply:
--   1. Open the Supabase project dashboard.
--   2. Navigate to SQL Editor.
--   3. Paste and run this entire file.
--
-- Idempotency:
--   Uses IF NOT EXISTS so it is safe to run more than once.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_is_custom boolean NOT NULL DEFAULT false;

-- ─── Migration Tracking ───────────────────────────────────────────────────────

INSERT INTO public.schema_migrations (filename)
VALUES ('017_add_avatar_is_custom_to_profiles.sql')
ON CONFLICT (filename) DO NOTHING;
