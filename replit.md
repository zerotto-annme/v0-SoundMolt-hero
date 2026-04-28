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

## Auth Readiness Gates

To eliminate the post-login flicker (e.g. real username → email-prefix → real
username), `useAuth()` exposes two distinct readiness flags. Consumers must
gate UI on both:

- **`authReady`** — set to `true` after `restoreSession()` finishes (or its
  guard timer fires). Tells you whether `isAuthenticated` is trustworthy.
- **`profileReady`** — set to `true` only after the `public.profiles` row has
  been fetched (or fetch failed). While `false`, `user.name` may still be the
  empty placeholder set during the bare hydration step. Treat the user object
  as "identity known, display fields not yet known".

Render rules:

- `ProfileDropdown` renders a skeleton when `!authReady || (isAuthenticated && !profileReady)`.
- `BrowseFeed` greeting renders a name skeleton in place of `user.name` until `profileReady`.
- The feed itself fires on mount (and on `authVersion` change) — it does NOT
  wait for `profileReady`. Logged-out and logged-in users see tracks at the
  same time.
- `app/my-tracks/page.tsx` gates its fetch on `authReady && isAuthenticated && user?.id`
  (with `authVersion` as an effect dep) so tracks appear immediately after a
  fresh login without a manual refresh.

`onAuthStateChange` rules that keep this stable:
- `TOKEN_REFRESHED` / `INITIAL_SESSION` for the same user with `profileReady===true`
  is a no-op — does not flip `profileReady` back to `false` (this was the main
  source of the visible flicker).
- A new `user.id` clears the user, sets a bare `{id, email, ...}` with
  `profileReady=false`, then fetches once and applies via `buildHumanProfile()`.
- `SIGNED_IN` for the same user re-fetches the profile but keeps the existing
  bare user visible until the fetch resolves.

Display-name precedence is centralized in `buildHumanProfile()`:
`merged.username || email.split("@")[0] || "User"`. The email-prefix fallback
is **only** applied AFTER the profile fetch completes — never speculatively.

Structured logs emitted at every step (filter by these prefixes when debugging):
`AUTH_EVENT`, `[auth] profile fetch started`, `[auth] profile fetch result`,
`[sidebar] displayName chosen`, `[feed] fetch started`, `[feed] fetch result count`.

## Auth Listener: Supabase Auth Lock & `setTimeout(0)` Deferral

The `supabase.auth.onAuthStateChange` listener in `components/auth-context.tsx`
is **deliberately synchronous** (not declared `async`). supabase-js holds its
internal auth lock for the duration of the listener callback, and any
`supabase.from(...)` query awaited inside that callback blocks until the
lock releases (~10 s in production). Symptoms when this rule was violated:

- Every `SIGNED_IN` triggered a 10 s timeout in `fetchProfileData`.
- The fallback applied email-prefix as the username AND a generated
  dicebear avatar.
- The real `public.profiles` row (with the correct username and
  `avatar_url`) returned ~250 ms *after* the timeout fired and was
  discarded.
- Net user-visible bug: avatar didn't appear and username was wrong until
  a manual refresh (where `restoreSession` runs outside the lock).

**Implementation rule:** the listener does its synchronous bookkeeping
inline (epoch bump, `setIsHydrated`, `SIGNED_OUT`, set bare user with
`avatar:""`), then wraps the actual `fetchProfileData` + `buildHumanProfile`
+ `setState` work in `setTimeout(() => async work, 0)`. Inside the deferred
block:

- `myEpoch === authEpochRef.current` guards against stale results from
  prior auth events.
- An outer `try/finally` always flips `profileReady=true` (epoch-checked)
  so an unexpected throw can never leave the sidebar in a permanent
  skeleton state.

If you ever need to read or write Supabase data from within an auth
listener callback, use the same `setTimeout(0)` deferral pattern.

## Profile Auto-Creation (Bulletproof)

A `public.profiles` row is guaranteed to exist for every authenticated user
through three layered safety nets, in this order:

1. **DB trigger** `on_auth_user_created` (migration 005) inserts a row at
   `auth.users` INSERT time. Works for fresh sign-ups when the trigger is
   installed in the Supabase project.
2. **Client-side `ensureProfileRow(user)`** in `components/auth-context.tsx`.
   Called by `fetchProfileData` whenever the SELECT returns no row OR
   errors. Uses `supabase.from("profiles").upsert({...}, { onConflict: "id",
   ignoreDuplicates: true })` so it's idempotent and race-safe with both
   the DB trigger and concurrent SIGNED_IN events. Never overwrites a
   user's chosen username/avatar.
3. **Server-side `/api/profile/ensure`** (in `app/api/profile/ensure/route.ts`).
   Called by `ensureProfileRow` as a final fallback if the client upsert
   fails (RLS / network / schema drift). Validates the user via
   `Authorization: Bearer <jwt>`, then uses the service-role admin client
   to upsert — bypasses RLS entirely. As long as `SUPABASE_SERVICE_ROLE_KEY`
   is configured, the row WILL be created.

