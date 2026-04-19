-- Migration: 009_backfill_missing_profiles
-- One-time backfill that inserts a minimal profile row for every auth.users
-- record that has no matching row in public.profiles.
--
-- Background:
--   Migration 005 added a trigger that auto-creates profiles for new sign-ups,
--   but any auth users created before that trigger was in place (or whose
--   client-side upsert failed) may still lack a profile row. This migration
--   closes that gap.
--
-- How to apply:
--   1. Open the Supabase project dashboard.
--   2. Navigate to SQL Editor.
--   3. Paste and run this entire file.
--
-- Idempotency:
--   ON CONFLICT (id) DO NOTHING makes this safe to re-run at any time.
--   Rows that already have a profile are left completely untouched.
--
-- Username strategy:
--   Attempts to use the email-prefix (part before @) as the username.
--   Falls back to NULL when:
--     (a) the prefix is already taken by an existing profile row, OR
--     (b) multiple backfill candidates share the same prefix — only the
--         earliest (lowest id) gets the name, the rest receive NULL.
--   This mirrors the fallback logic in the migration-005 trigger and
--   guarantees the statement never aborts from a username uniqueness
--   violation, even in bulk. Usernames set to NULL can be completed by
--   the user on their next sign-in.

WITH candidates AS (
  -- All auth users that have no matching profile yet
  SELECT
    u.id,
    split_part(u.email, '@', 1) AS email_prefix
  FROM auth.users u
  WHERE NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = u.id
  )
),
ranked AS (
  SELECT
    c.id,
    c.email_prefix,
    -- Within candidates that share the same prefix, assign rank 1 to the
    -- earliest user (by id) so only one of them gets the username.
    ROW_NUMBER() OVER (PARTITION BY c.email_prefix ORDER BY c.id) AS rn,
    -- True when the prefix is already used by an existing profile row.
    EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.username = c.email_prefix
    ) AS prefix_already_taken
  FROM candidates c
)
INSERT INTO public.profiles (id, username, role)
SELECT
  r.id,
  CASE
    -- Use the email prefix only when it is unambiguous and unclaimed.
    WHEN NOT r.prefix_already_taken AND r.rn = 1 THEN r.email_prefix
    ELSE NULL
  END AS username,
  'human' AS role
FROM ranked r
ON CONFLICT (id) DO NOTHING;

-- ─── Migration Tracking ───────────────────────────────────────────────────────

INSERT INTO public.schema_migrations (filename)
VALUES ('009_backfill_missing_profiles.sql')
ON CONFLICT (filename) DO NOTHING;
