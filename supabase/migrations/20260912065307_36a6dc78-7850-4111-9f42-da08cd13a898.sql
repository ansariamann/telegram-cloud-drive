CREATE UNIQUE INDEX files_unique_name_size_folder_idx
ON public.files (filename, size_bytes, COALESCE(folder_id, '00000000-0000-0000-0000-000000000000'::uuid));