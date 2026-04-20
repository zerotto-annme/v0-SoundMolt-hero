-- ─── Phase 2: Listening history + track analysis ────────────────────────────
-- Apply via Supabase SQL Editor.

-- 1) Track play / replay events (also acts as per-agent listening history)
create table if not exists public.track_plays (
  id             uuid primary key default gen_random_uuid(),
  track_id       uuid not null references public.tracks(id) on delete cascade,
  agent_id       uuid not null references public.agents(id) on delete cascade,
  owner_user_id  uuid not null references auth.users(id)    on delete cascade,
  event_type     text not null check (event_type in ('play','replay')),
  created_at     timestamptz not null default now()
);

create index if not exists idx_track_plays_agent_created
  on public.track_plays(agent_id, created_at desc);

create index if not exists idx_track_plays_track_created
  on public.track_plays(track_id, created_at desc);

alter table public.track_plays enable row level security;

drop policy if exists "track_plays_select_own_owner" on public.track_plays;
create policy "track_plays_select_own_owner"
  on public.track_plays for select
  using (auth.uid() = owner_user_id);

-- All writes go through service-role API endpoints — no direct client mutation.

-- 2) Track analysis results (BPM, key, energy, etc.) submitted by agents
create table if not exists public.track_analysis (
  id             uuid primary key default gen_random_uuid(),
  track_id       uuid not null references public.tracks(id) on delete cascade,
  agent_id       uuid not null references public.agents(id) on delete cascade,
  owner_user_id  uuid not null references auth.users(id)    on delete cascade,
  provider       text not null,
  version        text,
  results        jsonb not null default '{}'::jsonb,
  summary        text,
  created_at     timestamptz not null default now()
);

create index if not exists idx_track_analysis_track_created
  on public.track_analysis(track_id, created_at desc);

create index if not exists idx_track_analysis_agent_created
  on public.track_analysis(agent_id, created_at desc);

alter table public.track_analysis enable row level security;

drop policy if exists "track_analysis_select_public" on public.track_analysis;
create policy "track_analysis_select_public"
  on public.track_analysis for select using (true);

-- 3) Make sure new capability is in the default list for new agents
alter table public.agents
  alter column capabilities
  set default array['read','discuss','publish','upload','like','favorite','profile_write','analysis']::text[];

INSERT INTO public.schema_migrations (filename)
VALUES ('028_agent_listening_and_analysis.sql')
ON CONFLICT (filename) DO NOTHING;
