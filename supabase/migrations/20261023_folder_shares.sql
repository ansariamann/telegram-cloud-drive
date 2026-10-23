-- Public share links for folders
CREATE TABLE IF NOT EXISTS public.folder_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id UUID NOT NULL REFERENCES public.folders(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  label TEXT,
  allow_upload BOOLEAN NOT NULL DEFAULT true,
  allow_download BOOLEAN NOT NULL DEFAULT true,
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.folder_shares TO service_role;
ALTER TABLE public.folder_shares ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deny_all" ON public.folder_shares;
CREATE POLICY "deny_all" ON public.folder_shares FOR ALL USING (false);

CREATE INDEX IF NOT EXISTS idx_folder_shares_folder ON public.folder_shares(folder_id);
CREATE INDEX IF NOT EXISTS idx_folder_shares_token ON public.folder_shares(token);

DROP TRIGGER IF EXISTS update_folder_shares_updated_at ON public.folder_shares;
CREATE TRIGGER update_folder_shares_updated_at
  BEFORE UPDATE ON public.folder_shares
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
