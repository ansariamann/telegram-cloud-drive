import { createFileRoute } from "@tanstack/react-router";
import { issueSession, verifyPasscode } from "@/lib/gate.server";

export const Route = createFileRoute("/api/unlock")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as { passcode?: string };
        const passcode = typeof body.passcode === "string" ? body.passcode : "";
        if (!verifyPasscode(passcode)) {
          return Response.json({ ok: false }, { status: 401 });
        }
        issueSession();
        return Response.json({ ok: true });
      },
    },
  },
});
