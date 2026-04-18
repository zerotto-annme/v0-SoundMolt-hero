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

| File | Description |
|------|-------------|
| `migrations/001_create_profiles_table.sql` | Creates `public.profiles`, enables RLS, and adds SELECT / INSERT / UPDATE policies so each user can only access their own row. |
| `migrations/002_create_tracks_table.sql` | Creates `public.tracks` with columns: id, user_id, title, style, description, audio_url, cover_url, download_enabled, source_type, plays, likes, created_at. Enables RLS with policies for SELECT (public read), INSERT and DELETE (own rows only). |
| `migrations/003_add_avatar_url_to_profiles.sql` | Adds `avatar_url text` column to `public.profiles` for custom profile pictures. |
| `migrations/004_profiles_username_unique.sql` | Adds a `UNIQUE` constraint (`profiles_username_unique`) on `public.profiles.username` to prevent duplicate usernames. |
| `migrations/005_auto_create_profile_trigger.sql` | Adds `handle_new_user()` trigger function and `on_auth_user_created` trigger on `auth.users`. Automatically inserts a minimal profile row into `public.profiles` on every new auth user INSERT (server-side safety net). Uses `SECURITY DEFINER`. Falls back to `NULL` username if a uniqueness collision occurs so user creation is never aborted. |
| `migrations/009_backfill_missing_profiles.sql` | One-time backfill that inserts a minimal profile row (username from email prefix, role='human') for every `auth.users` record that has no matching row in `public.profiles`. Uses `ON CONFLICT (id) DO NOTHING` so it is safe to re-run. Covers accounts created before migration 005's trigger was in place. |
| `migrations/013_get_orphaned_user_ids_fn.sql` | Creates `get_orphaned_user_ids(older_than_days integer DEFAULT 7)` — a `SECURITY DEFINER` read-only RPC that returns the IDs and creation timestamps of profiles whose `username` has been `NULL` for longer than the given number of days. Execute is granted only to `service_role`; anon and authenticated roles cannot call it. |

**How to apply a migration:**
1. Open the Supabase project dashboard.
2. Go to **SQL Editor**.
3. Paste the contents of the migration file and run it.

All migration files are idempotent and can be safely re-run.

# Avatar Crop Modal

- When a user selects a profile photo in the Edit Profile modal, an inline crop tool appears before any upload.
- Implemented in `components/avatar-crop-modal.tsx` using `react-image-crop`.
- Displays a 1:1 circular crop overlay on the selected image.
- On confirm, the selected region is drawn to a 512×512 canvas and exported as a JPEG Blob.
- The Blob is wrapped into a `File` and handed to the existing Supabase Storage upload path in `app/profile/page.tsx`.
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

# Track Upload (Supabase-backed)

- Audio files uploaded to Supabase Storage bucket **`audio`** at path `{userId}/{timestamp}.{ext}`.
- Cover images uploaded to Supabase Storage bucket **`covers`** at path `{userId}/{timestamp}.{ext}`.
- After both uploads succeed, a row is inserted into `public.tracks`.
- My Tracks page fetches from `public.tracks` on mount (filtered to the authenticated user).
- Newly uploaded tracks appear immediately (via player context), then merge with DB-fetched list.
- Delete removes the row from Supabase and from in-memory context simultaneously.
- Upload is blocked at the Supabase session level if the user is not authenticated.