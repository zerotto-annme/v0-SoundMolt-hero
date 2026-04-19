-- Migration 021: Schedule automatic cleanup of stale rate-limit rows
--
-- The cleanup_rate_limit_requests() function (defined in 017_rate_limit_table.sql)
-- deletes rows whose window_start is older than 2 × WINDOW_MS (120 000 ms = 2 minutes).
-- Without a scheduled caller those stale rows accumulate indefinitely.
--
-- This migration registers a pg_cron job that calls the function every 10 minutes,
-- which is more than frequent enough given that all rows older than 2 minutes are
-- already past their useful life.
--
-- Prerequisites:
--   • pg_cron extension enabled (Supabase dashboard → Database → Extensions)
--     No pg_net required — the job calls the SQL function directly.
--   • cleanup_rate_limit_requests() exists (migration 017_rate_limit_table.sql applied)
--
-- Idempotency:
--   Unschedules any existing job with the same name before re-creating it,
--   so this file can be re-run safely.
--
-- To verify:
--   SELECT jobid, jobname, schedule, command, active
--   FROM   cron.job
--   WHERE  jobname = 'cleanup-rate-limit-requests';
--
-- To unschedule manually:
--   SELECT cron.unschedule('cleanup-rate-limit-requests');
--
-- Schedule:
--   */10 * * * *  →  every 10 minutes

-- ---------------------------------------------------------------------------
-- 1. Ensure pg_cron is available
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ---------------------------------------------------------------------------
-- 2. Remove any existing job with this name so re-runs are safe
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  PERFORM cron.unschedule('cleanup-rate-limit-requests');
EXCEPTION WHEN OTHERS THEN
  NULL; -- job did not exist; nothing to do
END $$;

-- ---------------------------------------------------------------------------
-- 3. Schedule the recurring cleanup job
-- ---------------------------------------------------------------------------

SELECT cron.schedule(
  'cleanup-rate-limit-requests',  -- unique job name
  '*/10 * * * *',                 -- every 10 minutes
  $$ SELECT cleanup_rate_limit_requests(); $$
);

-- ---------------------------------------------------------------------------
-- Verification query (run after applying to confirm the job is active):
--
--   SELECT jobid, jobname, schedule, command, active
--   FROM   cron.job
--   WHERE  jobname = 'cleanup-rate-limit-requests';
-- ---------------------------------------------------------------------------

-- ─── Migration Tracking ───────────────────────────────────────────────────────

INSERT INTO public.schema_migrations (filename)
VALUES ('021_schedule_rate_limit_cleanup.sql')
ON CONFLICT (filename) DO NOTHING;
