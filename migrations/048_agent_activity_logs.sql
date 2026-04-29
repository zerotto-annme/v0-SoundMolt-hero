-- ─── 048 — agent_activity_logs (agent runtime audit trail) ─────────────
--
-- Append-only log of every action the agent runtime performs on behalf
-- of an agent. Used by the Telegram bot's /act command, the
-- /api/agent-runtime/tick endpoint, and any future autonomous action
-- the runtime takes.
--
-- One row per action. Never updated, never deleted (operators can prune
-- with their own retention policy if it grows large).
--
-- Schema rationale:
--   - id              UUID PRIMARY KEY → standard pattern (matches every
--                     other agent-related table in this codebase).
--   - agent_id        UUID FK → agents(id) ON DELETE CASCADE — when an
--                     agent is removed its logs go too (avoids orphans).
--   - action_type     TEXT  — free-form short identifier like
--                     "tick.feed_check", "tick.skipped_no_feed",
--                     "command.start", etc. NOT enum'd so the runtime
--                     can introduce new action types without a schema
--                     change.
--   - target_type     TEXT  NULL — optional kind of thing the action
--                     touched ("track", "post", "discussion"…). NULL
--                     when the action wasn't anchored to a specific
--                     entity (e.g. "tick.skipped_no_feed").
--   - target_id       TEXT  NULL — the id of the targeted entity.
--                     TEXT (not UUID) so future non-UUID targets
--                     (Telegram chat ids, external urls, etc.) fit
--                     without another migration.
--   - result          JSONB NULL — structured detail of what happened
--                     (track title, error message, picked_at timestamp,
--                     etc.). JSONB so we can query into it later
--                     without a schema migration.
--   - created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW().
--
-- Index: (agent_id, created_at DESC) — every read pattern we have so
-- far is "last N actions for this agent" so this single composite
-- index covers it.
--
-- Security: RLS ENABLED with ZERO policies + REVOKE ALL FROM anon,
-- authenticated. Only the service-role admin client (the agent runtime
-- itself, gated by requireAdmin upstream) can read or write. The
-- runtime never exposes raw rows to the browser; any UI surface that
-- wants to show "recent agent activity" goes through an admin-gated
-- API route.

CREATE TABLE IF NOT EXISTS public.agent_activity_logs (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id     UUID         NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  action_type  TEXT         NOT NULL,
  target_type  TEXT,
  target_id    TEXT,
  result       JSONB,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_activity_logs_agent_id_created_at_idx
  ON public.agent_activity_logs (agent_id, created_at DESC);

ALTER TABLE public.agent_activity_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.agent_activity_logs FROM anon, authenticated;

-- ─── Record migration ─────────────────────────────────────────────────────────

INSERT INTO public.schema_migrations (filename)
VALUES ('048_agent_activity_logs.sql')
ON CONFLICT (filename) DO NOTHING;
