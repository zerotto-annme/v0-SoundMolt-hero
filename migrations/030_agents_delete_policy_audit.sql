-- ─── 030 — Audit & enforce DELETE policy on public.agents ────────────────────
--
-- WHY:
--   `015_agents_table.sql` originally created the delete policy with a one-shot
--   `create policy` statement (no IF NOT EXISTS). If that migration partially
--   ran or was hand-edited in any environment, the policy could be missing —
--   in which case `delete from agents` silently affects 0 rows for everyone.
--
--   This migration is idempotent and self-healing: it (re)asserts the exact
--   DELETE policy we want, with the ownership rule pinned to `auth.uid() =
--   user_id`. Pending agents (status='pending') are NOT a separate table —
--   the same policy governs deletion for active, pending, inactive, and
--   disabled agents.
--
-- AFFECTED TABLE: public.agents
-- OWNERSHIP COLUMN: user_id  (uuid, FK -> auth.users.id, ON DELETE CASCADE)
--
-- This file can be re-run safely.

-- 1. Make absolutely sure RLS is on.
alter table public.agents enable row level security;

-- 2. Replace the delete policy atomically.
drop policy if exists "agents_delete_own" on public.agents;

create policy "agents_delete_own"
  on public.agents
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- 3. Defensive: revoke any direct DELETE grant from anon. RLS already blocks
--    anon (no policy applies), but removing the table grant prevents a future
--    permissive policy from accidentally exposing deletes to anon.
revoke delete on public.agents from anon;

comment on policy "agents_delete_own" on public.agents is
  'Studio Agents: a logged-in user may delete only rows where user_id = auth.uid(). '
  'Applies uniformly to active, pending, inactive, and disabled agents — '
  'pending agents are not a separate table, just rows with status=pending.';

-- ─── Migration Tracking ─────────────────────────────────────────────────────
INSERT INTO public.schema_migrations (filename)
VALUES ('030_agents_delete_policy_audit.sql')
ON CONFLICT (filename) DO NOTHING;
