-- Migration: 005_auto_create_profile_trigger
-- Adds a server-side safety net: a trigger on auth.users that automatically
-- inserts a minimal profile row into public.profiles whenever a new auth user
-- is created. This ensures a profile row always exists even if the client-side
-- upsert in components/auth-context.tsx fails (network error, RLS race, etc.).
--
-- How to apply:
--   1. Open the Supabase project dashboard.
--   2. Navigate to SQL Editor.
--   3. Paste and run this entire file.
--
-- Idempotency:
--   Uses CREATE OR REPLACE for the function and DROP/CREATE for the trigger,
--   so this file can be re-run safely without errors.
--
-- Username uniqueness:
--   If the username derived from metadata collides with the profiles_username_unique
--   constraint (migration 004), the trigger falls back to inserting NULL for username
--   so that user creation is never aborted. The client-side upsert in
--   components/auth-context.tsx will set the final username afterward.

-- ─── Trigger Function ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    INSERT INTO public.profiles (id, username, role)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
      COALESCE(NEW.raw_user_meta_data->>'role', 'human')
    )
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN unique_violation THEN
    -- Username already taken: insert with NULL username so user creation
    -- is not aborted. The client-side upsert will set the username later.
    INSERT INTO public.profiles (id, username, role)
    VALUES (
      NEW.id,
      NULL,
      COALESCE(NEW.raw_user_meta_data->>'role', 'human')
    )
    ON CONFLICT (id) DO NOTHING;
  END;

  RETURN NEW;
END;
$$;

-- ─── Trigger ──────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
