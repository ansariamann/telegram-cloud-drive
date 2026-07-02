import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type FilePart = {
  index: number;
  file_id: string;
  message_id: number;
  size: number;
};

export type FileRow = {
  id: string;
  filename: string;
  mime: string;
  size_bytes: number;
  kind: string;
  parts: FilePart[];
  tags: string[];
  thumb_file_id: string | null;
  created_at: string;
  updated_at: string;
};

export async function listFiles(opts: {
  q?: string;
  kind?: string;
  sort?: "created_desc" | "created_asc" | "name_asc" | "name_desc" | "size_desc" | "size_asc";
}): Promise<FileRow[]> {
  let query = supabaseAdmin.from("files").select("*");
  if (opts.q) query = query.ilike("filename", `%${opts.q}%`);
  if (opts.kind && opts.kind !== "all") query = query.eq("kind", opts.kind);
  const sort = opts.sort ?? "created_desc";
  const [col, dir] =
    sort === "created_desc"
      ? (["created_at", false] as const)
      : sort === "created_asc"
      ? (["created_at", true] as const)
      : sort === "name_asc"
      ? (["filename", true] as const)
      : sort === "name_desc"
      ? (["filename", false] as const)
      : sort === "size_desc"
      ? (["size_bytes", false] as const)
      : (["size_bytes", true] as const);
  query = query.order(col, { ascending: dir }).limit(500);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as FileRow[];
}

export async function getFile(id: string): Promise<FileRow | null> {
  const { data, error } = await supabaseAdmin.from("files").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as unknown as FileRow) ?? null;
}

export async function insertFile(row: Omit<FileRow, "id" | "created_at" | "updated_at">): Promise<FileRow> {
  const { data, error } = await supabaseAdmin.from("files").insert(row as never).select("*").single();
  if (error) throw error;
  return data as unknown as FileRow;
}

export async function updateFile(id: string, patch: Partial<Pick<FileRow, "filename" | "tags">>): Promise<FileRow> {
  const { data, error } = await supabaseAdmin
    .from("files")
    .update(patch as never)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as FileRow;
}

export async function deleteFileRow(id: string): Promise<void> {
  const { error } = await supabaseAdmin.from("files").delete().eq("id", id);
  if (error) throw error;
}