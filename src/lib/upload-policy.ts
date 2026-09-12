export const MAX_AUTOMATIC_UPLOAD_RETRIES = 1;

export type UploadIdentity = {
  name: string;
  size: number;
};

export function uploadIdentityKey(file: UploadIdentity): string {
  return `${file.name}\u0000${file.size}`;
}

export function splitBatchDuplicates<T extends UploadIdentity>(files: T[]): {
  unique: T[];
  duplicates: T[];
} {
  const seen = new Set<string>();
  const unique: T[] = [];
  const duplicates: T[] = [];

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

export function waitForUploadRetry(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      const error = new Error("Upload cancelled");
      error.name = "AbortError";
      reject(error);
      return;
    }

    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      const error = new Error("Upload cancelled");
      error.name = "AbortError";
      reject(error);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}