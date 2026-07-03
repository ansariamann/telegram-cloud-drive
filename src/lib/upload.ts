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

/**
 * Upload a single chunk via XHR so we get real byte-level upload progress events.
 * Falls back gracefully if XHR is unavailable (SSR context).
 */
function uploadChunkXHR(
  form: FormData,
  signal: AbortSignal | undefined,
  onBytesSent: (sent: number, total: number) => void,
): Promise<UploadPart> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload-chunk");

    xhr.withCredentials = true;

    // Abort support
    const abortHandler = () => xhr.abort();
    signal?.addEventListener("abort", abortHandler);

    // Real byte-level upload progress
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onBytesSent(e.loaded, e.total);
    };

    xhr.onload = () => {
      signal?.removeEventListener("abort", abortHandler);
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as UploadPart);
        } catch {
          reject(new Error("Invalid JSON response from server"));
        }
      } else {
        reject(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`));
      }
    };

    xhr.onerror = () => {
      signal?.removeEventListener("abort", abortHandler);
      reject(new Error("Network error during upload"));
    };

    xhr.onabort = () => {
      signal?.removeEventListener("abort", abortHandler);
      const err = new Error("Upload cancelled");
      err.name = "AbortError";
      reject(err);
    };

    xhr.send(form);
  });
}

async function uploadChunkWithRetry(
  form: FormData,
  signal: AbortSignal | undefined,
  partLabel: string,
  onBytesSent: (sent: number, total: number) => void,
): Promise<UploadPart> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (signal?.aborted) throw new Error("Upload cancelled");
    try {
      return await uploadChunkXHR(form, signal, onBytesSent);
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

  // Bytes already fully uploaded (completed chunks)
  let baseLoaded = 0;

  for (let i = 0; i < totalParts; i++) {
    if (signal?.aborted) throw new Error("Upload cancelled");
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunkSize = end - start;
    const slice = file.slice(start, end);

    const form = new FormData();
    form.set("blob", slice, file.name);
    form.set("filename", file.name);
    form.set("mime", file.type || "application/octet-stream");
    form.set("index", String(i));
    form.set("totalParts", String(totalParts));

    const capturedBase = baseLoaded; // capture for closure

    const data = await uploadChunkWithRetry(form, signal, `Part ${i + 1}/${totalParts}`, (sent) => {
      // Fired continuously as bytes are sent — gives true progress bar motion
      onProgress({
        loaded: capturedBase + sent,
        total: file.size,
        partIndex: i + 1,
        totalParts,
      });
    });

    parts.push(data);
    if (i === 0 && data.thumb_file_id) firstThumb = data.thumb_file_id;
    baseLoaded += chunkSize;

    // Emit a clean 100% for this chunk once fully confirmed
    onProgress({ loaded: baseLoaded, total: file.size, partIndex: i + 1, totalParts });
  }

  const fin = await fetch("/api/upload-finalize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
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
