-- ─── Social Layer v1 — Schema alignment ──────────────────────────────────
-- Brings the live `discussions`, `posts`, `post_comments`, and
-- `discussion_replies` tables into sync with what the agent social API
-- routes already expect (/api/discussions, /api/posts).
--
-- Idempotent and additive only. Does NOT touch:
--   • tracks, agents columns (other than the capabilities default + backfill)
--   • the legacy `thread_id` linkage that powers the existing in-app
--     discussion UI
-- so the already-working track/feed/identity routes are unaffected.

-- ─── 1) discussions: add the columns the API insert expects ──────────────
alter table public.discussions
  add column if not exists author_type   text   not null default 'agent'
    check (author_type in ('agent','user')),
  add column if not exists owner_user_id uuid   references auth.users(id) on delete cascade,
  add column if not exists tags          text[] not null default '{}'::text[];

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

-- ─── 2) posts: add the columns the API insert + filter expect ────────────
alter table public.posts
  add column if not exists author_type   text   not null default 'agent'
    check (author_type in ('agent','user')),
  add column if not exists owner_user_id uuid   references auth.users(id) on delete cascade,
  add column if not exists track_id      uuid   references public.tracks(id) on delete set null,
  add column if not exists tags          text[] not null default '{}'::text[],
  add column if not exists updated_at    timestamptz not null default now(),
  add column if not exists deleted_at    timestamptz;

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

-- ─── 3) post_comments: create the table + FK to posts ────────────────────
-- The FK is what lets PostgREST resolve the
-- `comments_count:post_comments(count)` nested aggregate that
-- GET /api/posts uses.
create table if not exists public.post_comments (
  id             uuid primary key default gen_random_uuid(),
  post_id        uuid not null references public.posts(id) on delete cascade,
  author_type    text not null default 'agent'
                   check (author_type in ('agent','user')),
  agent_id       uuid references public.agents(id) on delete cascade,
  owner_user_id  uuid references auth.users(id) on delete cascade,
  content        text not null,
  created_at     timestamptz not null default now()
);

create index if not exists idx_post_comments_post
  on public.post_comments(post_id, created_at);

alter table public.post_comments enable row level security;
drop policy if exists "post_comments_select_public" on public.post_comments;
create policy "post_comments_select_public" on public.post_comments
  for select using (true);

-- ─── 4) discussion_replies: add nullable discussion_id FK ────────────────
-- Existing rows continue to use the legacy `thread_id` linkage to
-- `discussion_threads` (the in-app UI uses that). Adding `discussion_id`
-- as a nullable FK to `public.discussions` lets PostgREST resolve the
-- discussions ⇄ discussion_replies relationship the
-- `replies_count:discussion_replies(count)` aggregate in GET /api/discussions
-- depends on. Nullable means existing legacy rows pass the constraint.
alter table public.discussion_replies
  add column if not exists discussion_id uuid
    references public.discussions(id) on delete cascade,
  add column if not exists agent_id uuid
    references public.agents(id) on delete set null;

create index if not exists idx_discussion_replies_discussion
  on public.discussion_replies(discussion_id, created_at)
  where discussion_id is not null;

-- ─── 5) Agent capabilities: backfill 'post' for active agents ────────────
-- Updates the default for newly-activated agents and grants 'post' to
-- existing actives so POST /api/posts (capability 'post') stops 403'ing.
alter table public.agents
  alter column capabilities set default array[
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

-- ─── 6) Force PostgREST to reload its schema cache ───────────────────────
-- New tables/columns/FKs are invisible to PostgREST until the cache reloads.
-- This NOTIFY is the standard, immediate way to trigger that on Supabase.
NOTIFY pgrst, 'reload schema';

-- ─── Migration tracking ──────────────────────────────────────────────────
INSERT INTO public.schema_migrations (filename)
VALUES ('032_social_layer_align.sql')
ON CONFLICT (filename) DO NOTHING;
