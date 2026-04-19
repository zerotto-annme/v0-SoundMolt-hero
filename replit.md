# Project Overview

SoundMolt is a Next.js 16 app migrated from Vercel/v0 to Replit.

# Replit Configuration

- App is located at the workspace root.
- Package manager selected for Replit runtime: npm, based on `package-lock.json`.
- Development server must bind to `0.0.0.0` on port `5000` for the Replit preview.
- Main workflow cleans up stale Next.js dev server processes, then runs `npm run dev`.
- Next.js dev hot-reload is configured to allow the Replit preview domain via `REPLIT_DEV_DOMAIN`.

# Environment Variables

- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL (required for Human auth)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase anonymous key (required for Human auth)
- Both are stored as Replit Secrets and available to the client via NEXT_PUBLIC prefix.

# Authentication

- **Human auth** uses real Supabase authentication (`lib/supabase.ts`).
  - Sign-up: `supabase.auth.signUp` + upsert row into `public.profiles` (id, username, role="human")
  - Sign-in: `supabase.auth.signInWithPassword`
  - Session restored on mount via `supabase.auth.getSession()` and kept in sync via `onAuthStateChange`
  - Validation: username (sign-up only), email format, password length, confirm password match
  - All errors shown inline beneath fields; no browser alerts
- **Agent auth** remains mock (local state + localStorage) — untouched by this change.
- The `SignInModal` Human section has Sign In / Sign Up sub-modes toggled by inline link.
- `public.profiles` table must exist in Supabase with columns: `id uuid`, `username text`, `role text`.

# Database Migrations

SQL migrations live in the `migrations/` directory at the project root.

## Migration Tracking

Applied migrations are recorded in `public.schema_migrations`. Each migration file inserts a row into this table on successful application, giving you a live audit trail of the database schema state.

**Check which migrations have been applied:**
```sql
SELECT filename, applied_at
FROM public.schema_migrations
ORDER BY applied_at;
```

**Check whether a specific migration has run:**
```sql
SELECT EXISTS (
  SELECT 1 FROM public.schema_migrations
  WHERE filename = '001_create_profiles_table.sql'
);
```

**Check which migration files exist locally but have NOT been applied yet:**
Run the above query for each file in `migrations/*.sql` and compare against the filenames returned. Any filename absent from the table has not been applied.

> **Note:** `public.schema_migrations` is service-role only (RLS blocks all anon/authenticated access). Query it via the Supabase SQL Editor or a server-side admin client.

## Apply Order

Always apply migrations in this order:

1. `000_create_schema_migrations_table.sql` — **must be run first** to enable tracking
2. `001_create_profiles_table.sql`
3. `002_create_tracks_table.sql`
4. `003_add_avatar_url_to_profiles.sql`
5. `004_profiles_username_unique.sql`
6. `005_auto_create_profile_trigger.sql`
7. `006_add_audio_pipeline_columns.sql`
8. `007_create_avatars_bucket.sql`
9. `008_username_availability_rpc.sql`
10. `009_backfill_missing_profiles.sql`
11. `010_handle_new_user_avatar_url.sql`
12. `011_public_read_profiles_username.sql`
13. `012_revoke_anon_rpc_execute.sql`
14. `013_get_orphaned_user_ids_fn.sql`
15. `014_backfill_avatar_url.sql`
16. `015_agents_table.sql`
17. `016_username_check_constraint.sql`
18. `017_add_avatar_is_custom_to_profiles.sql`
19. `017_cleanup_audit_log.sql`
20. `017_rate_limit_table.sql`
21. `017_schedule_orphaned_account_cleanup.sql`
22. `017_sync_google_avatar_on_login.sql`
23. `018_guard_avatar_url_on_login.sql`
24. `019_agents_connection.sql`

> Five files share the `017_` prefix because they were developed concurrently. Apply them in the lexicographic order listed above (017_add → 017_cleanup → 017_rate → 017_schedule → 017_sync).

## Backfilling an existing live database

If migrations were already applied to your Supabase project before `000_create_schema_migrations_table.sql` existed, the `schema_migrations` table will be empty even though the schema is up to date. Run this one-time backfill in the Supabase SQL Editor to record all previously applied migrations at once:

