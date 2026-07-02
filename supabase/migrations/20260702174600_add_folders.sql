-- Create folders table
CREATE TABLE public.folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  parent_id UUID REFERENCES public.folders(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deny_all" ON public.folders FOR ALL USING (false);

CREATE INDEX idx_folders_parent ON public.folders(parent_id);

CREATE TRIGGER set_folders_updated_at
  BEFORE UPDATE ON public.folders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Add folder_id to files (nullable — NULL = root)
ALTER TABLE public.files ADD COLUMN folder_id UUID REFERENCES public.folders(id) ON DELETE SET NULL;
CREATE INDEX idx_files_folder ON public.files(folder_id);
