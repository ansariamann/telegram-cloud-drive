import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type FolderRow = {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
};

export async function listFolders(parentId: string | null): Promise<FolderRow[]> {
  let query = supabaseAdmin.from("folders").select("*");
  if (parentId === null) {
    query = query.is("parent_id", null);
  } else {
    query = query.eq("parent_id", parentId);
  }
  query = query.order("name", { ascending: true });
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as FolderRow[];
}

export async function getFolder(id: string): Promise<FolderRow | null> {
  const { data, error } = await supabaseAdmin.from("folders").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as unknown as FolderRow) ?? null;
}

export async function createFolder(name: string, parentId: string | null): Promise<FolderRow> {
  const row: { name: string; parent_id?: string } = { name };
  if (parentId) row.parent_id = parentId;
  const { data, error } = await supabaseAdmin.from("folders").insert(row as never).select("*").single();
  if (error) throw error;
  return data as unknown as FolderRow;
}

export async function renameFolder(id: string, name: string): Promise<FolderRow> {
  const { data, error } = await supabaseAdmin
    .from("folders")
    .update({ name } as never)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as FolderRow;
}

export async function deleteFolder(id: string): Promise<void> {
  const { error } = await supabaseAdmin.from("folders").delete().eq("id", id);
  if (error) throw error;
}

export async function getFolderBreadcrumbs(id: string): Promise<FolderRow[]> {
  const crumbs: FolderRow[] = [];
  let currentId: string | null = id;
  while (currentId) {
    const folder = await getFolder(currentId);
    if (!folder) break;
    crumbs.unshift(folder);
    currentId = folder.parent_id;
  }
  return crumbs;
}
