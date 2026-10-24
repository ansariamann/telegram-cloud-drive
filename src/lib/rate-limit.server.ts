/**
 * In-memory sliding-window rate limiter.
 * Used to prevent brute-force attacks on the /api/unlock endpoint.
 *
 * Limits: MAX_ATTEMPTS attempts per WINDOW_MS milliseconds per key (e.g. IP).
 */

const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

type Record = { timestamps: number[] };
const store = new Map<string, Record>();

/** Periodically clean up stale keys to prevent unbounded memory growth. */
function evict() {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [key, rec] of store) {
    rec.timestamps = rec.timestamps.filter((t) => t > cutoff);
    if (rec.timestamps.length === 0) store.delete(key);
  }
}

// Run eviction every 5 minutes
setInterval(evict, 5 * 60 * 1000).unref?.();

/**
 * Returns true if the key is within the allowed limit.
 * Calling this also records the current attempt.
 */
export function checkRateLimit(key: string): { allowed: boolean; remaining: number; resetMs: number } {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;

  let rec = store.get(key);
  if (!rec) {
    rec = { timestamps: [] };
    store.set(key, rec);
  }

  // Slide window: drop old timestamps
  rec.timestamps = rec.timestamps.filter((t) => t > cutoff);

  if (rec.timestamps.length >= MAX_ATTEMPTS) {
    const oldest = rec.timestamps[0];
    const resetMs = oldest + WINDOW_MS - now;
    return { allowed: false, remaining: 0, resetMs };
  }

  // Record this attempt
  rec.timestamps.push(now);
  const remaining = MAX_ATTEMPTS - rec.timestamps.length;
  return { allowed: true, remaining, resetMs: 0 };
}

/**
 * Extract a best-effort client IP from an incoming Request.
 * Falls back to "unknown" when running outside a real HTTP context.
 */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}
