-- Migration: 017_schedule_orphaned_account_cleanup
--
-- Sets up a daily pg_cron job that calls the cleanup-orphaned-accounts Edge
-- Function at 00:00 UTC every night.  The Edge Function (defined in
-- supabase/functions/cleanup-orphaned-accounts/index.ts) deletes auth users
-- whose profile username has been NULL for more than 7 days — accounts left
-- behind when two users raced for the same username during registration.
--
-- Prerequisites:
--   • pg_cron extension enabled  (Supabase dashboard → Database → Extensions)
--   • pg_net extension enabled   (Supabase dashboard → Database → Extensions)
--   • The cleanup-orphaned-accounts Edge Function deployed:
--       supabase functions deploy cleanup-orphaned-accounts
--   • Two Postgres settings configured (see Step 2 below)
--
-- How to apply:
--   1. Complete Step 2 (set app settings) in the Supabase SQL Editor.
--   2. Then run the rest of this file in the same SQL Editor session.
--
-- Idempotency:
--   This migration unconditionally unschedules any existing job with the same
--   name before re-creating it, so it can be re-run safely without creating
--   duplicate jobs.
--
-- To verify the job was created:
--   SELECT jobid, jobname, schedule, command, active
--   FROM   cron.job
--   WHERE  jobname = 'cleanup-orphaned-accounts';
--
-- To unschedule:
--   SELECT cron.unschedule('cleanup-orphaned-accounts');
--
-- Schedule:
--   0 0 * * *  →  daily at midnight UTC

-- ---------------------------------------------------------------------------
-- 1. Ensure required extensions are available
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ---------------------------------------------------------------------------
-- 2. Store configuration as Postgres settings
--
--    Run these two ALTER DATABASE commands ONCE before applying this migration,
--    replacing the placeholder values with your real project credentials.
--    These settings survive server restarts.
--
--    The Edge Function URL always follows the pattern:
--      https://<project-ref>.supabase.co/functions/v1/cleanup-orphaned-accounts
--    Your project reference ID is visible in: Project Settings → General.
--
--    ALTER DATABASE postgres
--      SET app.cleanup_fn_url =
--        'https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/cleanup-orphaned-accounts';
--
--    ALTER DATABASE postgres
--      SET app.supabase_service_role_key = '<YOUR_SERVICE_ROLE_KEY>';
--
--    The service-role key is NOT exposed to anon/authenticated roles via RLS,
--    but IS readable by any superuser or service_role session — treat the
--    database itself as a trust boundary and never expose it to client code.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 3. Preflight: verify required settings are present before scheduling
--    so that a misconfigured run fails loudly rather than silently scheduling
--    a cron job that will always error.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  fn_url text;
  svc_key text;
BEGIN
  fn_url  := current_setting('app.cleanup_fn_url',          true);
  svc_key := current_setting('app.supabase_service_role_key', true);

  IF fn_url IS NULL OR fn_url = '' THEN
    RAISE EXCEPTION
      'app.cleanup_fn_url is not set. '
      'Run: ALTER DATABASE postgres SET app.cleanup_fn_url = ''https://<project-ref>.supabase.co/functions/v1/cleanup-orphaned-accounts'';';
  END IF;

  IF svc_key IS NULL OR svc_key = '' THEN
    RAISE EXCEPTION
      'app.supabase_service_role_key is not set. '
      'Run: ALTER DATABASE postgres SET app.supabase_service_role_key = ''<your-service-role-key>'';';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Schedule the daily cleanup job (idempotent: remove then re-create)
-- ---------------------------------------------------------------------------

-- Remove the job if it already exists so re-running this migration is safe.
DO $$
BEGIN
  PERFORM cron.unschedule('cleanup-orphaned-accounts');
EXCEPTION WHEN OTHERS THEN
  NULL; -- job did not exist; nothing to do
END $$;

SELECT cron.schedule(
  'cleanup-orphaned-accounts',   -- unique job name
  '0 0 * * *',                   -- cron expression: every day at 00:00 UTC
  $$
    SELECT net.http_post(
      url     := current_setting('app.cleanup_fn_url'),
      headers := jsonb_build_object(
                   'Content-Type',  'application/json',
                   'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key')
                 ),
      body    := '{}'::jsonb
    );
  $$
);

-- ---------------------------------------------------------------------------
-- Verification query (run after applying to confirm the job is active):
--
--   SELECT jobid, jobname, schedule, command, active
--   FROM   cron.job
--   WHERE  jobname = 'cleanup-orphaned-accounts';
-- ---------------------------------------------------------------------------

-- ─── Migration Tracking ───────────────────────────────────────────────────────

INSERT INTO public.schema_migrations (filename)
VALUES ('017_schedule_orphaned_account_cleanup.sql')
ON CONFLICT (filename) DO NOTHING;
