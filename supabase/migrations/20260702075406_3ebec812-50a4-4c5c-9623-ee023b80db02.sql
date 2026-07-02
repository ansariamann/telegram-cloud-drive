
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE public.files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes BIGINT NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'other',
  parts JSONB NOT NULL DEFAULT '[]'::jsonb,
  tags TEXT[] NOT NULL DEFAULT '{}',
  thumb_file_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.files TO service_role;

ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "No direct access" ON public.files FOR ALL USING (false) WITH CHECK (false);

CREATE INDEX files_created_at_idx ON public.files (created_at DESC);
CREATE INDEX files_kind_idx ON public.files (kind);
CREATE INDEX files_filename_trgm_idx ON public.files USING gin (filename gin_trgm_ops);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_files_updated_at
BEFORE UPDATE ON public.files
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
