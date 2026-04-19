-- Migration: 016_username_check_constraint
-- Adds a CHECK constraint to public.profiles.username so that only
-- usernames matching the pattern ^[a-zA-Z0-9_]+$ can ever be stored,
-- regardless of where the write originates (API, client, trigger, etc.).
--
-- NULL is explicitly allowed because the trigger that auto-creates a
-- profile row may insert a row before a username has been chosen.
--
-- The is_username_available RPC is also updated to reject invalid
-- formats up-front, returning false immediately without a table scan.
--
-- ─── PREFLIGHT CHECK ─────────────────────────────────────────────────────────
-- Before applying, verify there are no existing rows that would violate the
-- constraint.  Run this query first; if it returns any rows, clean them up
-- (NULL them out or fix them) before continuing.
--
--   SELECT id, username
--   FROM public.profiles
--   WHERE username IS NOT NULL
--     AND username !~ '^[a-zA-Z0-9_]+$';
--
-- ─── How to apply ────────────────────────────────────────────────────────────
--   1. Open the Supabase project dashboard.
--   2. Navigate to SQL Editor.
--   3. Run the preflight query above and confirm it returns zero rows.
--   4. Paste and run this entire file.

-- ─── CHECK constraint ────────────────────────────────────────────────────────
-- Added as NOT VALID so Postgres marks the constraint without scanning
-- historical rows under a full table lock.  The subsequent VALIDATE CONSTRAINT
-- command checks existing rows using a less aggressive ShareUpdateExclusiveLock
-- that does not block concurrent reads or writes.

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_username_format
  CHECK (username IS NULL OR username ~ '^[a-zA-Z0-9_]+$')
  NOT VALID;

ALTER TABLE public.profiles
  VALIDATE CONSTRAINT profiles_username_format;

-- ─── Updated is_username_available RPC ───────────────────────────────────────
-- Returns FALSE immediately when the supplied username does not match the
-- allowed character set, saving a needless table scan and giving callers a
-- consistent signal for invalid inputs.

CREATE OR REPLACE FUNCTION public.is_username_available(check_username text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Reject blank input
  IF check_username IS NULL OR trim(check_username) = '' THEN
    RETURN FALSE;
  END IF;

  -- Reject usernames that contain characters outside [a-zA-Z0-9_]
  IF check_username !~ '^[a-zA-Z0-9_]+$' THEN
    RETURN FALSE;
  END IF;

  -- Check availability
  RETURN NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE username = check_username
  );
END;
$$;

-- Note: anonymous execute access was intentionally revoked in migration 012.
-- CREATE OR REPLACE preserves existing grants/revokes, so no GRANT statement
-- is needed here — the anon role remains blocked from calling this function
-- directly, and access continues to flow exclusively through the server-side
-- API route and its rate limiter.