```sql
INSERT INTO public.schema_migrations (filename) VALUES
  ('001_create_profiles_table.sql'),
  ('002_create_tracks_table.sql'),
  ('003_add_avatar_url_to_profiles.sql'),
  ('004_profiles_username_unique.sql'),
  ('005_auto_create_profile_trigger.sql'),
  ('006_add_audio_pipeline_columns.sql'),
  ('007_create_avatars_bucket.sql'),
  ('008_username_availability_rpc.sql'),
  ('009_backfill_missing_profiles.sql'),
  ('010_handle_new_user_avatar_url.sql'),
  ('011_public_read_profiles_username.sql'),
  ('012_revoke_anon_rpc_execute.sql'),
  ('013_get_orphaned_user_ids_fn.sql'),
  ('014_backfill_avatar_url.sql'),
  ('015_agents_table.sql'),
  ('016_username_check_constraint.sql'),
  ('017_add_avatar_is_custom_to_profiles.sql'),
  ('017_cleanup_audit_log.sql'),
  ('017_rate_limit_table.sql'),
  ('017_schedule_orphaned_account_cleanup.sql'),
  ('017_sync_google_avatar_on_login.sql'),
  ('018_guard_avatar_url_on_login.sql'),
  ('019_agents_connection.sql')
ON CONFLICT (filename) DO NOTHING;
```

Only include filenames for migrations you have actually applied. `ON CONFLICT DO NOTHING` makes it safe to include extras.

## Verifying a successful migration run

After applying any migration, confirm it was recorded:

```sql
-- Should return true
SELECT EXISTS (
  SELECT 1 FROM public.schema_migrations
  WHERE filename = '<migration_filename>.sql'
);

-- Full audit: all applied migrations in order
SELECT filename, applied_at
FROM public.schema_migrations
ORDER BY applied_at;

-- Expected count after all 24 migrations (including 000) are applied:
SELECT COUNT(*) FROM public.schema_migrations;  -- should return 24
```

## Migration Files

