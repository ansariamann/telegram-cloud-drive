const CHUNK_SIZE = 19 * 1024 * 1024; // 19 MB (Telegram Bot API download limit is 20 MB)
const MAX_RETRIES = 3;
const FINALIZE_MAX_RETRIES = 3;

export type UploadPart = {
  index: number;
  file_id: string;
  message_id: number;
  size: number;
  thumb_file_id?: string | null;
};

export type UploadPhase = 'uploading' | 'processing' | 'finalizing';

export type UploadProgress = {
  loaded: number;
  total: number;
  partIndex: number;
  totalParts: number;
  phase: UploadPhase;
};

// ---------- sessionStorage chunk cache ----------
// Key: file identity (name + size + lastModified) + chunk index
// Value: serialised UploadPart

function chunkCacheKey(file: File, partIndex: number): string {
  return `upload_chunk:${file.name}:${file.size}:${file.lastModified}:${partIndex}`;
}

function getCachedChunk(file: File, partIndex: number): UploadPart | null {
  try {
    const raw = sessionStorage.getItem(chunkCacheKey(file, partIndex));
    if (!raw) return null;
    return JSON.parse(raw) as UploadPart;
  } catch {
    return null;
  }
}

function setCachedChunk(file: File, partIndex: number, part: UploadPart): void {
  try {
    sessionStorage.setItem(chunkCacheKey(file, partIndex), JSON.stringify(part));
  } catch {
    // sessionStorage full or unavailable — non-critical
  }
}

function clearChunkCache(file: File, totalParts: number): void {
  try {
    for (let i = 0; i < totalParts; i++) {
      sessionStorage.removeItem(chunkCacheKey(file, i));
    }
    // Also clear the finalize recovery data
    sessionStorage.removeItem(finalizeCacheKey(file));
  } catch {
    // non-critical
  }
}

// Cache key for finalize recovery data (all parts + metadata)
function finalizeCacheKey(file: File): string {
  return `upload_finalize:${file.name}:${file.size}:${file.lastModified}`;
}

type FinalizeData = {
  filename: string;
  mime: string;
  size: number;
  parts: Array<{ index: number; file_id: string; message_id: number; size: number }>;
  thumb_file_id: string | null;
  folder_id: string | null;
};

function cacheFinalizeData(file: File, data: FinalizeData): void {
  try {
    sessionStorage.setItem(finalizeCacheKey(file), JSON.stringify(data));
  } catch {
    // non-critical
  }
}

function getCachedFinalizeData(file: File): FinalizeData | null {
  try {
    const raw = sessionStorage.getItem(finalizeCacheKey(file));
    if (!raw) return null;
    return JSON.parse(raw) as FinalizeData;
  } catch {
    return null;
  }
}

/**
 * Upload a single chunk via XHR so we get real byte-level upload progress events.
 * Falls back gracefully if XHR is unavailable (SSR context).
 */
