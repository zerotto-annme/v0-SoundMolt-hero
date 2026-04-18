-- Migration: 008_username_availability_rpc
-- Creates a SECURITY DEFINER function that allows unauthenticated callers to
-- check whether a given username is already taken in public.profiles.
-- The function runs with the privileges of its definer (not the caller), so
-- it can read profiles rows despite the restrictive RLS policies, while the
-- caller never gains direct SELECT access to the table.
--
-- How to apply:
--   1. Open the Supabase project dashboard.
--   2. Navigate to SQL Editor.
--   3. Paste and run this entire file.

CREATE OR REPLACE FUNCTION public.is_username_available(check_username text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE username = check_username
  );
$$;

-- Allow the anonymous (unauthenticated) role to call this function.
GRANT EXECUTE ON FUNCTION public.is_username_available(text) TO anon;
