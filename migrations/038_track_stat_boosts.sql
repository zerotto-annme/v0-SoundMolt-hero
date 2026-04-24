-- ─── Admin "Boost stats" storage ──────────────────────────────────────
-- Lets admins manually inflate the displayed plays / likes / downloads
-- of a track WITHOUT touching the underlying organic counters in
-- public.tracks. This is critical for analytics integrity:
--
--   • The `tracks` table keeps storing only ORGANIC counts (real plays
--     from POST /api/tracks/:id/play, real likes from the like endpoint,
--     real downloads). The recommendation / taste-profile pipeline
--     queries `tracks` directly, so boosts CANNOT corrupt agent-taste
--     learning. This is the whole point.
--
--   • Public-facing surfaces (homepage feed, top charts, track cards)
--     read the SUM of organic + boost as the "display" value. Boosted
--     tracks rise in rankings without polluting the analytics layer.
--
--   • Each boost is an append-only audit row: admin id + reason + when.
--     Multiple boosts for the same track simply sum together — admins
--     can boost incrementally without losing earlier history.
--
-- Fully idempotent: every CREATE uses IF NOT EXISTS, every policy DROPs
-- before re-creating. Safe to re-run.

create extension if not exists "pgcrypto";

-- ── Storage table ─────────────────────────────────────────────────────
create table if not exists public.track_stat_boosts (
  id               uuid primary key default gen_random_uuid(),
  track_id         uuid not null references public.tracks(id) on delete cascade,
  boost_plays      integer not null default 0,
  boost_likes      integer not null default 0,
  boost_downloads  integer not null default 0,
  reason           text,
  created_by_admin uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint track_stat_boosts_nonneg check (
    boost_plays >= 0 and boost_likes >= 0 and boost_downloads >= 0
  ),
  -- A row that boosts NOTHING is meaningless audit noise — reject it.
  constraint track_stat_boosts_nonempty check (
    boost_plays > 0 or boost_likes > 0 or boost_downloads > 0
  )
);

create index if not exists track_stat_boosts_track_id_idx
  on public.track_stat_boosts(track_id);

create index if not exists track_stat_boosts_created_at_idx
  on public.track_stat_boosts(created_at desc);

-- ── Row-level security ────────────────────────────────────────────────
-- The raw audit table is admin-only: it carries `reason` (potentially
-- internal commentary) and `created_by_admin` (admin user_id). Neither
-- of those should leak to the public. Service-role bypasses RLS, which
-- is exactly what the admin API uses, so admins still see everything.
alter table public.track_stat_boosts enable row level security;

drop policy if exists "Anyone can read track stat boosts" on public.track_stat_boosts;
-- (no public select policy — raw rows stay private to service role)

-- ── Public-safe aggregate view ────────────────────────────────────────
-- Exposes ONLY the per-track totals that the public UI needs to fold
-- into displayed plays/likes/downloads. No reason, no admin identity.
-- The view inherits the table's RLS by default; we make it explicitly
-- security_invoker=false (security_definer) so it can read past the
-- table policy under the view-owner's privileges, and grant SELECT to
-- anon/authenticated. This way the homepage merge query keeps working
-- via the anon key without leaking admin metadata.
create or replace view public.track_boost_totals
with (security_invoker = false) as
  select
    track_id,
    coalesce(sum(boost_plays), 0)::bigint     as total_boost_plays,
    coalesce(sum(boost_likes), 0)::bigint     as total_boost_likes,
    coalesce(sum(boost_downloads), 0)::bigint as total_boost_downloads
  from public.track_stat_boosts
  group by track_id;

grant select on public.track_boost_totals to anon, authenticated;

-- ── PostgREST schema reload + bookkeeping ─────────────────────────────
notify pgrst, 'reload schema';

insert into public.schema_migrations (filename)
values ('038_track_stat_boosts.sql')
on conflict (filename) do nothing;
