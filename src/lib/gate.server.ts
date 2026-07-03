import { createHash, timingSafeEqual, createHmac } from "node:crypto";
import { getCookie, getRequest, setCookie } from "@tanstack/react-start/server";

const COOKIE_NAME = "tfv_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function sign(value: string): string {
  const secret = process.env.SESSION_SECRET!;
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function issueSession(): string {
  const payload = `unlocked.${Date.now()}`;
  const sig = sign(payload);
  const session = `${payload}.${sig}`;
  setCookie(COOKIE_NAME, session, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
    maxAge: MAX_AGE,
  });
  return session;
}

export function clearSession() {
  setCookie(COOKIE_NAME, "", {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
    maxAge: 0,
  });
}

export function isUnlocked(): boolean {
  const raw = getCookie(COOKIE_NAME) ?? getRequestSession();
  if (!raw) return false;
  return isValidSession(raw);
}

function getRequestSession(): string | null {
  try {
    const request = getRequest();
    const auth = request.headers.get("authorization") ?? "";
    if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
    return new URL(request.url).searchParams.get("t");
  } catch {
    return null;
  }
}

function isValidSession(raw: string): boolean {
  const idx = raw.lastIndexOf(".");
  if (idx < 0) return false;
  const payload = raw.slice(0, idx);
  const sig = raw.slice(idx + 1);
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b) && payload.startsWith("unlocked.");
}

export function requireUnlocked() {
  if (!isUnlocked()) {
    throw new Response("Locked", { status: 401 });
  }
}

export function verifyPasscode(input: string): boolean {
  const expected = process.env.APP_PASSCODE ?? "";
  if (!expected) return false;
  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}