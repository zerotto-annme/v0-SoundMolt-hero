-- Migration: 017_sync_google_avatar_on_login
-- Adds a trigger function and trigger on auth.users (AFTER UPDATE) that
-- refreshes avatar_url in public.profiles whenever a user signs in via Google
-- OAuth and their provider avatar has changed.
--
-- Rules enforced by the function:
--   1. Only runs when raw_user_meta_data->>'avatar_url' actually changes in the
--      updated auth.users row, avoiding unnecessary writes.
--   2. Does NOT overwrite a custom avatar the user uploaded through the storage
--      bucket. Custom upload URLs contain '/storage/v1/object/', so the function
--      skips the update when that pattern is found in the currently stored URL.
--   3. Updates profiles.avatar_url only when the incoming Google URL differs
--      from what is already stored (no redundant writes).
--
-- How to apply:
--   1. Open the Supabase project dashboard.
--   2. Navigate to SQL Editor.
--   3. Paste and run this entire file.
--
-- Idempotency:
--   Uses CREATE OR REPLACE for the function and DROP TRIGGER IF EXISTS before
--   CREATE TRIGGER, so this file can be re-run safely without errors.

CREATE OR REPLACE FUNCTION public.sync_google_avatar_on_login()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_google_url  text;
  current_avatar  text;
BEGIN
  new_google_url := NEW.raw_user_meta_data->>'avatar_url';

  -- Nothing to do if the provider did not supply an avatar URL.
  IF new_google_url IS NULL OR new_google_url = '' THEN
    RETURN NEW;
  END IF;

  -- Nothing to do if the avatar URL in metadata did not change.
  IF (OLD.raw_user_meta_data->>'avatar_url') IS NOT DISTINCT FROM new_google_url THEN
    RETURN NEW;
  END IF;

  -- Read the avatar currently stored in the profile.
  SELECT avatar_url
  INTO   current_avatar
  FROM   public.profiles
  WHERE  id = NEW.id;

  -- Do not overwrite a manually uploaded avatar. Custom uploads are stored in
  -- the Supabase storage bucket and their public URLs always contain the path
  -- segment '/storage/v1/object/'.
  IF current_avatar LIKE '%/storage/v1/object/%' THEN
    RETURN NEW;
  END IF;

  -- Update only when the stored URL actually differs from the new Google URL.
  IF current_avatar IS DISTINCT FROM new_google_url THEN
    UPDATE public.profiles
    SET    avatar_url = new_google_url
    WHERE  id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;

CREATE TRIGGER on_auth_user_updated
  AFTER UPDATE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_google_avatar_on_login();