Default values written for a brand-new row:
```
id          = user.id
username    = sanitized email-prefix (3–30 chars, [a-zA-Z0-9_])
artist_name = same as username
role        = "human"   ← this app's default account-type enum
avatar_url  = user_metadata.avatar_url || user_metadata.picture || null
```

**Role enum note:** the app uses `"human" | "agent"` throughout (TypeScript
types, RLS, UI conditionals). Do NOT change to `"user"` without a coordinated
schema + code migration.

## Single Profile Service: `useCurrentProfile()`

All Edit Profile / avatar / username flows go through one hook:
`hooks/use-current-profile.ts`. It exposes:

```
{ user, profile, authReady, profileReady, loading,
  refreshProfile(),
  updateProfile({ username?, avatar_url? }) }
```

`updateProfile()` is the only sanctioned write path. It:
1. Calls `supabase.auth.getUser()` to get the FRESH user id (never trusts
   the cached context id — covers token-refresh races).
2. Calls `ensureProfile(freshUser)` so we never UPDATE a row that doesn't
   exist yet.
3. Issues the UPDATE. If the UPDATE returns 0 rows (RLS hid it, or row
   was deleted between ensure and update), it calls `ensureProfile`
   again and retries the UPDATE once.
4. On Postgres `23505` (unique violation on username) it throws a
   typed `UsernameTakenError` so the modal can show
   "That username is already taken." instead of a generic error.
5. Pushes the updated row into auth-context state immediately (cache-
   busted avatar via `?v=updated_at` if the column exists, else
   `Date.now()`), so the sidebar avatar updates without a refresh.

**Username availability check is never blocking.** The debounced
`/api/username-available` poll surfaces a warning only — the DB unique
constraint is the source of truth, surfaced via `UsernameTakenError`.

**Migration 039** (`migrations/039_profiles_updated_at.sql`) adds
`profiles.updated_at` plus a trigger that bumps it on UPDATE. Apply it
in the Supabase SQL editor for deterministic cache-busting; until it's
applied, the SELECT/UPDATE paths transparently fall back to the legacy
column list (errors with code `42703` or matching `/updated_at/` are
caught and retried) and cache-busting falls back to `Date.now()`.

## Sidebar Avatar Render

`ProfileDropdownAvatar` (in `components/auth-context.tsx`) is a small
component that wraps the dropdown's avatar `<img>` with three guarantees:

- `key={avatar}` forces React to remount the `<img>` whenever the URL
  changes, so a stale DOM node can't keep showing the previous image while
  the new bytes arrive.
- `onError` flips an internal `errored` flag that swaps the image for the
  role icon (`Bot` for agent, `User` for human), so a broken URL never
  renders a broken-image glyph.
- A `useEffect([avatar])` resets that error flag whenever the URL changes
  so the next URL gets a fresh chance to load.

When `avatar` is empty (e.g. the bare user written before the profile
fetch resolves), the role icon renders as the fallback. Once the deferred
profile fetch completes, a single `setState` writes both `name` and
`avatar` together, so they always update in the same paint.

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
19. `018_cleanup_audit_log.sql`
20. `019_rate_limit_table.sql`
21. `020_schedule_orphaned_account_cleanup.sql`
22. `021_sync_google_avatar_on_login.sql`
23. `022_guard_avatar_url_on_login.sql`
24. `023_agents_connection.sql`
25. `024_username_length_constraint.sql`
26. `025_backfill_avatar_is_custom.sql`
27. `026_schedule_rate_limit_cleanup.sql`
28. `027_agent_api_keys.sql`

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
  ('018_cleanup_audit_log.sql'),
  ('019_rate_limit_table.sql'),
  ('020_schedule_orphaned_account_cleanup.sql'),
  ('021_sync_google_avatar_on_login.sql'),
  ('022_guard_avatar_url_on_login.sql'),
  ('023_agents_connection.sql'),
  ('024_username_length_constraint.sql'),
  ('025_backfill_avatar_is_custom.sql'),
  ('026_schedule_rate_limit_cleanup.sql')
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

