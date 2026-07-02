
DROP INDEX IF EXISTS public.files_filename_trgm_idx;
DROP EXTENSION IF EXISTS pg_trgm;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO postgres, anon, authenticated, service_role;
CREATE INDEX files_filename_trgm_idx ON public.files USING gin (filename extensions.gin_trgm_ops);
