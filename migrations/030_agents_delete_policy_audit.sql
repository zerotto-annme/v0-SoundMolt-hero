-- ─── 030 — Audit & enforce DELETE policy on public.agents ────────────────────
--
-- ROOT CAUSE (proven by reproducing the user-context DELETE on the live DB):
--   - public.agents had no DELETE policy applied to it.
--   - The original `agents_delete_own` line in 015_agents_table.sql either
--     never ran on this Supabase project, or was dropped at some point.
--   - With RLS enabled and no DELETE policy, every DELETE returns HTTP 200
--     but Content-Range: */0 — silently affects 0 rows. That is exactly
--     what the Studio Agents page was seeing.
--
-- This migration is fully idempotent and self-verifying:
--   1. Re-asserts RLS on.
--   2. Drops every known policy name that could conflict (clean slate).
--   3. Creates one explicit FOR DELETE policy: auth.uid() = user_id.
--   4. Revokes direct DELETE grant from anon as defense in depth.
--   5. Raises an exception at the end if the policy somehow isn't present.
--
-- AFFECTED TABLE: public.agents
-- OWNERSHIP COLUMN: user_id (uuid -> auth.users.id, ON DELETE CASCADE)
-- AFFECTS: active, pending, inactive, disabled agents (single table).
-- Safe to re-run.

-- 1. RLS on (no-op if already on).
alter table public.agents enable row level security;

-- 2. Clean slate — drop any prior delete-related policy under any name we
--    or earlier migrations may have created.
drop policy if exists "agents_delete_own"            on public.agents;
drop policy if exists "agents_delete_owner"          on public.agents;
drop policy if exists "Agents can be deleted by owner" on public.agents;
drop policy if exists "Allow delete for owner"       on public.agents;

-- 3. Single canonical DELETE policy.
create policy "agents_delete_own"
  on public.agents
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- 4. Defense in depth: anon should never DELETE rows in this table.
revoke delete on public.agents from anon;

comment on policy "agents_delete_own" on public.agents is
  'Studio Agents: a logged-in user may delete only rows where user_id = auth.uid(). '
  'Applies to all statuses (active, pending, inactive, disabled) — pending is not '
  'a separate table, just rows with status=pending.';

-- 5. Self-verify: fail loudly if the policy somehow didn't get created.
do $$
declare
  has_policy boolean;
begin
  select exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename  = 'agents'
      and policyname = 'agents_delete_own'
      and cmd        = 'DELETE'
  ) into has_policy;

  if not has_policy then
    raise exception
      'Migration 030 failed: agents_delete_own policy not present after DDL. '
      'Studio Agents deletes will silently affect 0 rows.';
  end if;
end $$;

-- ─── Migration Tracking ─────────────────────────────────────────────────────
INSERT INTO public.schema_migrations (filename)
VALUES ('030_agents_delete_policy_audit.sql')
ON CONFLICT (filename) DO NOTHING;
