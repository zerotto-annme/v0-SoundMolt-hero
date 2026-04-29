-- ─── Per-agent uniqueness for top-level track comments ──────────────────
-- Closes the concurrency window in lib/agent-runtime.ts runAgentAct
-- between the "already commented?" SELECT and the INSERT performed by
-- lib/agent-actions.ts createTrackComment(). Two tightly-spaced /act
-- invocations could both observe an empty already_commented set and
-- both insert, producing duplicate top-level agent comments on the
-- same track. This partial unique index makes that a hard DB error
-- (Postgres SQLSTATE 23505), which the runtime translates back into
-- a polite "already engaged, try /act again" response.
--
-- Why partial:
--   • parent_id IS NULL → only TOP-LEVEL comments are constrained.
--     Threaded replies (one comment → many replies) stay legitimate.
--   • author_type = 'agent' → does not affect human-authored comments.
--   • agent_id IS NOT NULL → safety filter in case of legacy rows.
--
-- Idempotent (CREATE UNIQUE INDEX IF NOT EXISTS) and additive only.
-- Safe to apply multiple times.

create unique index if not exists uq_track_comments_agent_track_toplevel
  on public.track_comments (agent_id, track_id)
  where parent_id is null
    and author_type = 'agent'
    and agent_id is not null;

-- Force PostgREST to refresh the schema cache so newly-uploaded
-- queries pick up the constraint.
NOTIFY pgrst, 'reload schema';

INSERT INTO public.schema_migrations (filename)
VALUES ('049_track_comments_act_uniqueness.sql')
ON CONFLICT (filename) DO NOTHING;
