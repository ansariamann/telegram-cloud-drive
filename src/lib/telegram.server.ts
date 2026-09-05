const TG_API = "https://api.telegram.org";

function token() {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error("TELEGRAM_BOT_TOKEN not set");
  return t;
}
function chatId() {
  const c = process.env.TELEGRAM_CHAT_ID;
  if (!c) throw new Error("TELEGRAM_CHAT_ID not set");
  return c;
}

type TgResult<T> = {
  ok: true;
  result: T;
} | {
  ok: false;
  description: string;
  error_code: number;
  parameters?: { retry_after?: number };
};

// In-memory cache for Telegram file paths (valid for at least 1 hour on Telegram servers)
type CachedPath = { path: string; expiresAt: number };
const filePathCache = new Map<string, CachedPath>();

function getCachedFilePath(file_id: string): string | null {
  const cached = filePathCache.get(file_id);
  if (!cached) return null;
  if (Date.now() > cached.expiresAt) {
    filePathCache.delete(file_id);
    return null;
  }
  return cached.path;
}

function setCachedFilePath(file_id: string, path: string): void {
  filePathCache.set(file_id, {
    path,
    expiresAt: Date.now() + 45 * 60 * 1000, // 45 minutes TTL
  });
  if (filePathCache.size > 5000) {
    const firstKey = filePathCache.keys().next().value;
    if (firstKey) filePathCache.delete(firstKey);
  }
}

export function invalidateFilePathCache(file_id: string): void {
  filePathCache.delete(file_id);
}

const CALL_MAX_RETRIES = 4;

async function call<T>(
  method: string,
  form: FormData | Record<string, unknown>,
  attempt = 0,
): Promise<T> {
  const url = `${TG_API}/bot${token()}/${method}`;
  const init: RequestInit =
    form instanceof FormData
      ? { method: "POST", body: form }
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(form),
        };

  try {
    const res = await fetch(url, init);
    const json = (await res.json()) as TgResult<T>;
    if (!json.ok) {
      // Handle rate limits (429)
      if (json.error_code === 429 && attempt < CALL_MAX_RETRIES) {
        const retryAfter = (json.parameters?.retry_after ?? 2) * 1000 + Math.random() * 500;
        await new Promise((r) => setTimeout(r, retryAfter));
        return call<T>(method, form, attempt + 1);
      }
      // Handle transient server errors (500, 502, 503, 504)
      if (res.status >= 500 && attempt < CALL_MAX_RETRIES) {
        const backoff = 1000 * Math.pow(2, attempt) + Math.random() * 500;
        await new Promise((r) => setTimeout(r, backoff));
        return call<T>(method, form, attempt + 1);
      }
      throw new Error(`Telegram ${method} failed: ${json.description}`);
    }
    return json.result;
  } catch (err) {
    if (attempt < CALL_MAX_RETRIES && !(err instanceof Error && err.message.startsWith("Telegram "))) {
      const backoff = 1000 * Math.pow(2, attempt) + Math.random() * 500;
      await new Promise((r) => setTimeout(r, backoff));
      return call<T>(method, form, attempt + 1);
    }
    throw err;
  }
}

export type TgDocument = {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  mime_type?: string;
  thumb?: { file_id: string };
  thumbnail?: { file_id: string };
};

export type SendResult = {
  message_id: number;
  document?: TgDocument;
  photo?: Array<{ file_id: string; width: number; height: number }>;
  video?: TgDocument & { width: number; height: number; duration: number };
  audio?: TgDocument & { duration: number };
};

function pickSendMethod(mime: string): "sendPhoto" | "sendVideo" | "sendAudio" | "sendDocument" {
  if (mime.startsWith("image/") && mime !== "image/gif" && mime !== "image/svg+xml") return "sendPhoto";
  if (mime.startsWith("video/")) return "sendVideo";
  if (mime.startsWith("audio/")) return "sendAudio";
  return "sendDocument";
}

export async function sendFile(opts: {
  filename: string;
  mime: string;
  bytes: ArrayBuffer;
  caption?: string;
  forceDocument?: boolean;
}): Promise<SendResult> {
  const method = opts.forceDocument ? "sendDocument" : pickSendMethod(opts.mime);
  const fieldName =
    method === "sendPhoto" ? "photo" : method === "sendVideo" ? "video" : method === "sendAudio" ? "audio" : "document";
  const fd = new FormData();
  fd.set("chat_id", chatId());
  if (opts.caption) fd.set("caption", opts.caption);
  fd.set(fieldName, new Blob([opts.bytes], { type: opts.mime }), opts.filename);
  return call<SendResult>(method, fd);
}

export function extractThumbId(r: SendResult): string | null {
  if (r.photo && r.photo.length) {
    // pick smallest for thumb (last is largest)
    return r.photo[0].file_id;
  }
  const doc = r.document ?? r.video ?? r.audio;
  return doc?.thumbnail?.file_id ?? doc?.thumb?.file_id ?? null;
}

export function extractFileId(r: SendResult): string {
  if (r.photo && r.photo.length) return r.photo[r.photo.length - 1].file_id;
  const doc = r.document ?? r.video ?? r.audio;
  if (!doc) throw new Error("No file in send result");
  return doc.file_id;
}

export async function getFilePath(file_id: string, forceFresh = false): Promise<string> {
  if (!forceFresh) {
    const cached = getCachedFilePath(file_id);
    if (cached) return cached;
  }
  const res = await call<{ file_path: string; file_size?: number }>("getFile", { file_id });
  setCachedFilePath(file_id, res.file_path);
  return res.file_path;
}

const FETCH_MAX_RETRIES = 3;

export async function fetchTelegramFile(
  file_id: string,
  headersInit?: HeadersInit,
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < FETCH_MAX_RETRIES; attempt++) {
    try {
      const path = await getFilePath(file_id, attempt > 0);
      const url = `${TG_API}/file/bot${token()}/${path}`;
      const res = await fetch(url, { headers: headersInit });

      if (res.ok) {
        return res;
      }

      // If Telegram returned 404, the path might have expired; invalidate cache
      if (res.status === 404) {
        invalidateFilePathCache(file_id);
      }

      // If rate-limited (429) or gateway error (502/503/504)
      if (res.status === 429 || res.status >= 500) {
        const delay = (attempt + 1) * 1500 + Math.random() * 500;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      throw new Error(`Failed to fetch file from Telegram: ${res.status} ${res.statusText}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < FETCH_MAX_RETRIES - 1) {
        const delay = (attempt + 1) * 1200 + Math.random() * 500;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastError ?? new Error(`Failed to fetch file ${file_id} after ${FETCH_MAX_RETRIES} attempts`);
}

export async function deleteMessage(message_id: number): Promise<void> {
  try {
    await call<boolean>("deleteMessage", { chat_id: chatId(), message_id });
  } catch {
    // best-effort; ignore
  }
}

export async function getUpdates(): Promise<
  Array<{ update_id: number; message?: { chat: { id: number; title?: string; type: string } } }>
> {
  return call("getUpdates", { limit: 20, timeout: 0 });
}

export function kindFromMime(mime: string): "image" | "video" | "audio" | "pdf" | "archive" | "other" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  if (
    mime.includes("zip") ||
    mime.includes("rar") ||
    mime.includes("7z") ||
    mime.includes("tar") ||
    mime.includes("gzip")
  )
    return "archive";
  return "other";
}