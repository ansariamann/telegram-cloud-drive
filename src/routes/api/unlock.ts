import { createFileRoute } from "@tanstack/react-router";
import { issueSession, verifyPasscode } from "@/lib/gate.server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit.server";

export const Route = createFileRoute("/api/unlock")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Rate-limit by IP to prevent brute-force passcode guessing
        const ip = getClientIp(request);
        const rl = checkRateLimit(`unlock:${ip}`);
        if (!rl.allowed) {
          const retryAfterSec = Math.ceil(rl.resetMs / 1000);
          return Response.json(
            { ok: false, error: "Too many attempts. Try again later." },
            {
              status: 429,
              headers: {
                "Retry-After": String(retryAfterSec),
                "X-RateLimit-Limit": "10",
                "X-RateLimit-Remaining": "0",
              },
            },
          );
        }

        const body = (await request.json().catch(() => ({}))) as { passcode?: string };
        const passcode = typeof body.passcode === "string" ? body.passcode : "";
        if (!verifyPasscode(passcode)) {
          return Response.json(
            { ok: false, remaining: rl.remaining },
            { status: 401 },
          );
        }
        issueSession();
        return Response.json({ ok: true });
      },
    },
  },
});
