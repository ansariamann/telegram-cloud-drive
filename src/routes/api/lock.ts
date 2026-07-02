import { createFileRoute } from "@tanstack/react-router";
import { clearSession } from "@/lib/gate.server";

export const Route = createFileRoute("/api/lock")({
  server: {
    handlers: {
      POST: async () => {
        clearSession();
        return Response.json({ ok: true });
      },
    },
  },
});