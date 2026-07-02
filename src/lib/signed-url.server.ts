import { createHmac, timingSafeEqual } from "node:crypto";

function sign(payload: string): string {
  const secret = process.env.FILE_URL_SIGNING_SECRET!;
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

// token = base64url(fileId:expiresAt) . signature
export function signFileToken(fileId: string, ttlSeconds = 60 * 60): string {
  const exp = Date.now() + ttlSeconds * 1000;
  const payload = `${fileId}:${exp}`;
  const sig = sign(payload);
  return `${Buffer.from(payload).toString("base64url")}.${sig}`;
}

export function verifyFileToken(token: string, fileId: string): boolean {
  try {
    const [payloadB64, sig] = token.split(".");
    if (!payloadB64 || !sig) return false;
    const payload = Buffer.from(payloadB64, "base64url").toString("utf8");
    const expected = sign(payload);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
    const [tokFileId, expStr] = payload.split(":");
    if (tokFileId !== fileId) return false;
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || Date.now() > exp) return false;
    return true;
  } catch {
    return false;
  }
}