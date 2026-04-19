-- Migration: 018_guard_avatar_url_on_login
-- Updates the handle_new_user() trigger function to respect the avatar_is_custom
-- flag added in migration 017. When a profile row already exists and
-- avatar_is_custom is TRUE, the OAuth-sourced avatar_url must not overwrite
-- the user's deliberately uploaded photo.
--
-- Changes from migration 010:
--   - INSERT includes avatar_is_custom = false (new rows are always OAuth-sourced).
--   - ON CONFLICT clause is changed from DO NOTHING to DO UPDATE with a WHERE
--     guard: avatar_url is only refreshed from OAuth metadata when the existing
--     row has avatar_is_custom = FALSE and the incoming URL is not NULL.
--
-- How to apply:
--   1. Open the Supabase project dashboard.
--   2. Navigate to SQL Editor.
--   3. Paste and run this entire file.
--
-- Idempotency:
--   Uses CREATE OR REPLACE so this file can be re-run safely without errors.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    INSERT INTO public.profiles (id, username, role, avatar_url, avatar_is_custom)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
      COALESCE(NEW.raw_user_meta_data->>'role', 'human'),
      NEW.raw_user_meta_data->>'avatar_url',
      false
    )
    ON CONFLICT (id) DO UPDATE
      SET avatar_url = EXCLUDED.avatar_url
      WHERE NOT profiles.avatar_is_custom
        AND EXCLUDED.avatar_url IS NOT NULL;
  EXCEPTION WHEN unique_violation THEN
    -- Username already taken: insert with NULL username so user creation
    -- is not aborted. The client-side upsert will set the username later.
    INSERT INTO public.profiles (id, username, role, avatar_url, avatar_is_custom)
    VALUES (
      NEW.id,
      NULL,
      COALESCE(NEW.raw_user_meta_data->>'role', 'human'),
      NEW.raw_user_meta_data->>'avatar_url',
      false
    )
    ON CONFLICT (id) DO UPDATE
      SET avatar_url = EXCLUDED.avatar_url
      WHERE NOT profiles.avatar_is_custom
        AND EXCLUDED.avatar_url IS NOT NULL;
  END;

  RETURN NEW;
END;
$$;

-- ─── Migration Tracking ───────────────────────────────────────────────────────

INSERT INTO public.schema_migrations (filename)
VALUES ('018_guard_avatar_url_on_login.sql')
ON CONFLICT (filename) DO NOTHING;
