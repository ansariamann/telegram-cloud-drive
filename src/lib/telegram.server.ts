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

type TgResult<T> = { ok: true; result: T } | { ok: false; description: string; error_code: number };

async function call<T>(method: string, form: FormData | Record<string, unknown>): Promise<T> {
  const url = `${TG_API}/bot${token()}/${method}`;
  const init: RequestInit =
    form instanceof FormData
      ? { method: "POST", body: form }
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(form),
        };
  const res = await fetch(url, init);
  const json = (await res.json()) as TgResult<T>;
  if (!json.ok) {
    throw new Error(`Telegram ${method} failed: ${json.description}`);
  }
  return json.result;
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

export async function getFilePath(file_id: string): Promise<string> {
  const res = await call<{ file_path: string; file_size?: number }>("getFile", { file_id });
  return res.file_path;
}

export async function fetchTelegramFile(file_id: string): Promise<Response> {
  const path = await getFilePath(file_id);
  const url = `${TG_API}/file/bot${token()}/${path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch file: ${res.status}`);
  return res;
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