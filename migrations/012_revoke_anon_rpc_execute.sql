-- Migration: 012_revoke_anon_rpc_execute
-- Hardens access control around username availability lookups.
--
-- 1. Revokes direct anonymous access to the is_username_available RPC.
--    Previously the anon role could call this function directly using the
--    public Supabase anon key, allowing rapid username enumeration without
--    going through the server-side API route and its rate limiter.
--    After this change only the service role (server-side) can call it.
--
-- 2. Applies column-level SELECT restrictions on public.profiles so that
--    the anon role can only read the id and username columns through the
--    REST API. The RLS policy added in migration 011 (needed to display
--    track artist names in the home feed) remains in place, but column-level
--    grants limit which fields are actually visible to unauthenticated callers.
--
-- How to apply:
--   1. Open the Supabase project dashboard.
--   2. Navigate to SQL Editor.
--   3. Paste and run this entire file.

-- Close the direct RPC enumeration path.
REVOKE EXECUTE ON FUNCTION public.is_username_available(text) FROM anon;

-- Restrict which columns the anonymous role can read from profiles.
-- The RLS policy from migration 011 stays (needed for the public feed),
-- but we limit the exposed columns at the privilege level.
REVOKE SELECT ON public.profiles FROM anon;
GRANT SELECT (id, username) ON public.profiles TO anon;
