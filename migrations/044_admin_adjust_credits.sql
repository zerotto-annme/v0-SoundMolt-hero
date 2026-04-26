-- ─── AI Producer Review module — Stage 5 hotfix ───
--
-- Atomic credit adjustment for the admin "User Credits" panel.
--
-- Why this exists:
--   The previous JS implementation in
--     app/api/admin/ai-producer/credits/route.ts
--   did:    read balance → upsert balance → insert ledger row
--   in 3 separate round-trips with no row lock. That was a race
--   condition (two concurrent admin clicks could lose a delta) AND
--   a partial-failure window (balance updated, ledger insert silently
--   swallowed → audit-log mismatch).
--
-- This function does the whole thing in ONE atomic SQL statement
-- block, taking a row-level lock on user_credits.user_id so concurrent
-- admin clicks serialize cleanly.
--
-- Behaviour matches the existing API contract exactly:
--   • action='add'   → new = max(0, current + amount). amount required.
--   • action='set'   → new = max(0, amount).            amount required.
--   • action='reset' → new = 0.                          amount ignored.
--
-- A credit_transactions row (type='admin_gift',
-- reason='admin manual adjustment') is written iff the signed delta
-- is non-zero — so no-op clicks don't pollute the ledger.
--
-- Returns the same shape the route used to build by hand so the API
-- layer is a thin pass-through.
--
-- SECURITY DEFINER lets the service-role API call this function with
-- the same privileges the Node code had; we still revoke EXECUTE from
-- anon/authenticated so only the admin client can invoke it.

create or replace function public.admin_adjust_credits(
  p_user_id uuid,
  p_action  text,
  p_amount  integer
)
returns table (
  user_id          uuid,
  previous_balance integer,
  credits_balance  integer,
  delta            integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current integer := 0;
  v_new     integer;
  v_delta   integer;
begin
  if p_action not in ('add', 'set', 'reset') then
    raise exception 'invalid_action: %', p_action
      using errcode = '22023';
  end if;

  if p_action <> 'reset' and p_amount is null then
    raise exception 'amount_required for action %', p_action
      using errcode = '22023';
  end if;

  -- Lock the row (or nothing — we'll insert below if missing).
  -- INSERT … ON CONFLICT DO UPDATE … RETURNING handles both cases
  -- atomically, but we need the *previous* balance for the ledger,
  -- so do it in two locked steps inside the same transaction.
  select credits_balance
    into v_current
    from public.user_credits
   where user_id = p_user_id
     for update;

  if not found then
    v_current := 0;
  end if;

  if p_action = 'add' then
    v_new := greatest(0, v_current + coalesce(p_amount, 0));
  elsif p_action = 'set' then
    v_new := greatest(0, coalesce(p_amount, 0));
  else  -- 'reset'
    v_new := 0;
  end if;

  v_delta := v_new - v_current;

  insert into public.user_credits (user_id, credits_balance)
       values (p_user_id, v_new)
  on conflict (user_id) do update
       set credits_balance = excluded.credits_balance;

  if v_delta <> 0 then
    insert into public.credit_transactions (user_id, amount, type, reason)
         values (p_user_id, v_delta, 'admin_gift', 'admin manual adjustment');
  end if;

  return query
    select p_user_id, v_current, v_new, v_delta;
end;
$$;

-- Lock the RPC down. PUBLIC always exists; anon/authenticated only
-- exist in Supabase, so we wrap them in a guarded DO-block so this
-- file is also runnable against a vanilla Postgres instance for
-- local sanity checks.
revoke all on function public.admin_adjust_credits(uuid, text, integer) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.admin_adjust_credits(uuid, text, integer) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.admin_adjust_credits(uuid, text, integer) from authenticated';
  end if;
end$$;

-- Force PostgREST to reload its schema cache so the RPC is visible.
NOTIFY pgrst, 'reload schema';

INSERT INTO public.schema_migrations (filename)
VALUES ('044_admin_adjust_credits.sql')
ON CONFLICT (filename) DO NOTHING;
