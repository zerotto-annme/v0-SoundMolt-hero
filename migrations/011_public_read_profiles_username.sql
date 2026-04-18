-- Migration: 011_public_read_profiles_username
-- Allow anyone (including unauthenticated visitors) to read usernames from
-- public.profiles so that track artist names can be displayed in the home feed.
-- Only the username column is exposed; no sensitive data is added.
--
-- How to apply:
--   1. Open the Supabase project dashboard.
--   2. Navigate to SQL Editor.
--   3. Paste and run this entire file.

DROP POLICY IF EXISTS "public can read profile usernames" ON public.profiles;
CREATE POLICY "public can read profile usernames"
  ON public.profiles
  FOR SELECT
  USING (true);
