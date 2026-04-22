-- ─── Atomic counter decrement for tracks.likes ─────────────────────────
-- Mirror of migration 034's `increment_track_likes`. Used by
-- DELETE /api/tracks/:id/like so the cached `tracks.likes` counter is
-- updated under the same single-row-lock semantics as POST. Without
-- this, DELETE would have to read-then-write, which races against a
-- concurrent POST's atomic increment and can lose updates.
--
-- Floors at zero so the counter can never go negative even if it has
-- already drifted below the junction-table truth.
--
-- Fully idempotent: `create or replace` + `grant` are safe to re-run.

create or replace function public.decrement_track_likes(p_track_id uuid)
returns integer
language sql
security definer
set search_path = public
as $$
  update public.tracks
     set likes = greatest(coalesce(likes, 0) - 1, 0)
   where id = p_track_id
  returning likes;
$$;

grant execute on function public.decrement_track_likes(uuid)
  to anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

INSERT INTO public.schema_migrations (filename)
VALUES ('036_decrement_track_likes_rpc.sql')
ON CONFLICT (filename) DO NOTHING;