-- Expected count after all 27 migrations (including 000) are applied:
SELECT COUNT(*) FROM public.schema_migrations;  -- should return 27
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
| `migrations/018_cleanup_audit_log.sql` | Creates `public.cleanup_audit_log` — an append-only audit table that records every orphaned-account cleanup run. Service-role only; triggers block UPDATE and DELETE. |
| `migrations/019_rate_limit_table.sql` | Creates `rate_limit_requests` table and `check_rate_limit` / `cleanup_rate_limit_requests` SECURITY DEFINER functions for shared DB-backed rate limiting. |
| `migrations/020_schedule_orphaned_account_cleanup.sql` | Enables pg_cron and pg_net, then creates a named cron job (`cleanup-orphaned-accounts`) that fires daily at 00:00 UTC and POSTs to the `cleanup-orphaned-accounts` Edge Function. The Edge Function URL and service-role key are read from Postgres settings (`app.cleanup_fn_url`, `app.supabase_service_role_key`) that must be set via `ALTER DATABASE` before applying the migration. |
| `migrations/021_sync_google_avatar_on_login.sql` | Adds `sync_google_avatar_on_login()` trigger (AFTER UPDATE on `auth.users`) that refreshes `profiles.avatar_url` when the Google OAuth avatar changes, while preserving custom uploads. |
| `migrations/022_guard_avatar_url_on_login.sql` | Updates `handle_new_user()` to respect the `avatar_is_custom` flag: OAuth avatar syncs are skipped when the user has a custom upload. |
| `migrations/023_agents_connection.sql` | Adds `connection_code` and `connected_at` to `public.agents`, creates an index and public read policy for pending agents, and adds the `activate_agent()` SECURITY DEFINER function. |
| `migrations/024_username_length_constraint.sql` | Adds a `CHECK` constraint on `public.profiles.username` enforcing a minimum of 3 and maximum of 30 characters. Also updates `is_username_available` to reject out-of-range lengths up-front. NULL is allowed for profile rows created before a username is chosen. |
| `migrations/025_backfill_avatar_is_custom.sql` | One-time backfill that sets `avatar_is_custom = true` for every profile whose `avatar_url` already points to the Supabase Storage avatars bucket. Fixes profiles created before migration 017 added the flag with a default of `false`. |
| `migrations/026_schedule_rate_limit_cleanup.sql` | Registers a pg_cron job (`cleanup-rate-limit-requests`) that calls `cleanup_rate_limit_requests()` every 10 minutes, preventing stale rows from accumulating in the `rate_limit_requests` table. |

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

**Authentication:** pass the dedicated admin API secret as a Bearer token:
```
Authorization: Bearer <ADMIN_API_SECRET>
```

**Required environment variable:** `ADMIN_API_SECRET` must be set as a Replit Secret. Any caller (cron job, CI script, Edge Function) must send this value — not the Supabase service-role key.

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

2. **`migrations/020_schedule_orphaned_account_cleanup.sql`** — pg_cron job that calls the Edge Function nightly. Before applying the migration, run the two `ALTER DATABASE` commands shown in the file to store the Edge Function URL and service-role key as Postgres settings (`app.cleanup_fn_url` and `app.supabase_service_role_key`).

   Once the settings are stored, apply the migration in the Supabase SQL Editor to activate the schedule.

   **Cron expression:** `0 0 * * *` (daily at midnight UTC)

   To verify: `SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'cleanup-orphaned-accounts';`

   To disable: `SELECT cron.unschedule('cleanup-orphaned-accounts');`

# Orphaned Avatar Cleanup

Old or orphaned avatar files are cleaned up automatically on a recurring schedule.

## Admin API endpoint: `POST /api/admin/cleanup-orphaned-avatars`

Removes all files from the `avatars` Storage bucket that are no longer referenced by any active profile.

**Authentication:** pass the dedicated admin API secret as a Bearer token:
```
Authorization: Bearer <ADMIN_API_SECRET>
```

**Required environment variable:** `ADMIN_API_SECRET` must be set as a Replit Secret. Any caller (cron job, CI script, Edge Function) must be updated to send this value — not the Supabase service-role key.

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

## Admin Dashboard: Migration Status

A dedicated admin page at `/admin/migrations` shows which SQL migration files in the repo have (or have not) been applied to the live database.

- **API endpoint:** `GET /api/admin/migrations`
  - Reads all `.sql` files from the `migrations/` directory
  - Queries `public.schema_migrations` for applied migrations
  - Returns per-file status (applied/not applied + `applied_at` timestamp), plus totals
  - Auth: valid Supabase user JWT + email in `ADMIN_EMAILS` env var
- **UI page:** `app/admin/migrations/page.tsx`
  - Stat cards for total / applied / not-applied counts
  - Warning banner when any migrations are missing
  - Full table listing every `.sql` file with status badge and applied-at timestamp
  - Refresh button; unauthenticated users are redirected to `/`

# Track Upload (Supabase-backed)

- Audio files uploaded to Supabase Storage bucket **`audio`** at path `{userId}/{timestamp}.{ext}`.
- Cover images uploaded to Supabase Storage bucket **`covers`** at path `{userId}/{timestamp}.{ext}`.
- After both uploads succeed, a row is inserted into `public.tracks`.
- My Tracks page fetches from `public.tracks` on mount (filtered to the authenticated user).
- Newly uploaded tracks appear immediately (via player context), then merge with DB-fetched list.
- Delete removes the row from Supabase and from in-memory context simultaneously.
- Upload is blocked at the Supabase session level if the user is not authenticated.

## Admin Panel v1 (`/admin`)

