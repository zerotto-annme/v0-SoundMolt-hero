-- Migration: 017_cleanup_audit_log
-- Creates an append-only audit log table that records every orphaned-account
-- cleanup run: when it happened, how many accounts were removed, how many
-- deletions failed, and an optional label identifying the caller
-- (e.g. "admin-api", "cron", etc.).
--
-- Security notes:
--   • RLS is enabled so normal (authenticated/anon) users cannot read or write
--     this table at all.  Only the service-role key bypasses RLS, so the
--     server-side cleanup route (which uses the service-role client) is the
--     sole writer.
--   • No UPDATE or DELETE policies are defined — rows are intentionally
--     append-only.  Even the service role cannot delete rows through the normal
--     Supabase client (it can still use the SQL editor, which is fine for an
--     admin audit table).
--
-- ─── How to apply ────────────────────────────────────────────────────────────
--   1. Open the Supabase project dashboard.
--   2. Navigate to SQL Editor.
--   3. Paste and run this entire file.

-- ─── Table ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cleanup_audit_log (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ran_at           timestamptz NOT NULL DEFAULT now(),
  accounts_deleted integer     NOT NULL DEFAULT 0,
  error_count      integer     NOT NULL DEFAULT 0,
  triggered_by     text
);

-- Useful for time-series queries ("show me the last N runs").
CREATE INDEX IF NOT EXISTS cleanup_audit_log_ran_at_idx
  ON public.cleanup_audit_log (ran_at DESC);

-- ─── Row-Level Security ───────────────────────────────────────────────────────
-- Enable RLS so the table is invisible to normal authenticated and anonymous
-- users.  No SELECT / INSERT / UPDATE / DELETE policies are granted to any
-- non-service role — the service-role key bypasses RLS entirely.
ALTER TABLE public.cleanup_audit_log ENABLE ROW LEVEL SECURITY;

-- Explicitly deny all access to authenticated users (belt-and-suspenders).
-- Without any permissive policy, RLS already blocks everything; this
-- restrictive policy makes the intent unambiguous.
CREATE POLICY "No direct access for authenticated users"
  ON public.cleanup_audit_log
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (false);

-- Revoke table-level privileges from the anon and authenticated roles so that
-- even if someone mistakenly adds a permissive policy later, ordinary clients
-- still cannot access the table without explicit re-grants.
REVOKE ALL ON public.cleanup_audit_log FROM anon, authenticated;

-- ─── Append-only enforcement trigger ─────────────────────────────────────────
-- The RLS and privilege revocations above prevent ordinary clients from
-- modifying rows, but a superuser / service-role connection reached via the
-- SQL editor can still issue UPDATE or DELETE.  This trigger makes the table
-- structurally append-only for every database role by raising an exception
-- before any update or deletion can be committed.

CREATE OR REPLACE FUNCTION public.cleanup_audit_log_deny_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'cleanup_audit_log is append-only: % operations are not permitted',
    TG_OP;
END;
$$;

CREATE TRIGGER cleanup_audit_log_no_update
  BEFORE UPDATE ON public.cleanup_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.cleanup_audit_log_deny_mutation();

CREATE TRIGGER cleanup_audit_log_no_delete
  BEFORE DELETE ON public.cleanup_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.cleanup_audit_log_deny_mutation();

-- ─── Migration Tracking ───────────────────────────────────────────────────────

INSERT INTO public.schema_migrations (filename)
VALUES ('018_cleanup_audit_log.sql')
ON CONFLICT (filename) DO NOTHING;