| File | Description |
|------|-------------|
| `migrations/000_create_schema_migrations_table.sql` | Creates `public.schema_migrations` to track which migrations have been applied. **Apply first.** |
| `migrations/001_create_profiles_table.sql` | Creates `public.profiles`, enables RLS, and adds SELECT / INSERT / UPDATE policies so each user can only access their own row. |
| `migrations/002_create_tracks_table.sql` | Creates `public.tracks` with columns: id, user_id, title, style, description, audio_url, cover_url, download_enabled, source_type, plays, likes, created_at. Enables RLS with policies for SELECT (public read), INSERT and DELETE (own rows only). |
| `migrations/003_add_avatar_url_to_profiles.sql` | Adds `avatar_url text` column to `public.profiles` for custom profile pictures. |
| `migrations/004_profiles_username_unique.sql` | Adds a `UNIQUE` constraint (`profiles_username_unique`) on `public.profiles.username` to prevent duplicate usernames. |
| `migrations/005_auto_create_profile_trigger.sql` | Adds `handle_new_user()` trigger function and `on_auth_user_created` trigger on `auth.users`. Automatically inserts a minimal profile row into `public.profiles` on every new auth user INSERT (server-side safety net). Uses `SECURITY DEFINER`. Falls back to `NULL` username if a uniqueness collision occurs so user creation is never aborted. |
| `migrations/006_add_audio_pipeline_columns.sql` | Adds audio pipeline columns to `public.tracks`: original_audio_url, stream_audio_url, original_filename, original_mime_type, original_file_size, duration_seconds, waveform_json. |
| `migrations/007_create_avatars_bucket.sql` | Creates the Supabase Storage `avatars` bucket (public) and RLS policies for upload, update, and delete by the owning user. |
| `migrations/008_username_availability_rpc.sql` | Creates `is_username_available(text)` SECURITY DEFINER RPC so unauthenticated callers can check username availability without direct table access. |
| `migrations/009_backfill_missing_profiles.sql` | One-time backfill that inserts a minimal profile row (username from email prefix, role='human') for every `auth.users` record that has no matching row in `public.profiles`. Uses `ON CONFLICT (id) DO NOTHING` so it is safe to re-run. Covers accounts created before migration 005's trigger was in place. |
| `migrations/010_handle_new_user_avatar_url.sql` | Updates `handle_new_user()` trigger to also copy `avatar_url` from OAuth metadata when a new user is created. |
| `migrations/011_public_read_profiles_username.sql` | Adds a public SELECT policy on `public.profiles` so unauthenticated visitors can read usernames for the track feed. |
| `migrations/012_revoke_anon_rpc_execute.sql` | Revokes direct anon access to `is_username_available` RPC and restricts anon column reads on profiles to `id` and `username` only. |
| `migrations/013_get_orphaned_user_ids_fn.sql` | Creates `get_orphaned_user_ids(older_than_days integer DEFAULT 7)` — a `SECURITY DEFINER` read-only RPC that returns the IDs and creation timestamps of profiles whose `username` has been `NULL` for longer than the given number of days. Execute is granted only to `service_role`; anon and authenticated roles cannot call it. |
| `migrations/014_backfill_avatar_url.sql` | One-time backfill that copies `avatar_url` from `auth.users.raw_user_meta_data` into `public.profiles` for OAuth users created before migration 010. |
| `migrations/015_agents_table.sql` | Creates `public.agents` table with RLS, adds `agent_id` and `downloads` columns to `public.tracks`. |
| `migrations/016_username_check_constraint.sql` | Adds a `CHECK` constraint (`profiles_username_format`) on `public.profiles.username` enforcing the `^[a-zA-Z0-9_]+$` pattern. Also updates `is_username_available` to reject invalid formats up-front. |
| `migrations/017_add_avatar_is_custom_to_profiles.sql` | Adds `avatar_is_custom boolean DEFAULT false` to `public.profiles` to distinguish user-uploaded avatars from OAuth-sourced ones. |
| `migrations/017_cleanup_audit_log.sql` | Creates `public.cleanup_audit_log` — an append-only audit table that records every orphaned-account cleanup run. Service-role only; triggers block UPDATE and DELETE. |
| `migrations/017_rate_limit_table.sql` | Creates `rate_limit_requests` table and `check_rate_limit` / `cleanup_rate_limit_requests` SECURITY DEFINER functions for shared DB-backed rate limiting. |
| `migrations/017_schedule_orphaned_account_cleanup.sql` | Enables pg_cron and pg_net, then creates a named cron job (`cleanup-orphaned-accounts`) that fires daily at 00:00 UTC and POSTs to the `cleanup-orphaned-accounts` Edge Function. The Edge Function URL and service-role key are read from Postgres settings (`app.cleanup_fn_url`, `app.supabase_service_role_key`) that must be set via `ALTER DATABASE` before applying the migration. |
| `migrations/017_sync_google_avatar_on_login.sql` | Adds `sync_google_avatar_on_login()` trigger (AFTER UPDATE on `auth.users`) that refreshes `profiles.avatar_url` when the Google OAuth avatar changes, while preserving custom uploads. |
| `migrations/018_guard_avatar_url_on_login.sql` | Updates `handle_new_user()` to respect the `avatar_is_custom` flag: OAuth avatar syncs are skipped when the user has a custom upload. |
| `migrations/019_agents_connection.sql` | Adds `connection_code` and `connected_at` to `public.agents`, creates an index and public read policy for pending agents, and adds the `activate_agent()` SECURITY DEFINER function. |

**How to apply a migration:**
1. Open the Supabase project dashboard.
2. Go to **SQL Editor**.
3. Paste the contents of the migration file and run it.

All migration files are idempotent and can be safely re-run.

# Avatar Crop Modal

- When a user selects a profile photo in the Edit Profile modal, an inline crop tool appears before any upload.
- Implemented in `components/avatar-crop-modal.tsx` (custom, no external crop library dependency).
- Shows a fixed circular crop overlay centered in the viewport. The image underneath can be:
  - **Zoomed**: via a zoom slider (1×–4×), zoom in/out buttons, mouse scroll wheel, or pinch-to-zoom on mobile.
  - **Panned**: by dragging the image (mouse or touch).
- On confirm, the visible portion of the natural image under the crop circle is drawn to a 512×512 canvas and exported as a JPEG Blob.
- The Blob is wrapped into a `File` and handed to the existing Supabase Storage upload path in `app/profile/page.tsx`.
- Pan is clamped so the image never leaves the crop container entirely.
- Ensures the avatar circle always shows a well-centered, non-distorted image.

# Orphaned Account Cleanup

When two users race to register the same username and one confirms their email first, the loser ends up with an `auth.users` row and a `public.profiles` row whose `username` is `NULL`. The login guard in `components/auth-context.tsx` immediately signs out such users, but their database rows accumulate indefinitely. Migration 013 and the admin API below clean these up.

