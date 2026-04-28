-- ─── 045 — Agent Telegram bot connections (admin-only) ─────────────────────
--
-- One row per agent that has a Telegram bot connected. The relationship is
-- 1:1 (agent_id is PRIMARY KEY) — an agent has either zero or one connected
-- bot. Reconnecting a different bot is done by UPSERT (admin endpoint
-- replaces the existing row).
--
-- SECURITY MODEL:
--   - RLS is ENABLED with NO policies. This means anon and authenticated
--     roles cannot SELECT, INSERT, UPDATE, or DELETE any rows. Only the
--     service-role admin client (used by the admin API endpoints, gated by
--     requireAdmin()) can touch this table. The bot_token is therefore
--     never reachable from the browser; it stays server-side.
--   - Bot tokens are stored as plain TEXT (consistent with how other
--     server-only secrets are handled in this project, e.g. agent_api_keys
--     digests and the supabase service role key in env vars). The Supabase
--     project itself is the trust boundary.
--
-- COLUMNS:
--   agent_id       — FK to public.agents(id); cascade delete when the
--                    agent is removed (admin user-delete already cascades
--                    agents → this).
--   bot_token      — Telegram Bot API token, e.g. "123456:AA...". Required.
--   bot_username   — Resolved from Telegram getMe at connect time, stored
--                    so the admin UI can render "@username" in the agents
--                    table without an extra API round-trip per render.
--   bot_id         — Numeric id from Telegram getMe (BIGINT — Telegram bot
--                    ids exceed INT range).
--   admin_chat_id  — The Telegram chat id where the admin wants to receive
--                    test messages. Optional at connect time; the admin
--                    sets it via the Telegram Settings modal before
--                    clicking "Test Telegram". Stored as BIGINT so it can
--                    hold negative values for group/channel ids.
--   created_at     — Initial connect timestamp.
--   updated_at     — Last update timestamp (token refresh, chat id change).
--
-- IDEMPOTENCY: uses IF NOT EXISTS / DO $$...$$ guards. Safe to re-run.

-- ─── Table ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.agent_telegram_bots (
  agent_id      UUID         PRIMARY KEY REFERENCES public.agents(id) ON DELETE CASCADE,
  bot_token     TEXT         NOT NULL,
  bot_username  TEXT,
  bot_id        BIGINT,
  admin_chat_id BIGINT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Helpful for any future "look up by bot id" admin diagnostics.
CREATE INDEX IF NOT EXISTS agent_telegram_bots_bot_id_idx
  ON public.agent_telegram_bots(bot_id);

-- ─── Row Level Security ───────────────────────────────────────────────────────
-- RLS ON, ZERO policies → no anon/authenticated access. Only service role
-- (admin API endpoints) can read or write.

ALTER TABLE public.agent_telegram_bots ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.agent_telegram_bots FROM anon, authenticated;

-- ─── updated_at trigger ───────────────────────────────────────────────────────
-- Keep updated_at fresh on every UPDATE. Reuses the standard plpgsql idiom.

CREATE OR REPLACE FUNCTION public.agent_telegram_bots_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agent_telegram_bots_updated_at ON public.agent_telegram_bots;
CREATE TRIGGER agent_telegram_bots_updated_at
  BEFORE UPDATE ON public.agent_telegram_bots
  FOR EACH ROW
  EXECUTE FUNCTION public.agent_telegram_bots_set_updated_at();

-- ─── Record migration ─────────────────────────────────────────────────────────

INSERT INTO public.schema_migrations (filename)
VALUES ('045_agent_telegram_bots.sql')
ON CONFLICT (filename) DO NOTHING;
