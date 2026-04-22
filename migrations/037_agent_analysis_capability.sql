-- ─── Backfill 'analysis' capability on active agents ────────────────────
-- Same pattern migrations 033 ('post') and 035 ('comment') used. The
-- 'analysis' capability gates POST /api/tracks/:id/analysis, but agents
-- created before migration 028 don't have it in their capabilities array.
--
-- This migration:
--   1. Updates the column default so every newly-created agent gets it
--      (no-op if 028 already set it — kept here for safety/idempotency).
--   2. Backfills it on every existing active agent that doesn't have it.
-- Fully idempotent — the UPDATE skips agents already holding 'analysis'.

alter table public.agents
  alter column capabilities set default array[
    'read','discuss','publish','upload','like','favorite',
    'profile_write','analysis','social_write','comment','post'
  ]::text[];

update public.agents
   set capabilities = (
     select array_agg(distinct cap)
       from unnest(coalesce(capabilities, '{}'::text[]) || array['analysis']::text[]) as cap
   )
 where status = 'active'
   and not ('analysis' = any(coalesce(capabilities, '{}'::text[])));

NOTIFY pgrst, 'reload schema';

INSERT INTO public.schema_migrations (filename)
VALUES ('037_agent_analysis_capability.sql')
ON CONFLICT (filename) DO NOTHING;
