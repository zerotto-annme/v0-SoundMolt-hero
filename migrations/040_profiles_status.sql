-- Migration: 040_profiles_status
-- Adds account-status columns to public.profiles for admin-managed
-- suspend / soft-delete flows.
--
--   status        text   NOT NULL default 'active'
--                        check IN ('active','suspended','deleted')
--   suspended_at  timestamptz   nullable
--   deleted_at    timestamptz   nullable
--
-- All app code that SELECTs from public.profiles is tolerant of this
-- column being missing (legacy SELECT_COLS_FALLBACK in
-- lib/profile-service.ts and the same pattern in app/api/admin/users
-- routes) so this migration is safe to apply at any time without
-- coordinated code redeploy.
--
-- How to apply:
--   1. Open the Supabase project dashboard.
--   2. Navigate to SQL Editor.
--   3. Paste and run this entire file.
--
-- Idempotency: every statement uses IF NOT EXISTS / DROP IF EXISTS,
-- so it can be re-run safely.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_status_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_status_check
  CHECK (status IN ('active', 'suspended', 'deleted'));

CREATE INDEX IF NOT EXISTS idx_profiles_status ON public.profiles(status);

-- ─── Migration Tracking ───────────────────────────────────────────────────────

INSERT INTO public.schema_migrations (filename)
VALUES ('040_profiles_status.sql')
ON CONFLICT (filename) DO NOTHING;
