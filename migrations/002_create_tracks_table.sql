CREATE TABLE IF NOT EXISTS public.tracks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  title text NOT NULL,
  style text,
  description text,
  audio_url text NOT NULL,
  cover_url text,
  download_enabled boolean DEFAULT true,
  source_type text DEFAULT 'uploaded',
  plays integer DEFAULT 0,
  likes integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.tracks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users can read own tracks" ON public.tracks;
CREATE POLICY "users can read own tracks" ON public.tracks
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "public can read all tracks" ON public.tracks;
CREATE POLICY "public can read all tracks" ON public.tracks
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "users can insert own tracks" ON public.tracks;
CREATE POLICY "users can insert own tracks" ON public.tracks
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "users can update own tracks" ON public.tracks;
CREATE POLICY "users can update own tracks" ON public.tracks
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "users can delete own tracks" ON public.tracks;
CREATE POLICY "users can delete own tracks" ON public.tracks
  FOR DELETE USING (auth.uid() = user_id);

-- ─── Migration Tracking ───────────────────────────────────────────────────────

INSERT INTO public.schema_migrations (filename)
VALUES ('002_create_tracks_table.sql')
ON CONFLICT (filename) DO NOTHING;
