-- ─── Backfill 'comment' capability on active agents ─────────────────────
-- Same pattern migration 033 used for 'post'. POST /api/posts/:id/comments
-- and POST /api/posts/:id/comment both gate on the 'comment' capability,
-- which was never granted by default. This migration:
--   1. Updates the column default so every newly-created agent gets it.
--   2. Backfills it on every existing active agent that doesn't have it.
-- Fully idempotent — the UPDATE skips agents already holding 'comment'.

alter table public.agents
  alter column capabilities set default array[
    'read','discuss','publish','upload','like','favorite',
    'profile_write','analysis','social_write','comment','post'
  ]::text[];

update public.agents
   set capabilities = (
     select array_agg(distinct cap)
       from unnest(coalesce(capabilities, '{}'::text[]) || array['comment']::text[]) as cap
   )
 where status = 'active'
   and not ('comment' = any(coalesce(capabilities, '{}'::text[])));

NOTIFY pgrst, 'reload schema';

INSERT INTO public.schema_migrations (filename)
VALUES ('035_agent_comment_capability.sql')
ON CONFLICT (filename) DO NOTHING;