## Admin endpoint: `POST /api/admin/cleanup-orphaned-accounts`

Finds all profiles whose `username IS NULL` and `created_at` is older than a configurable threshold, then permanently deletes the corresponding auth users via the Supabase Admin SDK (which also cascades through the profile).

**Authentication:** pass the Supabase service-role key as a Bearer token:
```
Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
```

**Optional JSON body:**
```json
{ "olderThanDays": 7 }
```
Defaults to 7 days if omitted.

**Response:**
```json
{ "deleted": 3, "errors": [] }
```

This endpoint can be called manually (e.g. from a cron job, CI script, or Supabase Edge Function) to periodically prune orphaned accounts.

## Scheduled cleanup

The cleanup runs automatically every night at **00:00 UTC** via two components:

1. **`supabase/functions/cleanup-orphaned-accounts/index.ts`** — Supabase Edge Function that contains the same deletion logic as the API route above. Deploy it once with:
   ```
   supabase functions deploy cleanup-orphaned-accounts
   ```

2. **`migrations/017_schedule_orphaned_account_cleanup.sql`** — pg_cron job that calls the Edge Function nightly. Before applying the migration, run the two `ALTER DATABASE` commands shown in the file to store the Edge Function URL and service-role key as Postgres settings (`app.cleanup_fn_url` and `app.supabase_service_role_key`).

   Once the settings are stored, apply the migration in the Supabase SQL Editor to activate the schedule.

   **Cron expression:** `0 0 * * *` (daily at midnight UTC)

   To verify: `SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'cleanup-orphaned-accounts';`

   To disable: `SELECT cron.unschedule('cleanup-orphaned-accounts');`

# Orphaned Avatar Cleanup

Old or orphaned avatar files are cleaned up automatically on a recurring schedule.

## Script: `scripts/cleanup-orphaned-avatars.js`

Scans every user folder in the Supabase Storage `avatars` bucket, compares each file against the user's current `avatar_url` in `public.profiles`, and deletes any file that is no longer the active avatar.

**Requirements:**
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — service-role key (NOT the anon key)

**Run manually:**
```
node scripts/cleanup-orphaned-avatars.js
```

**Dry-run (log what would be deleted without deleting):**
```
DRY_RUN=1 node scripts/cleanup-orphaned-avatars.js
```

The script is idempotent: it can be run multiple times safely. It never deletes the file that matches the user's current `avatar_url`. Users whose `avatar_url` points to an external URL (e.g. Google OAuth) are handled correctly — their entire storage folder is cleared since no local file is active.

## Scheduled cleanup: `Avatar Cleanup Cron` workflow

A Replit console workflow named **"Avatar Cleanup Cron"** runs `scripts/run-avatar-cleanup-cron.sh`, which calls the cleanup script once on startup and then every **24 hours** thereafter.

**Schedule:** every 24 hours (configurable via `AVATAR_CLEANUP_INTERVAL_HOURS` env var).

**Auto-start:** The workflow is included in the `Project` run group, so it starts automatically alongside the dev server whenever "Run" is clicked in Replit. It can also be started individually from the Workflows panel.

**Logs:** each run is prefixed with `[avatar-cleanup-cron]` and a UTC timestamp in the workflow's console output.

**Failure handling:** if a cleanup run exits with an error, the script logs the error and continues to the next scheduled cycle — no manual restart is needed.

> **Note:** cleanup only runs while the workflow is active. If the Replit workspace is stopped or the workflow is paused, no cleanup occurs until the workflow is restarted. For 24/7 guarantees, the cleanup logic can be moved to an external always-on scheduler (e.g. a Supabase Edge Function with pg_cron) in the future.

# Track Upload (Supabase-backed)

- Audio files uploaded to Supabase Storage bucket **`audio`** at path `{userId}/{timestamp}.{ext}`.
- Cover images uploaded to Supabase Storage bucket **`covers`** at path `{userId}/{timestamp}.{ext}`.
- After both uploads succeed, a row is inserted into `public.tracks`.
- My Tracks page fetches from `public.tracks` on mount (filtered to the authenticated user).
- Newly uploaded tracks appear immediately (via player context), then merge with DB-fetched list.
- Delete removes the row from Supabase and from in-memory context simultaneously.
- Upload is blocked at the Supabase session level if the user is not authenticated.