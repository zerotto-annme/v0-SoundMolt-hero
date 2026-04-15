-- Create profiles table
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;

CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Create user_tracks table
CREATE TABLE IF NOT EXISTS public.user_tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  agent_type TEXT,
  agent_label TEXT,
  model_type TEXT NOT NULL,
  model_provider TEXT NOT NULL,
  style TEXT NOT NULL,
  cover_url TEXT,
  duration INTEGER DEFAULT 60,
  prompt TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.user_tracks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_tracks_select_own" ON public.user_tracks;
DROP POLICY IF EXISTS "user_tracks_insert_own" ON public.user_tracks;
DROP POLICY IF EXISTS "user_tracks_delete_own" ON public.user_tracks;

CREATE POLICY "user_tracks_select_own" ON public.user_tracks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "user_tracks_insert_own" ON public.user_tracks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "user_tracks_delete_own" ON public.user_tracks FOR DELETE USING (auth.uid() = user_id);

-- Create liked_tracks table
CREATE TABLE IF NOT EXISTS public.liked_tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, track_id)
);

ALTER TABLE public.liked_tracks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "liked_tracks_select_own" ON public.liked_tracks;
DROP POLICY IF EXISTS "liked_tracks_insert_own" ON public.liked_tracks;
DROP POLICY IF EXISTS "liked_tracks_delete_own" ON public.liked_tracks;

CREATE POLICY "liked_tracks_select_own" ON public.liked_tracks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "liked_tracks_insert_own" ON public.liked_tracks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "liked_tracks_delete_own" ON public.liked_tracks FOR DELETE USING (auth.uid() = user_id);

-- Create followed_agents table
CREATE TABLE IF NOT EXISTS public.followed_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, agent_name)
);

ALTER TABLE public.followed_agents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "followed_agents_select_own" ON public.followed_agents;
DROP POLICY IF EXISTS "followed_agents_insert_own" ON public.followed_agents;
DROP POLICY IF EXISTS "followed_agents_delete_own" ON public.followed_agents;

CREATE POLICY "followed_agents_select_own" ON public.followed_agents FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "followed_agents_insert_own" ON public.followed_agents FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "followed_agents_delete_own" ON public.followed_agents FOR DELETE USING (auth.uid() = user_id);

-- Create recently_played table
CREATE TABLE IF NOT EXISTS public.recently_played (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL,
  played_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.recently_played ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "recently_played_select_own" ON public.recently_played;
DROP POLICY IF EXISTS "recently_played_insert_own" ON public.recently_played;
DROP POLICY IF EXISTS "recently_played_delete_own" ON public.recently_played;

CREATE POLICY "recently_played_select_own" ON public.recently_played FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "recently_played_insert_own" ON public.recently_played FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "recently_played_delete_own" ON public.recently_played FOR DELETE USING (auth.uid() = user_id);
