-- ─── Hotfix: ensure the user-side UNIQUE constraints from 041 exist ───
--
-- Migration 041 was applied but the per-user UNIQUE constraints
-- (`track_likes_track_user_unique`, `track_favorites_track_user_unique`)
-- did not get created. Without them the upsert pattern in the
-- /api/me/likes and /api/me/favorites endpoints fails with
--   42P10: there is no unique or exclusion constraint matching
--          the ON CONFLICT specification
-- and Like / Add Favorite buttons silently fail to persist.
--
-- This migration is idempotent and ONLY touches what 041 left missing.
-- It also re-issues the PostgREST schema reload so the REST layer
-- picks up the new constraints immediately (no project restart needed).
--
-- Diagnostics: emits RAISE NOTICE messages so you can see in the
-- Supabase SQL editor output exactly which constraints were created
-- vs. already present. Safe to re-run.

do $$
declare
  has_likes_unique     boolean;
  has_favorites_unique boolean;
begin
  ---------------------------------------------------------------- track_likes
  select exists (
    select 1
    from   pg_constraint
    where  conrelid = 'public.track_likes'::regclass
    and    conname  = 'track_likes_track_user_unique'
  ) into has_likes_unique;

  if has_likes_unique then
    raise notice 'track_likes_track_user_unique: already present, skipping';
  else
    -- Pre-flight: any existing duplicate (track_id, user_id) pairs would
    -- block the constraint creation. Surface them now with a clear error
    -- instead of letting Postgres fail with a cryptic message.
    if exists (
      select 1
      from   public.track_likes
      where  user_id is not null
      group  by track_id, user_id
      having count(*) > 1
    ) then
      raise exception 'cannot add track_likes_track_user_unique: duplicate (track_id, user_id) rows exist; clean them up first';
    end if;

    alter table public.track_likes
      add constraint track_likes_track_user_unique unique (track_id, user_id);

    raise notice 'track_likes_track_user_unique: CREATED';
  end if;

  ------------------------------------------------------------ track_favorites
  select exists (
    select 1
    from   pg_constraint
    where  conrelid = 'public.track_favorites'::regclass
    and    conname  = 'track_favorites_track_user_unique'
  ) into has_favorites_unique;

  if has_favorites_unique then
    raise notice 'track_favorites_track_user_unique: already present, skipping';
  else
    if exists (
      select 1
      from   public.track_favorites
      where  user_id is not null
      group  by track_id, user_id
      having count(*) > 1
    ) then
      raise exception 'cannot add track_favorites_track_user_unique: duplicate (track_id, user_id) rows exist; clean them up first';
    end if;

    alter table public.track_favorites
      add constraint track_favorites_track_user_unique unique (track_id, user_id);

    raise notice 'track_favorites_track_user_unique: CREATED';
  end if;
end$$;

-- Force PostgREST to reload its schema cache so the REST layer recognises
-- the new constraints for ON CONFLICT routing immediately.
notify pgrst, 'reload schema';

insert into public.schema_migrations (filename)
values ('042_user_likes_favorites_unique_constraint_hotfix.sql')
on conflict (filename) do nothing;
