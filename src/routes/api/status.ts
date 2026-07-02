import { createFileRoute } from "@tanstack/react-router";
import { isUnlocked } from "@/lib/gate.server";

export const Route = createFileRoute("/api/status")({
  server: {
    handlers: {
      GET: async () => Response.json({ unlocked: isUnlocked() }),
    },
  },
});