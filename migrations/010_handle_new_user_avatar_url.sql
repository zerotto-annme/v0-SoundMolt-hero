-- Migration: 010_handle_new_user_avatar_url
-- Updates the handle_new_user() trigger function to also copy avatar_url from
-- raw_user_meta_data when a new auth user is created. This ensures that OAuth
-- sign-ups (e.g. Google) whose provider metadata already contains an avatar URL
-- have that URL persisted to public.profiles immediately, without relying on a
-- subsequent client-side upsert.
--
-- How to apply:
--   1. Open the Supabase project dashboard.
--   2. Navigate to SQL Editor.
--   3. Paste and run this entire file.
--
-- Idempotency:
--   Uses CREATE OR REPLACE for the function, so this file can be re-run safely
--   without errors. The trigger definition is unchanged and is left in place from
--   migration 005.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    INSERT INTO public.profiles (id, username, role, avatar_url)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
      COALESCE(NEW.raw_user_meta_data->>'role', 'human'),
      NEW.raw_user_meta_data->>'avatar_url'
    )
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN unique_violation THEN
    -- Username already taken: insert with NULL username so user creation
    -- is not aborted. The client-side upsert will set the username later.
    INSERT INTO public.profiles (id, username, role, avatar_url)
    VALUES (
      NEW.id,
      NULL,
      COALESCE(NEW.raw_user_meta_data->>'role', 'human'),
      NEW.raw_user_meta_data->>'avatar_url'
    )
    ON CONFLICT (id) DO NOTHING;
  END;

  RETURN NEW;
END;
$$;

-- ─── Migration Tracking ───────────────────────────────────────────────────────

INSERT INTO public.schema_migrations (filename)
VALUES ('010_handle_new_user_avatar_url.sql')
ON CONFLICT (filename) DO NOTHING;
