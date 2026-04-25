-- Migration: 039_profiles_updated_at
-- Adds updated_at to public.profiles so the client can cache-bust avatar URLs
-- deterministically (avatar_url + "?v=" + updated_at). Idempotent — safe to
-- run multiple times.
--
-- Apply in Supabase SQL Editor (or via the same channel previous migrations
-- were applied through). Application code already tolerates the column being
-- absent: SELECTs retry without it on 42703 column-not-found errors. Once
-- this migration runs the cache-bust value becomes deterministic across tabs.

-- 1. Add the column with a sane default + NOT NULL.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- 2. Backfill: any existing rows get the current time.
UPDATE public.profiles
SET    updated_at = COALESCE(updated_at, now())
WHERE  updated_at IS NULL;

-- 3. Trigger function: bump updated_at on every UPDATE.
CREATE OR REPLACE FUNCTION public.profiles_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- 4. Attach the trigger (drop-and-create makes this idempotent).
DROP TRIGGER IF EXISTS profiles_set_updated_at ON public.profiles;
CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_set_updated_at();

-- 5. Record migration.
INSERT INTO public.schema_migrations (filename)
VALUES ('039_profiles_updated_at.sql')
ON CONFLICT (filename) DO NOTHING;
