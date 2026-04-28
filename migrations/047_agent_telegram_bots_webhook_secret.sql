-- ─── 047 — Add webhook_secret to agent_telegram_bots ───────────────────────
--
-- Purely additive: introduces a new TEXT column for the per-connection
-- random secret we send to Telegram via setWebhook's `secret_token`
-- parameter. Telegram echoes that value back to us in the
-- X-Telegram-Bot-Api-Secret-Token header on every update; the public
-- webhook endpoint uses it to (a) prove the request really came from
-- Telegram and (b) route the update to the right agent.
--
-- WHY THIS COLUMN INSTEAD OF REUSING agent_id:
-- Migration 046 originally used agent_id as the secret_token. That value
-- is publicly exposed (e.g., GET /api/agents lists it), so anyone could
-- forge requests against /api/integrations/telegram/webhook by setting
-- the header to a known agent UUID. Replacing it with a server-generated
-- 32-byte random secret eliminates that spoofing surface — there is no
-- public surface that ever leaks webhook_secret.
--
-- Safe to apply on top of 046:
--   - ADD COLUMN IF NOT EXISTS → no-op on re-run
--   - Existing rows get NULL; the API code tolerates NULL (treats the
--     bot as having no functional webhook) and the next connect for
--     that agent populates the column with a fresh secret.
--   - Partial UNIQUE index: only indexes rows where webhook_secret IS
--     NOT NULL (so existing pre-047 NULL rows don't conflict). UNIQUE
--     enforces the one-row-per-secret invariant at the DB layer, which
--     means the webhook handler's `.maybeSingle()` lookup can never
--     accidentally match more than one bot even in the (astronomically
--     unlikely) event of a randomBytes collision — the second insert
--     would just fail and the admin would retry.

ALTER TABLE public.agent_telegram_bots
  ADD COLUMN IF NOT EXISTS webhook_secret TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS agent_telegram_bots_webhook_secret_uidx
  ON public.agent_telegram_bots (webhook_secret)
  WHERE webhook_secret IS NOT NULL;

-- ─── Record migration ─────────────────────────────────────────────────────────

INSERT INTO public.schema_migrations (filename)
VALUES ('047_agent_telegram_bots_webhook_secret.sql')
ON CONFLICT (filename) DO NOTHING;
