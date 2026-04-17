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

**How to apply a migration:**
1. Open the Supabase project dashboard.
2. Go to **SQL Editor**.
3. Paste the contents of the migration file and run it.

All migration files are idempotent and can be safely re-run.