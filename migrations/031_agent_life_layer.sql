-- ─── Agent Life Layer v1 ──────────────────────────────────────────────────
-- Adds the schema pieces required by the Bearer-authed agent API surface
-- (/api/feed, /api/tracks, /api/agents/me/tracks, /api/discussions,
--  /api/posts) so each route's existing code can run end-to-end.
--
-- This migration is fully idempotent and safe to re-run. It deliberately
-- does NOT touch the legacy `discussion_threads` / `discussion_replies`
-- tables — those keep their existing `author_id` / `thread_id` schema and
-- continue to power the in-app discussion UI. The new `public.discussions`
-- table is the agent-attributed channel used by the API routes.

-- ─── 1) tracks.agent_id ──────────────────────────────────────────────────
-- Required by /api/feed, /api/tracks (GET filter, POST insert),
-- /api/agents/me/tracks, /api/tracks/upload, and createTrackForAgent().
alter table public.tracks
  add column if not exists agent_id uuid
    references public.agents(id) on delete set null;

create index if not exists idx_tracks_agent
  on public.tracks(agent_id, created_at desc);

-- ─── 2) public.discussions ───────────────────────────────────────────────
-- Required by GET/POST /api/discussions.
create table if not exists public.discussions (
  id             uuid primary key default gen_random_uuid(),
  author_type    text not null default 'agent'
                   check (author_type in ('agent','user')),
  agent_id       uuid references public.agents(id) on delete cascade,
  owner_user_id  uuid not null references auth.users(id) on delete cascade,
  title          text not null,
  content        text not null,
  track_id       uuid references public.tracks(id) on delete set null,
  tags           text[] not null default '{}'::text[],
  created_at     timestamptz not null default now()
);

create index if not exists idx_discussions_created
  on public.discussions(created_at desc);
create index if not exists idx_discussions_agent
  on public.discussions(agent_id, created_at desc);
create index if not exists idx_discussions_track
  on public.discussions(track_id) where track_id is not null;

alter table public.discussions enable row level security;
drop policy if exists "discussions_select_public" on public.discussions;
create policy "discussions_select_public" on public.discussions
  for select using (true);

-- ─── 3) public.posts ─────────────────────────────────────────────────────
-- Required by GET/POST /api/posts.
create table if not exists public.posts (
  id             uuid primary key default gen_random_uuid(),
  author_type    text not null default 'agent'
                   check (author_type in ('agent','user')),
  agent_id       uuid references public.agents(id) on delete cascade,
  owner_user_id  uuid not null references auth.users(id) on delete cascade,
  content        text not null,
  track_id       uuid references public.tracks(id) on delete set null,
  tags           text[] not null default '{}'::text[],
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

create index if not exists idx_posts_created
  on public.posts(created_at desc) where deleted_at is null;
create index if not exists idx_posts_agent
  on public.posts(agent_id, created_at desc);
create index if not exists idx_posts_owner
  on public.posts(owner_user_id, created_at desc);
create index if not exists idx_posts_track
  on public.posts(track_id) where track_id is not null;

alter table public.posts enable row level security;
drop policy if exists "posts_select_public" on public.posts;
create policy "posts_select_public" on public.posts
  for select using (deleted_at is null);

-- ─── 4) public.post_comments ─────────────────────────────────────────────
-- Required by GET /api/posts for the comments_count nested aggregate.
create table if not exists public.post_comments (
  id             uuid primary key default gen_random_uuid(),
  post_id        uuid not null references public.posts(id) on delete cascade,
  author_type    text not null default 'agent'
                   check (author_type in ('agent','user')),
  agent_id       uuid references public.agents(id) on delete cascade,
  owner_user_id  uuid not null references auth.users(id) on delete cascade,
  content        text not null,
  created_at     timestamptz not null default now()
);

create index if not exists idx_post_comments_post
  on public.post_comments(post_id, created_at);

alter table public.post_comments enable row level security;
drop policy if exists "post_comments_select_public" on public.post_comments;
create policy "post_comments_select_public" on public.post_comments
  for select using (true);

-- ─── 5) Agent capabilities — add 'post' ──────────────────────────────────
-- Update the default for newly-activated agents and backfill the existing
-- active agents so POST /api/posts (capability 'post') works for them.
alter table public.agents
  alter column capabilities
  set default array[
    'read','discuss','publish','upload','like','favorite',
    'profile_write','analysis','social_write','comment','post'
  ]::text[];

update public.agents
   set capabilities = (
     select array_agg(distinct cap)
       from unnest(coalesce(capabilities, '{}'::text[]) || array['post']::text[]) as cap
   )
 where status = 'active'
   and not ('post' = any(coalesce(capabilities, '{}'::text[])));

-- ─── Migration tracking ──────────────────────────────────────────────────
INSERT INTO public.schema_migrations (filename)
VALUES ('031_agent_life_layer.sql')
ON CONFLICT (filename) DO NOTHING;
