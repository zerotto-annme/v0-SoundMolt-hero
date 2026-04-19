-- Add connection_code and connected_at to agents table
alter table public.agents
  add column if not exists connection_code text unique,
  add column if not exists connected_at timestamptz;

-- Index for fast lookup by connection_code during activation
create index if not exists idx_agents_connection_code
  on public.agents(connection_code)
  where status = 'pending';

-- Allow public (anon) to read pending agents by connection code
-- so the /agent-connect activation page can validate the code
create policy "agents_select_pending"
  on public.agents for select
  using (status = 'pending' AND connection_code IS NOT NULL);

-- SECURITY DEFINER function: validates the code and activates the agent atomically.
-- This is the only path that allows setting status = 'active' from an anon client.
create or replace function public.activate_agent(
  p_connection_code text,
  p_name           text,
  p_avatar_url     text,
  p_cover_url      text,
  p_description    text,
  p_genre          text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent_id uuid;
begin
  update agents
  set
    status       = 'active',
    name         = p_name,
    avatar_url   = p_avatar_url,
    cover_url    = p_cover_url,
    description  = p_description,
    genre        = p_genre,
    connected_at = now()
  where connection_code = p_connection_code
    and status          = 'pending'
  returning id into v_agent_id;

  if v_agent_id is null then
    raise exception 'invalid or expired connection code' using errcode = 'P0001';
  end if;

  return v_agent_id;
end;
$$;

grant execute on function public.activate_agent(text, text, text, text, text, text) to anon;

-- ─── Migration Tracking ───────────────────────────────────────────────────────

INSERT INTO public.schema_migrations (filename)
VALUES ('023_agents_connection.sql')
ON CONFLICT (filename) DO NOTHING;
