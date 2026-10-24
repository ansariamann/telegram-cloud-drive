export const MAX_AUTOMATIC_UPLOAD_RETRIES = 1;

export function uploadIdentityKey(file) {
  return `${file.name}\u0000${file.size}`;
}

export function splitBatchDuplicates(files) {
  const seen = new Set();
  const unique = [];
  const duplicates = [];

  for (const file of files) {
    const key = uploadIdentityKey(file);
    if (seen.has(key)) duplicates.push(file);
    else {
      seen.add(key);
      unique.push(file);
    }
  }

  return { unique, duplicates };
}

export function waitForUploadRetry(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const error = new Error("Upload cancelled");
      error.name = "AbortError";
      reject(error);
      return;
    }

    const timer = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      const error = new Error("Upload cancelled");
      error.name = "AbortError";
      reject(error);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
