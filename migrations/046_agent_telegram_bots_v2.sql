-- ─── 046 — Agent Telegram bot connections (v2 schema) ─────────────────────
--
-- Replaces the schema introduced in 045_agent_telegram_bots.sql. We drop
-- the previous table (if any) and recreate it with the column names and
-- constraints requested by the operator. The DROP+CREATE handles both the
-- "045 was never applied" and "045 was applied with old shape" cases for
-- the **first** run of this migration.
--
-- ⚠ DESTRUCTIVE — DO NOT RE-RUN ON A DATABASE THAT ALREADY APPLIED 046.
--   This file is DDL-idempotent (safe SQL) but NOT data-preserving:
--   every execution drops all stored Telegram connections + bot tokens.
--   The schema_migrations row inserted at the bottom is the safety net —
--   the migration runner must skip files already present there. If you
--   ever need to alter this schema in place, write a new 047_… migration
--   that uses ALTER TABLE additions instead of another DROP+CREATE.
--
-- The CASCADE also tears down the dependent trigger from 045
-- (`agent_telegram_bots_updated_at`). The companion function from 045
-- (`public.agent_telegram_bots_set_updated_at`) is recreated below via
-- CREATE OR REPLACE, so we don't need to drop it explicitly.
--
-- Schema (1 row per agent — `UNIQUE (agent_id)`):
--   id                        UUID  PRIMARY KEY  default gen_random_uuid()
--   agent_id                  UUID  NOT NULL FK → public.agents(id) ON DELETE CASCADE
--   telegram_bot_id           BIGINT  (Telegram bot id, exceeds INT range)
--   telegram_bot_username     TEXT
--   telegram_bot_token        TEXT  (admin-only secret, never returned by APIs)
--   webhook_status            TEXT  default 'pending'
--   is_active                 BOOLEAN  default true
--   created_at / updated_at   TIMESTAMPTZ
--
-- Security:
--   RLS is ENABLED with NO policies, plus REVOKE ALL FROM anon, authenticated.
--   Only the service-role admin client (used by /api/admin/agents/*/telegram*
--   gated by requireAdmin()) can read or write. The bot token therefore
--   never leaves the server.

-- ─── Drop previous shape (if present) ─────────────────────────────────────────
-- IDEMPOTENT: works whether the table exists with the 045 columns, the
-- 046 columns, or not at all. CASCADE removes the trigger too.

DROP TABLE IF EXISTS public.agent_telegram_bots CASCADE;

-- ─── Table ────────────────────────────────────────────────────────────────────

CREATE TABLE public.agent_telegram_bots (
  id                     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id               UUID         NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  telegram_bot_id        BIGINT,
  telegram_bot_username  TEXT,
  telegram_bot_token     TEXT,
  webhook_status         TEXT         NOT NULL DEFAULT 'pending',
  is_active              BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT agent_telegram_bots_agent_id_unique UNIQUE (agent_id)
);

-- Helpful for any future "look up by bot id" admin diagnostics.
CREATE INDEX agent_telegram_bots_telegram_bot_id_idx
  ON public.agent_telegram_bots(telegram_bot_id);

-- ─── Row Level Security ───────────────────────────────────────────────────────
-- RLS ON, ZERO policies → no anon/authenticated access. Only service role
-- (admin API endpoints) can read or write.

ALTER TABLE public.agent_telegram_bots ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.agent_telegram_bots FROM anon, authenticated;

-- ─── updated_at trigger ───────────────────────────────────────────────────────

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
VALUES ('046_agent_telegram_bots_v2.sql')
ON CONFLICT (filename) DO NOTHING;
