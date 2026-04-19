-- Migration: 001_create_profiles_table
-- Creates the public.profiles table used by the Human sign-up flow.
-- Each row corresponds to a Supabase Auth user and stores their
-- application-level username, role, and avatar URL.
--
-- How to apply (fresh installation):
--   1. Open the Supabase project dashboard.
--   2. Navigate to SQL Editor.
--   3. Paste and run this entire file.
--
-- Existing databases:
--   If public.profiles already exists without the avatar_url column,
--   run migration 003_add_avatar_url_to_profiles.sql to add the column.
--   This file's CREATE TABLE uses IF NOT EXISTS and will not re-create
--   or alter an existing table.
--
-- Idempotency:
--   The table creation uses IF NOT EXISTS.
--   Policies are dropped first (DROP POLICY IF EXISTS) then recreated,
--   so this file can be re-run safely without errors.

-- ─── Table ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.profiles (
  id         uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  username   text,
  role       text,
  avatar_url text
);

-- ─── Row Level Security ───────────────────────────────────────────────────────

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ─── Policies (drop-then-create for idempotency) ─────────────────────────────

-- Users can read their own profile row.
DROP POLICY IF EXISTS "users can read own profile" ON public.profiles;
CREATE POLICY "users can read own profile"
  ON public.profiles
  FOR SELECT
  USING (auth.uid() = id);

-- Users can insert their own profile row (needed for the sign-up upsert).
DROP POLICY IF EXISTS "users can insert own profile" ON public.profiles;
CREATE POLICY "users can insert own profile"
  ON public.profiles
  FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Users can update their own profile row.
DROP POLICY IF EXISTS "users can update own profile" ON public.profiles;
CREATE POLICY "users can update own profile"
  ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- ─── Migration Tracking ───────────────────────────────────────────────────────

INSERT INTO public.schema_migrations (filename)
VALUES ('001_create_profiles_table.sql')
ON CONFLICT (filename) DO NOTHING;
