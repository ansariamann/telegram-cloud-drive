import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { randomBytes } from "node:crypto";

export type FolderShareRow = {
  id: string;
  folder_id: string;
  token: string;
  label: string | null;
  allow_upload: boolean;
  allow_download: boolean;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

/** Generate a cryptographically secure 32-char hex token */
function generateToken(): string {
  return randomBytes(16).toString("hex");
}

/** Get all active shares for a folder */
export async function listFolderShares(folderId: string): Promise<FolderShareRow[]> {
  const { data, error } = await supabaseAdmin
    .from("folder_shares")
    .select("*")
    .eq("folder_id", folderId)
    .eq("is_active", true)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as FolderShareRow[];
}

/** Create a new share link for a folder */
export async function createFolderShare(opts: {
  folderId: string;
  label?: string;
  allowUpload?: boolean;
  allowDownload?: boolean;
  expiresAt?: string | null;
}): Promise<FolderShareRow> {
  const row = {
    folder_id: opts.folderId,
    token: generateToken(),
    label: opts.label ?? null,
    allow_upload: opts.allowUpload ?? true,
    allow_download: opts.allowDownload ?? true,
    expires_at: opts.expiresAt ?? null,
    is_active: true,
  };
  const { data, error } = await supabaseAdmin
    .from("folder_shares")
    .insert(row as never)
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as FolderShareRow;
}

/** Deactivate (revoke) a share */
export async function revokeFolderShare(shareId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("folder_shares")
    .update({ is_active: false } as never)
    .eq("id", shareId);
  if (error) throw error;
}

/** Validate a share token. Returns the share row if valid, null otherwise. */
export async function validateShareToken(token: string): Promise<FolderShareRow | null> {
  if (!token || token.length < 16) return null;
  const { data, error } = await supabaseAdmin
    .from("folder_shares")
    .select("*")
    .eq("token", token)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const share = data as unknown as FolderShareRow;
  // Check expiry
  if (share.expires_at && new Date(share.expires_at) < new Date()) {
    return null;
  }
  return share;
}

/** Get a share by ID (owner operations) */
export async function getFolderShare(shareId: string): Promise<FolderShareRow | null> {
  const { data, error } = await supabaseAdmin
    .from("folder_shares")
    .select("*")
    .eq("id", shareId)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as FolderShareRow) ?? null;
}
