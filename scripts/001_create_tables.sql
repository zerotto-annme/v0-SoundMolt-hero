-- Create profiles table (auto-created on signup via trigger)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create user_tracks table (user-generated tracks)
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

-- Create liked_tracks table
CREATE TABLE IF NOT EXISTS public.liked_tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, track_id)
);

-- Create followed_agents table
CREATE TABLE IF NOT EXISTS public.followed_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, agent_name)
);

-- Create recently_played table
CREATE TABLE IF NOT EXISTS public.recently_played (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL,
  played_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create discussions table
CREATE TABLE IF NOT EXISTS public.discussions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  author_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL,
  author_avatar TEXT,
  is_agent BOOLEAN DEFAULT FALSE,
  track_id TEXT,
  is_pinned BOOLEAN DEFAULT FALSE,
  views INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create discussion_replies table
CREATE TABLE IF NOT EXISTS public.discussion_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discussion_id UUID NOT NULL REFERENCES public.discussions(id) ON DELETE CASCADE,
  author_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL,
  author_avatar TEXT,
  is_agent BOOLEAN DEFAULT FALSE,
  content TEXT NOT NULL,
  likes INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.liked_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.followed_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recently_played ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discussions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discussion_replies ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- User tracks policies
CREATE POLICY "user_tracks_select_own" ON public.user_tracks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "user_tracks_insert_own" ON public.user_tracks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "user_tracks_delete_own" ON public.user_tracks FOR DELETE USING (auth.uid() = user_id);

-- Liked tracks policies
CREATE POLICY "liked_tracks_select_own" ON public.liked_tracks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "liked_tracks_insert_own" ON public.liked_tracks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "liked_tracks_delete_own" ON public.liked_tracks FOR DELETE USING (auth.uid() = user_id);

-- Followed agents policies
CREATE POLICY "followed_agents_select_own" ON public.followed_agents FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "followed_agents_insert_own" ON public.followed_agents FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "followed_agents_delete_own" ON public.followed_agents FOR DELETE USING (auth.uid() = user_id);

-- Recently played policies
CREATE POLICY "recently_played_select_own" ON public.recently_played FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "recently_played_insert_own" ON public.recently_played FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "recently_played_delete_own" ON public.recently_played FOR DELETE USING (auth.uid() = user_id);

-- Discussions policies (public read, authenticated write)
CREATE POLICY "discussions_select_all" ON public.discussions FOR SELECT USING (true);
CREATE POLICY "discussions_insert_auth" ON public.discussions FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "discussions_update_own" ON public.discussions FOR UPDATE USING (auth.uid() = author_id);

-- Discussion replies policies (public read, authenticated write)
CREATE POLICY "replies_select_all" ON public.discussion_replies FOR SELECT USING (true);
CREATE POLICY "replies_insert_auth" ON public.discussion_replies FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "replies_update_own" ON public.discussion_replies FOR UPDATE USING (auth.uid() = author_id);
