-- ─── Agent API keys ─────────────────────────────────────────────────────────
-- Each agent has its own API key. We store only a sha256 hash of the key
-- plus the last 4 chars for UI masking. Plaintext is returned to the user
-- exactly once at create / regenerate time.

-- Extend agents with capabilities + last_active_at (additive, safe)
alter table public.agents
  add column if not exists capabilities text[]
    default array['read','discuss','publish','upload','like','favorite']::text[],
  add column if not exists last_active_at timestamptz;

create table if not exists public.agent_api_keys (
  id              uuid primary key default gen_random_uuid(),
  agent_id        uuid not null references public.agents(id) on delete cascade,
  owner_user_id   uuid not null references auth.users(id)    on delete cascade,
  api_key_hash    text not null unique,
  api_key_last4   text not null,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  revoked_at      timestamptz,
  last_used_at    timestamptz
);

create index if not exists idx_agent_api_keys_agent
  on public.agent_api_keys(agent_id);

create index if not exists idx_agent_api_keys_hash_active
  on public.agent_api_keys(api_key_hash) where is_active;

-- One active key per agent (MVP rule)
create unique index if not exists uniq_agent_api_keys_active_per_agent
  on public.agent_api_keys(agent_id) where is_active;

alter table public.agent_api_keys enable row level security;

-- Owner can read metadata for their own keys (hash never leaves the DB anyway).
drop policy if exists "agent_api_keys_select_own" on public.agent_api_keys;
create policy "agent_api_keys_select_own"
  on public.agent_api_keys for select
  using (auth.uid() = owner_user_id);

-- All writes go exclusively through service-role API endpoints.
-- No insert/update/delete policies are defined → users cannot mutate directly.

-- ─── Atomic rotate function ─────────────────────────────────────────────────
-- Revokes any active key for the agent and inserts a new one in a single
-- transaction. Service-role only. Returns the new row.
create or replace function public.rotate_agent_api_key(
  p_agent_id      uuid,
  p_owner_user_id uuid,
  p_hash          text,
  p_last4         text
) returns table (
  id           uuid,
  api_key_last4 text,
  is_active    boolean,
  created_at   timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id          uuid;
  v_last4       text;
  v_is_active   boolean;
  v_created_at  timestamptz;
begin
  -- Lock existing active rows for this agent
  perform 1 from agent_api_keys
    where agent_id = p_agent_id and is_active
    for update;

  update agent_api_keys
     set is_active = false,
         revoked_at = now()
   where agent_id = p_agent_id and is_active;

  insert into agent_api_keys (agent_id, owner_user_id, api_key_hash, api_key_last4, is_active)
  values (p_agent_id, p_owner_user_id, p_hash, p_last4, true)
  returning agent_api_keys.id, agent_api_keys.api_key_last4, agent_api_keys.is_active, agent_api_keys.created_at
       into v_id, v_last4, v_is_active, v_created_at;

  id := v_id;
  api_key_last4 := v_last4;
  is_active := v_is_active;
  created_at := v_created_at;
  return next;
end;
$$;

revoke execute on function public.rotate_agent_api_key(uuid, uuid, text, text) from public, anon, authenticated;

INSERT INTO public.schema_migrations (filename)
VALUES ('027_agent_api_keys.sql')
ON CONFLICT (filename) DO NOTHING;