A hidden moderation dashboard for the platform owner. **Not linked from the sidebar** and not discoverable; users navigate by typing the URL.

### Access control

- Gate (server): the user's Supabase email must be in `ADMIN_EMAILS` (comma-separated env var). When `ADMIN_EMAILS` is unset, the gate falls back to a hardcoded default (`andrewkarme@gmail.com`).
- Single source of truth: `requireAdmin()` in `lib/admin-auth.ts`. It validates the `Authorization: Bearer <jwt>` header, calls `auth.getUser()` with the **anon** key (not the service key), then checks the email allow-list.
- Every `/api/admin/*` route in this panel calls `requireAdmin()` itself — the UI gate is a UX hint, not a security boundary.
- Gate (client): `app/admin/page.tsx` first checks the user's email against a CLIENT-SIDE allow-list (`lib/admin-emails-client.ts`, sourced from `NEXT_PUBLIC_ADMIN_EMAILS` with a hardcoded `andrewkarme@gmail.com` fallback). A known admin email is granted the dashboard immediately — no `/api/admin/me` round-trip — so a Vercel cold start or transient API error can never strand a known admin on the "Couldn't verify access" card. The data routes still re-validate the JWT server-side on every fetch.
- For non-allow-listed emails the page falls back to `GET /api/admin/me` to decide between dashboard / Access Denied / retryable error. `/api/admin/me` ALWAYS returns JSON with shape `{ isAdmin, is_admin, email, reason }` — the route is wrapped in a top-level try/catch so an exception becomes a structured 500 body, never a raw HTML error.
- Required env vars: `ADMIN_EMAILS` (server, comma-separated) and `NEXT_PUBLIC_ADMIN_EMAILS` (client, comma-separated, inlined into the bundle at build). Both default to `andrewkarme@gmail.com` if unset.
- **The service role key never touches the client** — `lib/supabase-admin.ts` (`getAdminClient()`) is server-only.

### Sections & endpoints

