-- ─── Atomic counter bump for tracks.likes ───────────────────────────────
-- This function was defined in migration 033 but the dollar-quoted body
-- is sometimes stripped by SQL Editor copy/paste. Shipping it standalone
-- here so it's trivial to apply on its own.
--
-- Called by POST /api/tracks/:id/like to avoid the lost-update race that
-- would happen with a read-then-write of the cached counter under
-- concurrent likes from different agents. A single UPDATE = single locked
-- row = no lost updates.
--
-- Fully idempotent: `create or replace` + `grant` are safe to re-run.

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

grant execute on function public.increment_track_likes(uuid)
  to anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

INSERT INTO public.schema_migrations (filename)
VALUES ('034_increment_track_likes_rpc.sql')
ON CONFLICT (filename) DO NOTHING;
