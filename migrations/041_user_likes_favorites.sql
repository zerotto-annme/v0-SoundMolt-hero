-- ─── Extend track_likes / track_favorites to support real site users ───
--
-- Migration 033 created `track_likes` and `track_favorites` keyed on
-- `agent_id NOT NULL`. Those tables only stored AGENT reactions (driven
-- by POST /api/tracks/:id/{like,favorite}, which uses agent API keys).
--
-- This migration makes both tables polymorphic over the actor: a row
-- represents a reaction from EITHER one user OR one agent. Same table,
-- one source of truth, so:
--
--   • The site Like / Add Favorite buttons (driven by a logged-in user)
--     write here with `user_id` set, `agent_id` null.
--   • The agent endpoints (POST /api/tracks/:id/like, /favorite) keep
--     writing `agent_id` set, `user_id` null — they're untouched.
--   • The cached `tracks.likes` counter is bumped by BOTH paths via the
--     existing increment_track_likes / decrement_track_likes RPCs, so
--     every public-facing display ("X likes" in the feed, modal, charts)
--     reflects user + agent likes combined, plus admin boosts as before
--     (boosts are folded in by the BrowseFeed pipeline reading
--     track_boost_totals).
--
-- Schema changes (additive, idempotent):
--   1. `agent_id` becomes NULLABLE on both tables.
--   2. `user_id uuid` added on both tables, FK to auth.users.
--   3. CHECK constraint enforces exactly one of (user_id, agent_id) is
--      set — no all-null rows, no double-actor rows.
--   4. UNIQUE (track_id, user_id) added so the user POST endpoint can
--      upsert idempotently. The existing UNIQUE (track_id, agent_id) is
--      preserved unchanged so the agent endpoint keeps working as-is.
--      (NULLs are distinct in PG unique constraints, so a user-side row
--      with agent_id=NULL never collides with another user-side row.)
--   5. Index on (user_id, created_at desc) for fast "My Liked" lookups.
--
-- Fully idempotent: every step is wrapped in IF NOT EXISTS or a guarded
-- DO block. Safe to re-run.

-- ════ track_likes ═══════════════════════════════════════════════════════
alter table public.track_likes
  alter column agent_id drop not null;

alter table public.track_likes
  add column if not exists user_id uuid
    references auth.users(id) on delete cascade;

alter table public.track_likes
  drop constraint if exists track_likes_actor_check;

alter table public.track_likes
  add constraint track_likes_actor_check
  check (
    (user_id is not null and agent_id is null) or
    (user_id is null and agent_id is not null)
  );

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'track_likes_track_user_unique'
  ) then
    alter table public.track_likes
      add constraint track_likes_track_user_unique
      unique (track_id, user_id);
  end if;
end$$;

create index if not exists idx_track_likes_user_created
  on public.track_likes(user_id, created_at desc)
  where user_id is not null;

-- ════ track_favorites ═══════════════════════════════════════════════════
alter table public.track_favorites
  alter column agent_id drop not null;

alter table public.track_favorites
  add column if not exists user_id uuid
    references auth.users(id) on delete cascade;

alter table public.track_favorites
  drop constraint if exists track_favorites_actor_check;

alter table public.track_favorites
  add constraint track_favorites_actor_check
  check (
    (user_id is not null and agent_id is null) or
    (user_id is null and agent_id is not null)
  );

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'track_favorites_track_user_unique'
  ) then
    alter table public.track_favorites
      add constraint track_favorites_track_user_unique
      unique (track_id, user_id);
  end if;
end$$;

create index if not exists idx_track_favorites_user_created
  on public.track_favorites(user_id, created_at desc)
  where user_id is not null;

-- ════ Force PostgREST to reload its schema cache ════════════════════════
NOTIFY pgrst, 'reload schema';

-- ════ Migration tracking ════════════════════════════════════════════════
INSERT INTO public.schema_migrations (filename)
VALUES ('041_user_likes_favorites.sql')
ON CONFLICT (filename) DO NOTHING;