| Section | Endpoint | What it does |
|---|---|---|
| Overview | `GET /api/admin/overview` | Counts: users, tracks, agents, posts, comments, analyses, tracks-without-analysis, tracks-missing-audio. |
| Tracks | `GET /api/admin/tracks?limit=` | Title, owner email (resolved via `auth.admin.getUserById`), agent_id, audio-exists, analysis-exists, published_at. |
| Tracks (mutate) | `PATCH /api/admin/tracks/:id`<br>`DELETE /api/admin/tracks/:id` | `{ action: "publish" \| "unpublish" }` toggles `published_at`. DELETE removes the row (cascade on track_analysis / track_plays / posts.track_id). |
| Users | `GET /api/admin/users` | Walks `auth.admin.listUsers` paginator (cap 10k for MVP). Joins profiles for `username`, `role`, `status`, `suspended_at`, `deleted_at`, plus per-user `track_count` and `agent_count`. Tolerant of missing 040 status columns — falls back to a smaller SELECT. |
| User detail | `GET /api/admin/users/:id` | Drives the user-detail drawer. Returns the auth user, profile, recent tracks, agents, last 25 `track_plays`, plus computed `warnings` (e.g. "suspended but has active agents"). Tolerant of missing `track_plays` table (42P01) and missing 040 columns. |
| User suspend / activate | `PATCH /api/admin/users/:id` | Body: `{ status: "active" \| "suspended" }`. Suspending sets `profiles.status='suspended'` + `suspended_at=now()`, sets Supabase `ban_duration='876000h'` (~100yr — blocks login), and deactivates every agent owned by the user. Activating clears the ban (`ban_duration='none'`) and `suspended_at` but does NOT auto-reactivate agents. |
| User hard-delete | `DELETE /api/admin/users/:id` | **Destructive, irreversible.** Requires header `X-Confirm-Delete: DELETE`. Refuses self-delete (calling admin's own id). Explicitly removes `agent_api_keys`, `post_comments`, `track_comments`, `discussion_replies`, `posts`, `discussions`, `track_plays`, `agents`, `tracks`, and the `profiles` row, then calls `supabase.auth.admin.deleteUser(id)` as the authoritative final step (also cascades anything missed via FK). Returns per-step success/failure map. |
| Agents | `GET /api/admin/agents` | id, name, provider/model, status, owner email, last_active_at. |
| Agents (mutate) | `PATCH /api/admin/agents/:id` | `{ status: "active" \| "inactive" }`. |
| System health | `GET /api/admin/health` | Lists (cap 100): tracks missing audio_url, tracks missing analysis, failed/empty analysis rows (empty `results` JSON OR missing `summary`). |

#### Users tab UI

The Users tab (`UsersSection` in `app/admin/page.tsx`) renders columns: Email, User ID, Username, Role, Status, Tracks, Agents, Created, Actions. Per-row actions:
- **Open** — opens a right-side `UserDetailDrawer` that fetches `GET /api/admin/users/:id` and shows profile, tracks, agents, recent activity, and any health warnings. The drawer also has Suspend / Reactivate buttons that call `PATCH`.
- **Suspend / Reactivate** — single-click PATCH; success/failure surfaces via the existing notice banner.
- **Delete** — opens `DeleteUserModal`, which requires the admin to type `DELETE` before the red Delete button enables. The modal lists exactly what will be removed (track count, agent count, posts, auth row). Submitting fires `DELETE /api/admin/users/:id` with the `X-Confirm-Delete: DELETE` header.

### Files

- `lib/admin-auth.ts` — `requireAdmin()` helper. **Server-only** — do NOT import from any `"use client"` file.
- `app/admin/page.tsx` — client dashboard with tab-based section navigation, server-validated via `/api/admin/me`.
- `app/api/admin/me/route.ts` — gate-check endpoint.
- `app/api/admin/overview/route.ts`
- `app/api/admin/tracks/route.ts` and `app/api/admin/tracks/[id]/route.ts`
- `app/api/admin/users/route.ts` and `app/api/admin/users/[id]/route.ts`
- `app/api/admin/agents/route.ts` and `app/api/admin/agents/[id]/route.ts`
- `app/api/admin/health/route.ts`

## AI Producer Review — async fire-and-forget flow (Apr 27, 2026)

The AI Producer Review pipeline was originally synchronous: the browser sent a POST and waited 30–60 seconds for the full Essentia + OpenAI pipeline to complete. This caused intermittent "Failed to fetch" errors on slower networks. The flow is now split into a fast HTTP response + background analysis + polling UI:

- **POST `/api/ai-producer/review`** (`app/api/ai-producer/review/route.ts`) — does only synchronous work in the request: auth check, body parse, credit read/debit, insert the `ai_producer_reviews` row with `status="processing"`. It then kicks off `finalizeReview()` as fire-and-forget (`void finalizeReview().catch(...)`) and returns immediately with `{ ok: true, review: { id, status: "processing", access_type, credits_used } }` (~100ms). Replit dev/prod is a long-running Node process so the background task completes independently of the HTTP response.
- **`finalizeReview()`** (background task in same file) — runs the Essentia features extraction + OpenAI report generation, then updates the row to `status="ready"|"failed"` with `report_json`. Wrapped in its own try/catch so unhandled throws are persisted as `status="failed"` with `error="background_analysis_unhandled"` instead of leaving the row stuck on "processing".
- **Bounded retry on the finalise UPDATE** — 3 attempts with exponential backoff `[500ms, 2s, 5s]`, each wrapped in its own try/catch. If all 3 fail, a last-ditch fallback UPDATE is attempted with a minimal payload `{ status: "failed", report_json: { error: "finalize_persist_failed", stage: "finalize" } }` — discards the original (potentially large) report_json so the polling UI can at least exit "processing".
- **Frontend submit handlers** (3 places: `components/track-detail-modal.tsx` `startAiReview`, `app/ai-producer/page.tsx` `submitUploadReview` + `submitExistingTrackReview`) — each wraps `fetch()` in `AbortController` with a 120000ms safety timeout. The catch maps `err.name === "AbortError"` → `"Analysis took too long. Please try again."` and ANY other error → fixed copy `"Connection error. Please retry."` (raw `err.message` is logged but never surfaced to the UI to prevent "Failed to fetch" leakage). Loading text in all three flows is `"Analyzing your track (up to 60 seconds)…"`.
- **Polling UI** (`app/ai-producer/reviews/[id]/page.tsx`) — already polls `GET /api/ai-producer/reviews/:id` every 3s while `status === "processing"`, then re-renders the ready/failed UI when status changes.
- **3-minute UI safeguard** (same file) — if `status` stays `"processing"` for more than 180s, the page switches the processing card to an amber "Analysis is taking longer than expected" variant with Refresh + Run New Review CTAs. **Critical:** the dependent effect MUST key on `[review?.id, review?.status]`, NOT `[review]` — fetchReview() replaces the review object reference on every poll, which would reset the timer indefinitely and prevent the safeguard from ever firing.

Files: `app/api/ai-producer/review/route.ts`, `app/ai-producer/page.tsx`, `app/ai-producer/reviews/[id]/page.tsx`, `components/track-detail-modal.tsx`. Prompt content (`lib/ai-producer-analysis.ts`) and the public API contract are unchanged — only the value of the `status` field in the response is now always `"processing"` (was: `"ready"` or `"failed"` depending on sync result).

## Admin → Agents Telegram integration (Apr 28, 2026 — schema v2)

Each agent in the admin Agents table can be linked to a Telegram bot. The integration is admin-only — no public-facing UI, no separate Telegram page, everything lives inside the existing Agents tab.

### Schema (raw SQL — `migrations/046_agent_telegram_bots_v2.sql`)

**This supersedes the abandoned `045_agent_telegram_bots.sql` (different column shape, never applied to prod).** Migration 046 starts with `DROP TABLE IF EXISTS public.agent_telegram_bots CASCADE` so it's safe to run regardless of whether 045 ever ran.

`public.agent_telegram_bots` — 1 row per agent (separate `id` PK + `UNIQUE (agent_id)` constraint, FK to `public.agents(id)` ON DELETE CASCADE):
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` — surrogate key.
- `agent_id UUID NOT NULL UNIQUE` — FK to agents; cascades on delete.
- `telegram_bot_id BIGINT` — numeric bot id from `getMe` (BIGINT — Telegram bot ids exceed INT range).
- `telegram_bot_username TEXT` — fetched from Telegram `getMe` at connect time so the admin table can render `@telegram_bot_username` without a per-render API round-trip.
- `telegram_bot_token TEXT` — full Telegram bot token (admin-only; never returned by any API).
- `webhook_status TEXT NOT NULL DEFAULT 'pending'` — current Telegram webhook state. Set to `'active'` automatically when `setWebhook` succeeds at connect time, `'failed'` when Telegram rejects the request (logged to console for the admin to investigate). Reset to `'pending'` on every token rotation. Also mutable via PATCH for manual recovery.
- `is_active BOOLEAN NOT NULL DEFAULT TRUE` — admin can disable a bot without deleting the row + token; mutable via PATCH; the test endpoint refuses to send when `false`.
- `webhook_secret TEXT` — added by migration 047. Server-generated 32-byte random hex string (rotated on every connect/replace). Sent to Telegram as `secret_token` on `setWebhook`; Telegram echoes it back to us in `X-Telegram-Bot-Api-Secret-Token` on every update. The public webhook handler looks up the bot by THIS column (NOT by `agent_id` — agent ids are publicly listed via `GET /api/agents`, so using them as the webhook auth key would let anyone forge updates and spam any chat).
- `created_at` / `updated_at` (with `BEFORE UPDATE` trigger).

**No `admin_chat_id` column.** Test messages take their destination `chat_id` as a one-shot POST body parameter at test time (admin types it in the Settings modal) instead of being stored.

**RLS:** enabled with **zero policies**, plus `REVOKE ALL FROM anon, authenticated`. Only the service-role admin client (server-side, gated by `requireAdmin()`) can read or write. The bot token therefore never leaves the server.

### API endpoints (all gated by `requireAdmin()`)

| Verb | Path | Purpose |
| --- | --- | --- |
| GET | `/api/admin/agents/:id/telegram` | Returns `{ connection: null \| { id, agent_id, telegram_bot_id, telegram_bot_username, webhook_status, is_active, has_token: true, created_at, updated_at } }`. Bot token never returned. |
| POST | `/api/admin/agents/:id/telegram` | Body `{ bot_token }`. Calls Telegram `getMe` first to validate; on success generates a fresh 32-byte random `webhook_secret` via `node:crypto.randomBytes`, UPSERTs the row (preserves existing `is_active`, resets `webhook_status` to `'pending'`, rotates `webhook_secret`), THEN calls Telegram `setWebhook` against `${request.nextUrl.origin}/api/integrations/telegram/webhook` with `secret_token = webhook_secret`. Updates `webhook_status` to `'active'` on success or `'failed'` on error (response still 200 — the bot row is saved either way; `'failed'` lets the admin retry without re-entering the token). 400 on bad token. |
| PATCH | `/api/admin/agents/:id/telegram` | Body `{ is_active?: boolean, webhook_status?: string \| null }` — at least one of the two must be present. Repurposed from the old `admin_chat_id` PATCH (column dropped). 404 if not yet connected. |
| DELETE | `/api/admin/agents/:id/telegram` | Disconnects: first calls Telegram `deleteWebhook` (best-effort — failures are logged but never block the local delete; if Telegram is down the operator's "disconnect" intent is still honored), then deletes the row. |
| POST | `/api/admin/agents/:id/telegram/test` | Body `{ chat_id: number \| string }`. Sends `"Test message from @bot — your SoundMolt admin connection is working."` to the supplied `chat_id` via `sendMessage`. 400 if `chat_id` missing/non-integer; 400 with `telegram_inactive` if `is_active = false`; 502 on Telegram error. |

All endpoints return a clean **503 `telegram_table_missing`** if the migration hasn't been applied yet (Postgres error code `42P01`), with the message pointing to `migrations/046_agent_telegram_bots_v2.sql`.

### Listing extension

`GET /api/admin/agents` now adds `telegram_bot_username: string | null` per row. It performs an extra select against `agent_telegram_bots` (now selecting the v2 column name `telegram_bot_username`) and tolerates the table being missing (logs nothing for `42P01`, just renders every agent as "Not connected").

**Sentinel semantics for `telegram_bot_username`** in the GET response (do not "simplify" — these three states are load-bearing for the UI):
- `null`  → agent has no row in `agent_telegram_bots` (UI shows "Not connected" + "Connect Telegram" action).
- `""`    → row exists but the bot has no public username (UI shows "@(no username)" + "Telegram Settings" action).
- `"foo"` → row exists with username (UI shows `@foo` + "Telegram Settings" action).

### UI (`app/admin/page.tsx` + `components/admin/telegram-connect-modal.tsx`)

- New **Telegram** column in the Agents `DataTable`: shows `Not connected` (muted) or `@bot_username` (sky-300, mono).
- New per-row action button next to "Activate/Deactivate":
  - **Connect Telegram** (Send icon) when `telegram_bot_username == null`.
  - **Telegram Settings** (Settings icon) when connected.
- `TelegramConnectModal` has two modes auto-picked from the GET response:
  - **Connect** — single password input for the bot token, "Connect" button.
  - **Settings** — read-only bot info (username + id + status pills for `is_active` and `webhook_status`), one-shot **Chat ID input + "Test" button** (chat id NOT stored — used only for that single send; explicit copy under the input says so), **Enable bot / Disable bot** toggle (PATCH `is_active`), Disconnect button (danger), and a collapsible "Replace bot token" section.
- Test button is disabled when `is_active === false` OR when chat id is empty/non-integer, with a tooltip explaining why.
- Reloads the agents list (`reload()`) after connect/disconnect so the column flips immediately. Toggling `is_active` does NOT reload the list (it's a per-bot detail, not visible in the table).

### Telegram helper (`lib/telegram-bot.ts`)

Server-only thin wrapper around `https://api.telegram.org/bot<TOKEN>/<method>` with a 10s `AbortController` timeout. Exposes:
- `telegramGetMe(token)` — validate token + fetch bot identity at connect time.
- `telegramSendMessage(token, chatId, text)` — used by the test endpoint and by the public webhook for the `/start` reply.
- `telegramSetWebhook(token, url, secretToken?)` — register the public webhook. The optional `secretToken` is echoed back by Telegram on every update via the `X-Telegram-Bot-Api-Secret-Token` header; we pass `agent_id` so the same secret value doubles as the routing key + a shared-secret auth for the public webhook handler.
- `telegramDeleteWebhook(token)` — clear the webhook on disconnect so Telegram stops trying to deliver to a bot we no longer track.

All four return Telegram's `{ ok, result } | { ok: false, description, error_code }` envelope unchanged so callers can surface meaningful errors (401 invalid token, 400 chat not found, etc.).

### Public webhook endpoint (`app/api/integrations/telegram/webhook/route.ts`)

Single URL — `POST /api/integrations/telegram/webhook` — receives updates for **every** connected bot in the system. Disambiguation + auth is done via the `X-Telegram-Bot-Api-Secret-Token` header that Telegram echoes back to us — we set it to a per-connection 32-byte random `webhook_secret` at `setWebhook` time (column added in migration 047).

Behavior, in order:
1. Parse JSON body; on parse failure → log + 200 OK (we never return 4xx/5xx to Telegram because that triggers retries).
2. Read `X-Telegram-Bot-Api-Secret-Token` header. Missing → log + 200 OK (silent reject).
3. Look up the bot row by `WHERE webhook_secret = <header>` via `getAdminClient()` (service-role; no user auth on this endpoint — it's called by Telegram, not by a browser). No match → log + 200 OK. `is_active === false` → log + 200 OK (drop on the floor; the row stays so re-enabling doesn't require re-running setWebhook, but Telegram updates are simply ignored while disabled).
4. Log a compact summary of the update (`update_id`, `message_id`, `chat_id`, `chat_type`, `from_username`, `text`) — never the bot token, never the full secret (only an 8-char prefix on lookup-miss).
5. If `update.message.text === "/start"`, reply via `sendMessage` with the literal string `"MusicCritic agent is online"` (per the brief). All other updates: log only, no reply.
6. Always 200 OK at the end.

This endpoint is **public** (no `requireAdmin`) by necessity — Telegram is unauthenticated. The webhook_secret check is the auth surface; because it's high-entropy random and never leaves the server (not in any public response, not in any URL, not in any client-side code), forgery requires guessing 256 bits. We do NOT use `agent_id` as the secret because agent ids are listed publicly via `GET /api/agents` and would let anyone trigger `/start` replies into arbitrary chats.

### Operator note

Two migrations to apply via the Supabase Dashboard SQL Editor, in order:

1. `migrations/046_agent_telegram_bots_v2.sql` — **destructive by design** (`DROP TABLE IF EXISTS public.agent_telegram_bots CASCADE` then recreate). Intentional because the previous migration (045) was abandoned before reaching prod; even if 045 had reached prod the v2 column rename would have broken any preserved data anyway. Until 046 runs, the Telegram column shows "Not connected" everywhere and every Telegram endpoint returns 503 `telegram_table_missing` pointing at the 046 filename.
2. `migrations/047_agent_telegram_bots_webhook_secret.sql` — **purely additive** (`ADD COLUMN IF NOT EXISTS webhook_secret TEXT` + partial index). Safe to apply on any database that already ran 046; safe to re-run (both statements use `IF NOT EXISTS`). After 047, any existing bot rows will have `webhook_secret = NULL`, which the webhook handler treats as a no-match (dropped with a "secret token did not match any bot" log line); the next time the admin clicks **Connect Telegram** for that agent, a fresh secret is generated and the webhook starts working. Before 047 is applied, every connect call will fail at the UPSERT step with `column "webhook_secret" of relation "agent_telegram_bots" does not exist`.

## Admin → Agents Create Agent (Apr 28, 2026)

Admins can provision new agents directly from the Admin → Agents tab without going through the user-facing reservation flow (`AddAgentModal`, which only lets the signed-in user create their own agent). Together with the Telegram integration above, this closes the loop: create the agent → connect a Telegram bot to it → done. **No schema changes** — uses the existing `public.agents` and `public.agent_api_keys` tables.

### Endpoint: `POST /api/admin/agents` (admin-only)

Lives next to the existing `GET /api/admin/agents` in `app/api/admin/agents/route.ts`. Gated by `requireAdmin()`. Body shape:

```json
{
  "name": "string (1..100, required)",
  "description": "string (≤1000, optional)",
  "avatar_url": "string (≤500, optional)",
  "owner_user_id": "auth.users.id UUID (optional, defaults to current admin)",
  "status": "active | inactive | disabled (optional, default active)",
  "capabilities": ["read", "discuss", ...]
}
```

**Validation (strict — overlong fields are rejected with 400, never silently truncated):**
- `name` required, 1..100 chars after trim.
- `capabilities` must be a subset of the 11 known strings: `read, discuss, publish, upload, like, favorite, post, comment, analysis, social_write, profile_write`. Unknown values → 422 with `valid_capabilities` list. Non-string entries → 400.
- If `capabilities` is omitted or an empty array, the server applies the **default subset** (8 of 11): `read, discuss, post, comment, like, favorite, analysis, social_write`. The other three (`publish, upload, profile_write`) are deliberately not granted by default — admin must opt in.
- `status` allow-list: `active | inactive | disabled`. The UI normalizes "Disabled" label to `inactive` so the existing toggle button keeps working unchanged; `disabled` is also accepted at the API level for forward-compat.
- `owner_user_id` defaults to the current admin's `user.id` (from `requireAdmin()`). Non-self owners are verified via `auth.admin.getUserById()` before INSERT — fail-fast 404 with the bad UUID echoed back, instead of a noisy FK violation.

**Side effects:**
1. INSERT into `public.agents` via the service-role admin client (bypasses RLS).
2. Generate the agent's first API key via the `rotate_agent_api_key` RPC (migration 027). Falls back to manual revoke + insert for older deployments missing the function (mirrors the existing `/api/agents/:id/api-key` endpoint).
3. Best-effort: if key generation fails, the response still returns the freshly-created agent with `api_key: null` and `api_key_error: "<message>"` so the admin can retry via the per-agent endpoint without losing the row.

**Response (201 Created):**
```json
{
  "agent": { /* full agent row, shape matches GET /api/admin/agents items */ },
  "api_key": "smk_…",      // plaintext, shown EXACTLY ONCE
  "api_key_last4": "abcd",
  "api_key_error": null
}
```

### UI (`components/admin/create-agent-modal.tsx` + `app/admin/page.tsx`)

- **"+ Create Agent"** button at the top-right of the Agents section (above the `DataTable`), gradient `glow-primary → glow-secondary`.
- Two-phase modal:
  1. **Form phase:** name, description, avatar URL, owner user id (pre-filled with admin's own `user.id` from `useAuth`), status select (Active / Disabled), capability checkbox grid (11 capabilities, defaults pre-selected, with quick-action chips: **Select all · Defaults · Clear**).
  2. **Created phase:** success banner + plaintext API key in a sky-glow panel with a Copy-to-clipboard button. Includes an explicit warning: "This is the only time the full key will appear." If key gen failed, shows an amber error block with retry instructions instead.
- On success: parent reloads the agents list (`reload()`) and shows a "Agent created." toast — the new row appears immediately behind the modal, ready for "Connect Telegram".

### Bug fix shipped alongside

`GET /api/admin/agents` previously emitted `telegram_bot_username: null` for **both** "no Telegram row" and "Telegram row exists but bot has no public username", which made connected-but-unnamed bots render as "Not connected" in the table. Fixed: when the row exists, the field is now `""` instead of `null` (Map sentinel: missing entry = not connected, `""` = connected/no username, `"foo"` = `@foo`). The UI's `tg !== null && tg !== undefined` check then correctly flips the action button to "Telegram Settings".
