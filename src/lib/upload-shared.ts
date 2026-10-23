/**
 * Upload pipeline for shared folder recipients.
 *
 * Mirrors the core upload.ts logic but hits /api/shares/:token/* endpoints
 * instead of the authenticated /api/* endpoints. The share token is the
 * only credential — no vault session cookie is needed.
 */

const CHUNK_SIZE = 19 * 1024 * 1024; // 19 MB
const UPLOAD_REQUEST_TIMEOUT_MS = 120_000;
const FINALIZE_REQUEST_TIMEOUT_MS = 30_000;

export type UploadPart = {
  index: number;
  file_id: string;
  message_id: number;
  size: number;
  thumb_file_id?: string | null;
};

export type UploadPhase = "uploading" | "processing" | "finalizing";

export type UploadProgress = {
  loaded: number;
  total: number;
  partIndex: number;
  totalParts: number;
  phase: UploadPhase;
};

export class DuplicateFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateFileError";
  }
}

type FinalizeData = {
  filename: string;
  mime: string;
  size: number;
  parts: Array<{ index: number; file_id: string; message_id: number; size: number }>;
  thumb_file_id: string | null;
  folder_id?: string | null;
};

function uploadChunkXHR(
  url: string,
  form: FormData,
  signal: AbortSignal | undefined,
  onBytesSent: (sent: number, total: number) => void,
  onBytesDone: () => void,
): Promise<UploadPart> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.timeout = UPLOAD_REQUEST_TIMEOUT_MS;

    const abortHandler = () => xhr.abort();
    signal?.addEventListener("abort", abortHandler);

    let uploadComplete = false;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onBytesSent(e.loaded, e.total);
    };
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
        let msg = `HTTP ${xhr.status}: ${xhr.statusText}`;
        try {
          const parsed = JSON.parse(xhr.responseText);
          if (parsed.error) msg = parsed.error;
        } catch {
          if (xhr.responseText && xhr.responseText.length < 200) msg = xhr.responseText;
        }
        reject(new Error(msg));
      }
    };

    xhr.onerror = () => {
      signal?.removeEventListener("abort", abortHandler);
      reject(new Error(uploadComplete ? "Network error while waiting for server processing" : "Network error during upload"));
    };

    xhr.ontimeout = () => {
      signal?.removeEventListener("abort", abortHandler);
      reject(new Error("Upload timed out. Check your connection and retry."));
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

async function uploadChunk(
  url: string,
  form: FormData,
  signal: AbortSignal | undefined,
  partLabel: string,
  onBytesSent: (sent: number, total: number) => void,
  onBytesDone: () => void,
): Promise<UploadPart> {
  if (signal?.aborted) throw new Error("Upload cancelled");
  try {
    return await uploadChunkXHR(url, form, signal, onBytesSent, onBytesDone);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${partLabel} failed: ${message}`);
  }
}

async function finalizeUpload(
  url: string,
  data: FinalizeData,
  signal: AbortSignal | undefined,
): Promise<{ id: string; filename: string }> {
  if (signal?.aborted) throw new Error("Upload cancelled");
  const timeoutController = new AbortController();
  const timeout = window.setTimeout(
    () => timeoutController.abort(new Error("Saving the upload timed out")),
    FINALIZE_REQUEST_TIMEOUT_MS,
  );
  const abortFinalize = () => timeoutController.abort(signal?.reason);
  signal?.addEventListener("abort", abortFinalize, { once: true });

  let fin: Response;
  try {
    fin = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
      signal: timeoutController.signal,
    });
  } catch (error) {
    if (signal?.aborted) {
      const cancelled = new Error("Upload cancelled");
      cancelled.name = "AbortError";
      throw cancelled;
    }
    if (timeoutController.signal.aborted) throw new Error("Saving the upload timed out. Retry to finish saving it.");
    throw error;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFinalize);
  }

  if (!fin.ok) {
    const errText = await fin.text().catch(() => "");
    let isDuplicate = fin.status === 409;
    let msg = `Finalize failed: ${fin.status}${errText ? ` — ${errText}` : ""}`;
    try {
      const parsed = JSON.parse(errText);
      if (parsed.error === "DUPLICATE_FILE") {
        isDuplicate = true;
        msg = parsed.message || `File "${data.filename}" already exists in this folder`;
      }
    } catch { /* non-JSON */ }
    if (isDuplicate) throw new DuplicateFileError(msg);
    throw new Error(msg);
  }
  const result = (await fin.json()) as { file: { id: string; filename: string } };
  return result.file;
}

/**
 * Upload a file to a shared folder via token-authenticated endpoints.
 */
export async function uploadFileShared(
  token: string,
  file: File,
  onProgress: (p: UploadProgress) => void,
  folderId?: string | null,
  signal?: AbortSignal,
): Promise<{ id: string; filename: string }> {
  if (signal?.aborted) throw new Error("Upload cancelled");

  const totalParts = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
  const parts: UploadPart[] = [];
  let firstThumb: string | null = null;
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

    const capturedBase = baseLoaded;

    const data = await uploadChunk(
      `/api/shares/${token}/upload-chunk`,
      form,
      signal,
      `Part ${i + 1}/${totalParts}`,
      (sent) => {
        onProgress({
          loaded: capturedBase + sent,
          total: file.size,
          partIndex: i + 1,
          totalParts,
          phase: "uploading",
        });
      },
      () => {
        onProgress({
          loaded: capturedBase + chunkSize,
          total: file.size,
          partIndex: i + 1,
          totalParts,
          phase: "processing",
        });
      },
    );

    parts.push(data);
    if (i === 0 && data.thumb_file_id) firstThumb = data.thumb_file_id;
    baseLoaded += chunkSize;

    onProgress({
      loaded: baseLoaded,
      total: file.size,
      partIndex: i + 1,
      totalParts,
      phase: i + 1 === totalParts ? "processing" : "uploading",
    });
  }

  onProgress({
    loaded: file.size,
    total: file.size,
    partIndex: totalParts,
    totalParts,
    phase: "finalizing",
  });

  const result = await finalizeUpload(
    `/api/shares/${token}/upload-finalize`,
    {
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
      folder_id: folderId,
    },
    signal,
  );

  return result;
}
