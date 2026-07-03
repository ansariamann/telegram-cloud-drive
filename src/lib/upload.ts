import { vaultFetch } from "@/lib/vault-client";

const CHUNK_SIZE = 45 * 1024 * 1024; // 45 MB (Telegram Bot API limit is 50 MB)
const MAX_RETRIES = 3;

export type UploadPart = {
  index: number;
  file_id: string;
  message_id: number;
  size: number;
  thumb_file_id?: string | null;
};

export type UploadProgress = {
  loaded: number;
  total: number;
  partIndex: number;
  totalParts: number;
};

async function uploadChunkWithRetry(
  form: FormData,
  signal: AbortSignal | undefined,
  partLabel: string,
): Promise<UploadPart> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (signal?.aborted) throw new Error("Upload cancelled");
    try {
      const res = await vaultFetch("/api/upload-chunk", { method: "POST", body: form, signal });
      if (!res.ok) throw new Error(`${partLabel} failed: ${res.status}`);
      return (await res.json()) as UploadPart;
    } catch (err) {
      // Don't retry on abort
      if (err instanceof Error && err.name === "AbortError") throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES - 1) {
        // Exponential back-off: 500ms, 1000ms, 2000ms
        await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
      }
    }
  }
  throw lastError ?? new Error(`${partLabel} failed after ${MAX_RETRIES} attempts`);
}

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

    const data = await uploadChunkWithRetry(form, signal, `Part ${i + 1}/${totalParts}`);
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
      parts: parts.map(({ index, file_id, message_id, size }) => ({
        index,
        file_id,
        message_id,
        size,
      })),
      thumb_file_id: firstThumb,
      folder_id: folderId ?? null,
    }),
    signal,
  });
  if (!fin.ok) throw new Error(`Finalize failed: ${fin.status}`);
  const j = (await fin.json()) as { file: { id: string; filename: string } };
  return j.file;
}
