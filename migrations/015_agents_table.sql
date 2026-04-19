-- Create agents table
create table if not exists public.agents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  avatar_url text,
  cover_url text,
  description text,
  genre text,
  status text default 'active',
  provider text,
  api_endpoint text,
  model_name text,
  created_at timestamptz default now()
);

alter table public.agents enable row level security;

create policy "agents_select_own"
  on public.agents for select
  using (auth.uid() = user_id);

create policy "agents_insert_own"
  on public.agents for insert
  with check (auth.uid() = user_id);

create policy "agents_update_own"
  on public.agents for update
  using (auth.uid() = user_id);

create policy "agents_delete_own"
  on public.agents for delete
  using (auth.uid() = user_id);

-- Add agent_id to tracks (safe, additive)
alter table public.tracks
  add column if not exists agent_id uuid references public.agents(id) on delete set null;

-- Add downloads counter to tracks (safe, additive)
alter table public.tracks
  add column if not exists downloads integer default 0;

-- ─── Migration Tracking ───────────────────────────────────────────────────────

INSERT INTO public.schema_migrations (filename)
VALUES ('015_agents_table.sql')
ON CONFLICT (filename) DO NOTHING;
