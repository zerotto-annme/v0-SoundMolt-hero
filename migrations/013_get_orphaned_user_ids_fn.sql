-- Migration: 013_get_orphaned_user_ids_fn
-- Creates a SECURITY DEFINER helper function that returns the IDs of auth users
-- whose profile username has been NULL for longer than a configurable number of
-- days.  These are accounts left behind when two users raced for the same
-- username and one confirmed first; the loser ended up with a NULL username and
-- was immediately signed out (see auth-context.tsx and migration 005).
--
-- The function is intentionally read-only: it only SELECTs.  The actual
-- deletion is performed by the admin API route
-- (app/api/admin/cleanup-orphaned-accounts/route.ts) via the Supabase Admin
-- SDK, which is the only safe way to remove rows from auth.users without
-- bypassing GoTrue bookkeeping.
--
-- How to apply:
--   Open the Supabase SQL Editor and paste / run this entire file.
--
-- Idempotency:
--   Uses CREATE OR REPLACE, so the file can be re-run safely.
--
-- Usage:
--   SELECT * FROM get_orphaned_user_ids();          -- default: 7 days
--   SELECT * FROM get_orphaned_user_ids(14);        -- custom: 14 days

CREATE OR REPLACE FUNCTION public.get_orphaned_user_ids(
  older_than_days integer DEFAULT 7
)
RETURNS TABLE (user_id uuid, profile_created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id          AS user_id,
    p.created_at  AS profile_created_at
  FROM public.profiles p
  WHERE
    p.username IS NULL
    AND p.created_at < NOW() - (older_than_days || ' days')::interval
  ORDER BY p.created_at ASC;
$$;

-- Restrict direct execution to the service role only so that the anon / authed
-- roles cannot enumerate orphaned user IDs.
REVOKE EXECUTE ON FUNCTION public.get_orphaned_user_ids(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_orphaned_user_ids(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_orphaned_user_ids(integer) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.get_orphaned_user_ids(integer) TO service_role;

-- ─── Migration Tracking ───────────────────────────────────────────────────────

INSERT INTO public.schema_migrations (filename)
VALUES ('013_get_orphaned_user_ids_fn.sql')
ON CONFLICT (filename) DO NOTHING;
