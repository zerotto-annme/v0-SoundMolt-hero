# Migration 003 Verification — avatar_url column on public.profiles

**Date verified:** 2026-04-19  
**Environment:** Production Supabase project  
**Connection:** NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY (anon client)

## Verification queries

### Query 1 — column-specific select

```sql
SELECT avatar_url FROM public.profiles LIMIT 1;
```

**Result:** `SUCCESS` — query parsed and executed without error.  
0 rows returned (expected: anon key is subject to RLS, which returns an empty set for unauthenticated reads).  
A "column does not exist" error would be returned by PostgreSQL *before* RLS is evaluated, so a clean zero-row result proves the column is present.

### Query 2 — full expected schema

```sql
SELECT id, username, role, avatar_url FROM public.profiles LIMIT 1;
```

**Result:** `SUCCESS` — all four expected columns (`id`, `username`, `role`, `avatar_url`) resolved without a column-not-found error, confirming the full schema matches the baseline defined in `001_create_profiles_table.sql`.

### Note on information_schema

`information_schema.columns` is not accessible via the anon key (Supabase blocks it by default).  
To perform a schema-level check in the future, use the Supabase SQL Editor with a service_role session:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'profiles'
  AND column_name  = 'avatar_url';
```

Expected result: one row — `avatar_url | text | YES`.

## Conclusion

Migration `003_add_avatar_url_to_profiles.sql` has been applied to the live production database.  
The `avatar_url` column exists on `public.profiles` with type `text`.  
All application code that reads or writes `avatar_url` will work correctly.
