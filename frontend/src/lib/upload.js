/**
 * Upload pipeline — JS port of lib/upload.ts
 * Handles chunked uploads to the Spring Boot backend with progress tracking,
 * chunk caching in sessionStorage, and finalize recovery.
 */

const CHUNK_SIZE = 19 * 1024 * 1024; // 19 MB
const UPLOAD_REQUEST_TIMEOUT_MS = 120_000;
const FINALIZE_REQUEST_TIMEOUT_MS = 30_000;

export class DuplicateFileError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DuplicateFileError';
  }
}

// ─── SessionStorage chunk cache ───────────────────────────────────────────────

function chunkCacheKey(file, partIndex) {
  return `upload_chunk:${file.name}:${file.size}:${file.lastModified}:${partIndex}`;
}

function getCachedChunk(file, partIndex) {
  try {
    const raw = sessionStorage.getItem(chunkCacheKey(file, partIndex));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function setCachedChunk(file, partIndex, part) {
  try {
    sessionStorage.setItem(chunkCacheKey(file, partIndex), JSON.stringify(part));
  } catch {
    // sessionStorage full — non-critical
  }
}

function clearChunkCache(file, totalParts) {
  try {
    for (let i = 0; i < totalParts; i++) {
      sessionStorage.removeItem(chunkCacheKey(file, i));
    }
    sessionStorage.removeItem(finalizeCacheKey(file));
  } catch {
    // non-critical
  }
}

function finalizeCacheKey(file) {
  return `upload_finalize:${file.name}:${file.size}:${file.lastModified}`;
}

function cacheFinalizeData(file, data) {
  try {
    sessionStorage.setItem(finalizeCacheKey(file), JSON.stringify(data));
  } catch {
    // non-critical
  }
}

function getCachedFinalizeData(file) {
  try {
    const raw = sessionStorage.getItem(finalizeCacheKey(file));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ─── XHR upload chunk ─────────────────────────────────────────────────────────

function uploadChunkXHR(form, signal, onBytesSent, onBytesDone) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload-chunk');
    xhr.timeout = UPLOAD_REQUEST_TIMEOUT_MS;
    xhr.withCredentials = true;

    const abortHandler = () => xhr.abort();
    signal?.addEventListener('abort', abortHandler);

    let uploadComplete = false;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onBytesSent(e.loaded, e.total);
    };
    xhr.upload.onload = () => {
      uploadComplete = true;
      onBytesDone();
    };

    xhr.onload = () => {
      signal?.removeEventListener('abort', abortHandler);
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error('Invalid JSON response from server'));
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
      signal?.removeEventListener('abort', abortHandler);
      reject(new Error(uploadComplete
        ? 'Network error while waiting for server processing'
        : 'Network error during upload'));
    };

    xhr.ontimeout = () => {
      signal?.removeEventListener('abort', abortHandler);
      reject(new Error('Upload timed out. Check your connection and retry.'));
    };

    xhr.onabort = () => {
      signal?.removeEventListener('abort', abortHandler);
      const err = new Error('Upload cancelled');
      err.name = 'AbortError';
      reject(err);
    };

    xhr.send(form);
  });
}

