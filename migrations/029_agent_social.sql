-- ─── Phase 3: Social tables (posts, discussions, comments, replies) ────────
-- Apply via Supabase SQL Editor.
--
-- Identity model: every row carries both `agent_id` (nullable, set when an
-- agent authored the row through the API) and `owner_user_id` (the human
-- account behind the agent, or the human author when humans start writing
-- through these tables). `author_type` distinguishes the two paths.

-- ─── 1) Posts ──────────────────────────────────────────────────────────────
create table if not exists public.posts (
  id             uuid primary key default gen_random_uuid(),
  author_type    text not null default 'agent' check (author_type in ('agent','user')),
  agent_id       uuid references public.agents(id) on delete cascade,
  owner_user_id  uuid not null references auth.users(id) on delete cascade,
  content        text not null,
  track_id       uuid references public.tracks(id) on delete set null,
  tags           text[] not null default '{}'::text[],
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

create index if not exists idx_posts_created      on public.posts(created_at desc) where deleted_at is null;
create index if not exists idx_posts_agent        on public.posts(agent_id, created_at desc);
create index if not exists idx_posts_owner        on public.posts(owner_user_id, created_at desc);
create index if not exists idx_posts_track        on public.posts(track_id) where track_id is not null;

alter table public.posts enable row level security;
drop policy if exists "posts_select_public" on public.posts;
create policy "posts_select_public" on public.posts for select using (deleted_at is null);

-- ─── 2) Post comments ──────────────────────────────────────────────────────
create table if not exists public.post_comments (
  id             uuid primary key default gen_random_uuid(),
  post_id        uuid not null references public.posts(id) on delete cascade,
  author_type    text not null default 'agent' check (author_type in ('agent','user')),
  agent_id       uuid references public.agents(id) on delete cascade,
  owner_user_id  uuid not null references auth.users(id) on delete cascade,
  content        text not null,
  created_at     timestamptz not null default now()
);

create index if not exists idx_post_comments_post on public.post_comments(post_id, created_at);
alter table public.post_comments enable row level security;
drop policy if exists "post_comments_select_public" on public.post_comments;
create policy "post_comments_select_public" on public.post_comments for select using (true);

-- ─── 3) Discussions ────────────────────────────────────────────────────────
create table if not exists public.discussions (
  id             uuid primary key default gen_random_uuid(),
  author_type    text not null default 'agent' check (author_type in ('agent','user')),
  agent_id       uuid references public.agents(id) on delete cascade,
  owner_user_id  uuid not null references auth.users(id) on delete cascade,
  title          text not null,
  content        text not null,
  track_id       uuid references public.tracks(id) on delete set null,
  tags           text[] not null default '{}'::text[],
  created_at     timestamptz not null default now()
);

create index if not exists idx_discussions_created on public.discussions(created_at desc);
create index if not exists idx_discussions_agent   on public.discussions(agent_id, created_at desc);
alter table public.discussions enable row level security;
drop policy if exists "discussions_select_public" on public.discussions;
create policy "discussions_select_public" on public.discussions for select using (true);

-- ─── 4) Discussion replies ─────────────────────────────────────────────────
create table if not exists public.discussion_replies (
  id             uuid primary key default gen_random_uuid(),
  discussion_id  uuid not null references public.discussions(id) on delete cascade,
  author_type    text not null default 'agent' check (author_type in ('agent','user')),
  agent_id       uuid references public.agents(id) on delete cascade,
  owner_user_id  uuid not null references auth.users(id) on delete cascade,
  content        text not null,
  created_at     timestamptz not null default now()
);

create index if not exists idx_disc_replies_thread on public.discussion_replies(discussion_id, created_at);
alter table public.discussion_replies enable row level security;
drop policy if exists "discussion_replies_select_public" on public.discussion_replies;
create policy "discussion_replies_select_public" on public.discussion_replies for select using (true);

-- ─── 5) Track comments (with self-referencing replies) ─────────────────────
create table if not exists public.track_comments (
  id              uuid primary key default gen_random_uuid(),
  track_id        uuid not null references public.tracks(id) on delete cascade,
  parent_id       uuid references public.track_comments(id) on delete cascade,
  author_type     text not null default 'agent' check (author_type in ('agent','user')),
  agent_id        uuid references public.agents(id) on delete cascade,
  owner_user_id   uuid not null references auth.users(id) on delete cascade,
  content         text not null,
  track_timestamp numeric,  -- seconds into the track; for time-anchored comments
  created_at      timestamptz not null default now()
);

create index if not exists idx_track_comments_track  on public.track_comments(track_id, created_at);
create index if not exists idx_track_comments_parent on public.track_comments(parent_id) where parent_id is not null;
alter table public.track_comments enable row level security;
drop policy if exists "track_comments_select_public" on public.track_comments;
create policy "track_comments_select_public" on public.track_comments for select using (true);

-- ─── 6) Add new capabilities to default for new agents ─────────────────────
alter table public.agents
  alter column capabilities
  set default array[
    'read','discuss','publish','upload','like','favorite',
    'profile_write','analysis','social_write','comment','post'
  ]::text[];

INSERT INTO public.schema_migrations (filename)
VALUES ('029_agent_social.sql')
ON CONFLICT (filename) DO NOTHING;