function uploadChunkXHR(
  form: FormData,
  signal: AbortSignal | undefined,
  onBytesSent: (sent: number, total: number) => void,
  onBytesDone: () => void,
): Promise<UploadPart> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload-chunk");

    xhr.withCredentials = true;

    // Abort support
    const abortHandler = () => xhr.abort();
    signal?.addEventListener("abort", abortHandler);

    // Real byte-level upload progress
    let uploadComplete = false;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onBytesSent(e.loaded, e.total);
    };

    // Fires when all bytes have left the browser → now waiting for server
    xhr.upload.onload = () => {
      uploadComplete = true;
      onBytesDone();
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
      // If bytes were fully sent but the response failed, it's a processing error
      if (uploadComplete) {
        reject(new Error("Network error while waiting for server processing"));
      } else {
        reject(new Error("Network error during upload"));
      }
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
  onBytesDone: () => void,
): Promise<UploadPart> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (signal?.aborted) throw new Error("Upload cancelled");
    try {
      return await uploadChunkXHR(form, signal, onBytesSent, onBytesDone);
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

/**
 * Finalize upload with retry + exponential backoff.
 */
async function finalizeWithRetry(
  data: FinalizeData,
  signal: AbortSignal | undefined,
): Promise<{ id: string; filename: string }> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < FINALIZE_MAX_RETRIES; attempt++) {
    if (signal?.aborted) throw new Error("Upload cancelled");
    try {
      const fin = await fetch("/api/upload-finalize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
        signal,
      });
      if (!fin.ok) {
        const errBody = await fin.text().catch(() => "");
        throw new Error(`Finalize failed: ${fin.status}${errBody ? ` — ${errBody}` : ""}`);
      }
      const j = (await fin.json()) as { file: { id: string; filename: string } };
      return j.file;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < FINALIZE_MAX_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
      }
    }
  }
  throw lastError ?? new Error(`Finalize failed after ${FINALIZE_MAX_RETRIES} attempts`);
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

  // Check if we have cached finalize data (all chunks uploaded, finalize failed previously)
  const cachedFinalize = getCachedFinalizeData(file);
  if (cachedFinalize) {
    // All chunks were previously uploaded successfully — skip straight to finalize
    onProgress({
      loaded: file.size,
      total: file.size,
      partIndex: totalParts,
      totalParts,
      phase: 'finalizing',
    });
    try {
      const result = await finalizeWithRetry(
        { ...cachedFinalize, folder_id: folderId ?? null },
        signal,
      );
      clearChunkCache(file, totalParts);
      return result;
    } catch (err) {
      // Finalize still failing — keep the cache for next retry
      throw err;
    }
  }

  // Bytes already fully uploaded (completed chunks)
  let baseLoaded = 0;

  for (let i = 0; i < totalParts; i++) {
    if (signal?.aborted) throw new Error("Upload cancelled");

    // Check chunk cache first — skip re-upload if we already have this chunk
    const cached = getCachedChunk(file, i);
    if (cached) {
      parts.push(cached);
      if (i === 0 && cached.thumb_file_id) firstThumb = cached.thumb_file_id;
      const chunkSize = Math.min(CHUNK_SIZE, file.size - i * CHUNK_SIZE);
      baseLoaded += chunkSize;
      // Emit progress for this cached chunk
      onProgress({
        loaded: baseLoaded,
        total: file.size,
        partIndex: i + 1,
        totalParts,
        phase: i + 1 === totalParts ? 'processing' : 'uploading',
      });
      continue;
    }

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

    const data = await uploadChunkWithRetry(
      form,
      signal,
      `Part ${i + 1}/${totalParts}`,
      (sent) => {
        // Fired continuously as bytes are sent — gives true progress bar motion
        onProgress({
          loaded: capturedBase + sent,
          total: file.size,
          partIndex: i + 1,
          totalParts,
          phase: 'uploading',
        });
      },
      () => {
        // All bytes left the browser — now waiting for server to process & send to Telegram
        onProgress({
          loaded: capturedBase + chunkSize,
          total: file.size,
          partIndex: i + 1,
          totalParts,
          phase: 'processing',
        });
      },
    );

    // Cache the successfully uploaded chunk
    setCachedChunk(file, i, data);

    parts.push(data);
    if (i === 0 && data.thumb_file_id) firstThumb = data.thumb_file_id;
    baseLoaded += chunkSize;

    // Emit a clean 100% for this chunk once fully confirmed
    onProgress({
      loaded: baseLoaded,
      total: file.size,
      partIndex: i + 1,
      totalParts,
      phase: i + 1 === totalParts ? 'processing' : 'uploading',
    });
  }

  // Prepare finalize data
  const finalizeData: FinalizeData = {
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
  };

  // Cache finalize data so if finalize fails, we can retry without re-uploading
  cacheFinalizeData(file, finalizeData);

  // Signal the finalizing phase
  onProgress({
    loaded: file.size,
    total: file.size,
    partIndex: totalParts,
    totalParts,
    phase: 'finalizing',
  });

  const result = await finalizeWithRetry(finalizeData, signal);

  // Success — clear all caches
  clearChunkCache(file, totalParts);

  return result;
}

/**
 * Standalone finalize retry — used when all chunks were sent but finalize failed.
 * The file-manager can call this directly for recovery without re-uploading.
 */
export async function retryFinalizeOnly(
  file: File,
  folderId?: string | null,
  signal?: AbortSignal,
): Promise<{ id: string; filename: string } | null> {
  const cached = getCachedFinalizeData(file);
  if (!cached) return null; // No cached data — can't recover
  const totalParts = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
  const result = await finalizeWithRetry(
    { ...cached, folder_id: folderId ?? null },
    signal,
  );
  clearChunkCache(file, totalParts);
  return result;
}

/**
 * Check if a file has cached finalize data (chunks uploaded, finalize failed).
 */
export function hasRecoverableUpload(file: File): boolean {
  return getCachedFinalizeData(file) !== null;
}
