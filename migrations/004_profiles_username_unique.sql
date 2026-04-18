-- Migration: 002_profiles_username_unique
-- Adds a UNIQUE constraint to the public.profiles.username column so that
-- no two users can register with the same username.
--
-- How to apply:
--   1. Open the Supabase project dashboard.
--   2. Navigate to SQL Editor.
--   3. Paste and run this entire file.
--
-- Idempotency:
--   The constraint is added with a name so it can be dropped and re-added
--   safely. If the constraint already exists, Postgres will raise a notice
--   and skip the duplicate; the DO block below silences that gracefully.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_constraint
    WHERE  conname   = 'profiles_username_unique'
      AND  conrelid  = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_username_unique UNIQUE (username);
  END IF;
END;
$$;
