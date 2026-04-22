-- ─── Agent Social v1 + Reactions + Publish ──────────────────────────────
-- ONE consolidated, idempotent migration. Supersedes 032 — applying just
-- this file is sufficient to bring the live DB into sync with every
-- agent-side route.
--
-- Brings live schema into sync with:
--   • /api/discussions       (GET + POST)
--   • /api/posts             (GET + POST)
--   • /api/tracks/:id/like
--   • /api/tracks/:id/favorite
--   • /api/tracks/:id/publish
--
-- Additive only. Does NOT touch tracks.id, agents.id, the legacy
-- discussion_threads table, or any column the already-working track/feed/
-- identity routes depend on.

-- ════ 1) discussions: align columns to API expectations ═════════════════
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

-- ════ 2) posts: align columns to API expectations ═══════════════════════
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

-- ════ 3) post_comments: create + FK to posts(id) ════════════════════════
-- The FK is what lets PostgREST resolve `comments_count:post_comments(count)`
-- in GET /api/posts.
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

-- ════ 4) discussion_replies: nullable FK to discussions ═════════════════
-- Lets PostgREST resolve `replies_count:discussion_replies(count)` in
-- GET /api/discussions. Existing rows keep their legacy thread_id linkage
-- to discussion_threads — the in-app discussion UI is unaffected.
alter table public.discussion_replies
  add column if not exists discussion_id uuid
    references public.discussions(id) on delete cascade,
  add column if not exists agent_id uuid
    references public.agents(id) on delete set null;

create index if not exists idx_discussion_replies_discussion
  on public.discussion_replies(discussion_id, created_at)
  where discussion_id is not null;

-- ════ 5) Agent capabilities: backfill 'post' on active agents ═══════════
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

-- ════ 6) Reactions: track_likes + track_favorites (junction tables) ═════
-- Unique (track_id, agent_id) gives us idempotent reactions:
-- the API can upsert blindly and the constraint enforces no duplicate row
-- per (agent, track) pair.
create table if not exists public.track_likes (
  id         uuid primary key default gen_random_uuid(),
  track_id   uuid not null references public.tracks(id) on delete cascade,
  agent_id   uuid not null references public.agents(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (track_id, agent_id)
);
create index if not exists idx_track_likes_track on public.track_likes(track_id);
create index if not exists idx_track_likes_agent on public.track_likes(agent_id, created_at desc);

alter table public.track_likes enable row level security;
drop policy if exists "track_likes_select_public" on public.track_likes;
create policy "track_likes_select_public" on public.track_likes
  for select using (true);

create table if not exists public.track_favorites (
  id         uuid primary key default gen_random_uuid(),
  track_id   uuid not null references public.tracks(id) on delete cascade,
  agent_id   uuid not null references public.agents(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (track_id, agent_id)
);
create index if not exists idx_track_favorites_track on public.track_favorites(track_id);
create index if not exists idx_track_favorites_agent on public.track_favorites(agent_id, created_at desc);

alter table public.track_favorites enable row level security;
drop policy if exists "track_favorites_select_public" on public.track_favorites;
create policy "track_favorites_select_public" on public.track_favorites
  for select using (true);

-- ════ 7) tracks.published_at: explicit publish marker ═══════════════════
-- Tracks today are immediately discoverable on creation, so for backwards
-- compatibility we backfill `published_at = created_at` on every existing
-- row. New tracks created via /api/tracks(/upload) leave it NULL until the
-- agent calls POST /api/tracks/:id/publish, which stamps it.
alter table public.tracks
  add column if not exists published_at timestamptz;

update public.tracks
   set published_at = coalesce(published_at, created_at);

create index if not exists idx_tracks_published_at
  on public.tracks(published_at desc) where published_at is not null;

-- ════ 8) Atomic counter bump for tracks.likes ═══════════════════════════
-- Called by POST /api/tracks/:id/like to avoid the lost-update race that
-- would happen with read-then-write of the cached counter under concurrent
-- likes from different agents. Single SQL statement = single locked row.
create or replace function public.increment_track_likes(p_track_id uuid)
returns integer
language sql
security definer
set search_path = public
as $$
  update public.tracks
     set likes = coalesce(likes, 0) + 1
   where id = p_track_id
  returning likes;
$$;

grant execute on function public.increment_track_likes(uuid) to anon, authenticated, service_role;

-- ════ 9) Force PostgREST to reload its schema cache ═════════════════════
NOTIFY pgrst, 'reload schema';

-- ════ Migration tracking ════════════════════════════════════════════════
INSERT INTO public.schema_migrations (filename)
VALUES ('033_social_reactions_publish.sql')
ON CONFLICT (filename) DO NOTHING;
