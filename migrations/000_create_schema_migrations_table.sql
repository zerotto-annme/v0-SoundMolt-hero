-- Migration: 000_create_schema_migrations_table
-- Creates the schema_migrations tracking table so you always know which
-- migrations have been applied to the live database.
--
-- Apply this migration FIRST, before any other migration, so that subsequent
-- migration files can record themselves in this table.
--
-- How to apply:
--   1. Open the Supabase project dashboard.
--   2. Navigate to SQL Editor.
--   3. Paste and run this entire file.
--
-- Idempotency:
--   Uses IF NOT EXISTS so it is safe to run more than once.
--
-- To check which migrations have been applied:
--   SELECT filename, applied_at FROM public.schema_migrations ORDER BY applied_at;
--
-- To check whether a specific migration has run:
--   SELECT EXISTS (
--     SELECT 1 FROM public.schema_migrations WHERE filename = '001_create_profiles_table.sql'
--   );

-- ─── Table ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.schema_migrations (
  filename   text        PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

-- ─── Row Level Security ───────────────────────────────────────────────────────
-- No public access. Only the service role (SQL Editor / server-side admin
-- clients) can insert or read rows. Ordinary authenticated/anon users have
-- no visibility into this table.

ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.schema_migrations FROM anon, authenticated;

-- ─── Backfill: record this migration itself ───────────────────────────────────

INSERT INTO public.schema_migrations (filename)
VALUES ('000_create_schema_migrations_table.sql')
ON CONFLICT (filename) DO NOTHING;
