const CHUNK_SIZE = 45 * 1024 * 1024; // 45 MB (Telegram Bot API limit is 50 MB)

import { vaultFetch } from "@/lib/vault-client";

export type UploadPart = { index: number; file_id: string; message_id: number; size: number; thumb_file_id?: string | null };

export type UploadProgress = {
  loaded: number;
  total: number;
  partIndex: number;
  totalParts: number;
};

export async function uploadFile(
  file: File,
  onProgress: (p: UploadProgress) => void,
  folderId?: string | null,
  signal?: AbortSignal,
): Promise<{ id: string; filename: string }> {
  const totalParts = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
  const parts: UploadPart[] = [];
  let firstThumb: string | null = null;
  let loaded = 0;

  for (let i = 0; i < totalParts; i++) {
    if (signal?.aborted) throw new Error("Upload cancelled");
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const slice = file.slice(start, end);
    const form = new FormData();
    form.set("blob", slice, file.name);
    form.set("filename", file.name);
    form.set("mime", file.type || "application/octet-stream");
    form.set("index", String(i));
    form.set("totalParts", String(totalParts));
    const res = await vaultFetch("/api/upload-chunk", { method: "POST", body: form, signal });
    if (!res.ok) throw new Error(`Part ${i + 1}/${totalParts} failed: ${res.status}`);
    const data = (await res.json()) as UploadPart;
    parts.push(data);
    if (i === 0 && data.thumb_file_id) firstThumb = data.thumb_file_id;
    loaded += end - start;
    onProgress({ loaded, total: file.size, partIndex: i + 1, totalParts });
  }

  const fin = await vaultFetch("/api/upload-finalize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      mime: file.type || "application/octet-stream",
      size: file.size,
      parts: parts.map(({ index, file_id, message_id, size }) => ({ index, file_id, message_id, size })),
      thumb_file_id: firstThumb,
      folder_id: folderId ?? null,
    }),
  });
  if (!fin.ok) throw new Error(`Finalize failed: ${fin.status}`);
  const j = (await fin.json()) as { file: { id: string; filename: string } };
  return j.file;
}