async function uploadChunk(form, signal, partLabel, onBytesSent, onBytesDone) {
  if (signal?.aborted) throw new Error('Upload cancelled');
  try {
    return await uploadChunkXHR(form, signal, onBytesSent, onBytesDone);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${partLabel} failed: ${message}`);
  }
}

// ─── Finalize ────────────────────────────────────────────────────────────────

async function finalizeUpload(data, signal) {
  if (signal?.aborted) throw new Error('Upload cancelled');
  const timeoutController = new AbortController();
  const timeout = window.setTimeout(
    () => timeoutController.abort(new Error('Saving the upload timed out')),
    FINALIZE_REQUEST_TIMEOUT_MS,
  );
  const abortFinalize = () => timeoutController.abort(signal?.reason);
  signal?.addEventListener('abort', abortFinalize, { once: true });

  let fin;
  try {
    fin = await fetch('/api/upload-finalize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(data),
      signal: timeoutController.signal,
    });
  } catch (error) {
    if (signal?.aborted) {
      const cancelled = new Error('Upload cancelled');
      cancelled.name = 'AbortError';
      throw cancelled;
    }
    if (timeoutController.signal.aborted) throw new Error('Saving the upload timed out. Retry to finish saving it.');
    throw error;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFinalize);
  }

  if (!fin.ok) {
    const errText = await fin.text().catch(() => '');
    let isDuplicate = fin.status === 409;
    let msg = `Finalize failed: ${fin.status}${errText ? ` — ${errText}` : ''}`;
    try {
      const parsed = JSON.parse(errText);
      if (parsed.error === 'DUPLICATE_FILE') {
        isDuplicate = true;
        msg = parsed.message || `File "${data.filename}" already exists in this folder`;
      }
    } catch {
      // non-JSON
    }
    if (isDuplicate) throw new DuplicateFileError(msg);
    throw new Error(msg);
  }

  const result = await fin.json();
  return result.file;
}

// ─── Main upload function ─────────────────────────────────────────────────────

async function uploadFileOnce(file, onProgress, folderId, signal) {
  const totalParts = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
  const parts = [];
  let firstThumb = null;

  // Check if we have cached finalize data
  const cachedFinalize = getCachedFinalizeData(file);
  if (cachedFinalize) {
    onProgress({ loaded: file.size, total: file.size, partIndex: totalParts, totalParts, phase: 'finalizing' });
    try {
      const result = await finalizeUpload({ ...cachedFinalize, folder_id: folderId ?? null }, signal);
      clearChunkCache(file, totalParts);
      return result;
    } catch (err) {
      throw err;
    }
  }

  let baseLoaded = 0;

  for (let i = 0; i < totalParts; i++) {
    if (signal?.aborted) throw new Error('Upload cancelled');

    const cached = getCachedChunk(file, i);
    if (cached) {
      parts.push(cached);
      if (i === 0 && cached.thumb_file_id) firstThumb = cached.thumb_file_id;
      const chunkSize = Math.min(CHUNK_SIZE, file.size - i * CHUNK_SIZE);
      baseLoaded += chunkSize;
      onProgress({ loaded: baseLoaded, total: file.size, partIndex: i + 1, totalParts, phase: i + 1 === totalParts ? 'processing' : 'uploading' });
      continue;
    }

    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunkSize = end - start;
    const slice = file.slice(start, end);

    const form = new FormData();
    form.set('blob', slice, file.name);
    form.set('filename', file.name);
    form.set('mime', file.type || 'application/octet-stream');
    form.set('index', String(i));
    form.set('totalParts', String(totalParts));

    const capturedBase = baseLoaded;

    const data = await uploadChunk(
      form,
      signal,
      `Part ${i + 1}/${totalParts}`,
      (sent) => {
        onProgress({ loaded: capturedBase + sent, total: file.size, partIndex: i + 1, totalParts, phase: 'uploading' });
      },
      () => {
        onProgress({ loaded: capturedBase + chunkSize, total: file.size, partIndex: i + 1, totalParts, phase: 'processing' });
      },
    );

    setCachedChunk(file, i, data);
    parts.push(data);
    if (i === 0 && data.thumb_file_id) firstThumb = data.thumb_file_id;
    baseLoaded += chunkSize;

    onProgress({ loaded: baseLoaded, total: file.size, partIndex: i + 1, totalParts, phase: i + 1 === totalParts ? 'processing' : 'uploading' });
  }

  const finalizeData = {
    filename: file.name,
    mime: file.type || 'application/octet-stream',
    size: file.size,
    parts: parts.map(({ index, file_id, message_id, size }) => ({ index, file_id, message_id, size })),
    thumb_file_id: firstThumb,
    folder_id: folderId ?? null,
  };

  cacheFinalizeData(file, finalizeData);

  onProgress({ loaded: file.size, total: file.size, partIndex: totalParts, totalParts, phase: 'finalizing' });

  const result = await finalizeUpload(finalizeData, signal);
  clearChunkCache(file, totalParts);
  return result;
}

export async function uploadFile(file, onProgress, folderId, signal) {
  if (signal?.aborted) throw new Error('Upload cancelled');
  return uploadFileOnce(file, onProgress, folderId, signal);
}

export async function retryFinalizeOnly(file, folderId, signal) {
  const cached = getCachedFinalizeData(file);
  if (!cached) return null;
  const totalParts = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
  const result = await finalizeUpload({ ...cached, folder_id: folderId ?? null }, signal);
  clearChunkCache(file, totalParts);
  return result;
}

export function hasRecoverableUpload(file) {
  return getCachedFinalizeData(file) !== null;
}
