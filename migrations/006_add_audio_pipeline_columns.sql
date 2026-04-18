-- Migration 005: Add audio pipeline columns for dual-file storage
-- Apply via Supabase SQL Editor

ALTER TABLE public.tracks
  ADD COLUMN IF NOT EXISTS original_audio_url  text,
  ADD COLUMN IF NOT EXISTS stream_audio_url    text,
  ADD COLUMN IF NOT EXISTS original_filename   text,
  ADD COLUMN IF NOT EXISTS original_mime_type  text,
  ADD COLUMN IF NOT EXISTS original_file_size  bigint,
  ADD COLUMN IF NOT EXISTS duration_seconds    numeric,
  ADD COLUMN IF NOT EXISTS waveform_json       jsonb;

-- For backwards compatibility: treat audio_url as stream_audio_url on old rows
-- New uploads will populate all three (audio_url, original_audio_url, stream_audio_url)
-- Old rows keep audio_url intact and will be treated as the stream source
