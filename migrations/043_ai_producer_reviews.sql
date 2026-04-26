-- ─── AI Producer Review module — Stage 1 backend tables ───
--
-- This is a SEPARATE, PRIVATE analysis module. It must not interact
-- with the normal Upload Track / public publishing / feed pipeline:
--   • new tables only (no schema changes to any existing table)
--   • all object names prefixed with `ai_producer_` or `credit_`
--   • RLS is enabled and locked down — every read/write goes through
--     the server-side admin client (service role) in
--     app/api/ai-producer/*. No anon/authenticated role policies are
--     created here on purpose; granting access to the client would
--     break the credit-gated visibility model.
--
-- Stage 1 requirements covered here:
--   1. ai_producer_reviews        — one row per submitted review
--   2. user_credits               — running credit balance per user
--   3. credit_transactions        — append-only ledger of changes
--
-- Fully idempotent: every CREATE / ALTER / INDEX / POLICY uses
-- IF NOT EXISTS or a guarded DO-block, so the file is safe to re-run.

-- ════ 1. ai_producer_reviews ════════════════════════════════════════════
create table if not exists public.ai_producer_reviews (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null
                       references auth.users(id) on delete cascade,

  -- track_id: opaque internal id when the review is for a freshly
  -- uploaded file that has NOT been promoted into public.tracks. We
  -- intentionally leave this WITHOUT a foreign key so that the AI
  -- Producer flow can store private file ids that never touch the
  -- public catalogue.
  track_id            uuid,

  -- original_track_id: when the user picked an existing My Tracks
  -- entry, this references public.tracks(id). on-delete-set-null so
  -- removing a track does not cascade-destroy review history.
  original_track_id   uuid
                       references public.tracks(id) on delete set null,

  source_type         text not null
                       check (source_type in ('uploaded_file', 'existing_track')),

  audio_url           text not null,
  title               text,
  genre               text,
  daw                 text,
  feedback_focus      text,
  comment             text,

  status              text not null default 'processing'
                       check (status in ('processing', 'ready', 'failed')),

  -- report_json: the FULL AI response. Stored as JSONB so we can
  -- index/query specific keys later without schema migrations.
  report_json         jsonb,

  -- access_type drives the report-page blur logic. NEVER set this
  -- from the client; the create endpoint computes it from the user's
  -- credit balance at the moment of submission.
  access_type         text not null default 'free'
                       check (access_type in ('free', 'full')),

  credits_used        integer not null default 0
                       check (credits_used >= 0),

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_ai_producer_reviews_user_created
  on public.ai_producer_reviews (user_id, created_at desc);

create index if not exists idx_ai_producer_reviews_status
  on public.ai_producer_reviews (status)
  where status = 'processing';

-- updated_at auto-touch trigger. Wrapped in DO-block for idempotency.
create or replace function public.ai_producer_reviews_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'ai_producer_reviews_updated_at'
  ) then
    create trigger ai_producer_reviews_updated_at
      before update on public.ai_producer_reviews
      for each row
      execute function public.ai_producer_reviews_set_updated_at();
  end if;
end$$;

alter table public.ai_producer_reviews enable row level security;
-- No GRANTs to anon/authenticated and no policies — service role only.
revoke all on public.ai_producer_reviews from anon, authenticated;

-- ════ 2. user_credits ═══════════════════════════════════════════════════
create table if not exists public.user_credits (
  user_id          uuid primary key
                    references auth.users(id) on delete cascade,
  credits_balance  integer not null default 0
                    check (credits_balance >= 0),
  updated_at       timestamptz not null default now()
);

create or replace function public.user_credits_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'user_credits_updated_at'
  ) then
    create trigger user_credits_updated_at
      before update on public.user_credits
      for each row
      execute function public.user_credits_set_updated_at();
  end if;
end$$;

alter table public.user_credits enable row level security;
revoke all on public.user_credits from anon, authenticated;

-- ════ 3. credit_transactions ════════════════════════════════════════════
-- Append-only ledger. Positive amounts are grants ('admin_gift'),
-- negative amounts are spends ('review_spend' — bound to a review).
create table if not exists public.credit_transactions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null
               references auth.users(id) on delete cascade,
  amount      integer not null,
  type        text not null
               check (type in ('admin_gift', 'review_spend')),
  reason      text,
  review_id   uuid
               references public.ai_producer_reviews(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_credit_transactions_user_created
  on public.credit_transactions (user_id, created_at desc);

alter table public.credit_transactions enable row level security;
revoke all on public.credit_transactions from anon, authenticated;

-- ════ Force PostgREST to reload its schema cache ════════════════════════
NOTIFY pgrst, 'reload schema';

-- ════ Migration tracking ════════════════════════════════════════════════
INSERT INTO public.schema_migrations (filename)
VALUES ('043_ai_producer_reviews.sql')
ON CONFLICT (filename) DO NOTHING;
