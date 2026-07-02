import { createFileRoute } from "@tanstack/react-router";
import { requireUnlocked } from "@/lib/gate.server";
import { getUpdates } from "@/lib/telegram.server";

export const Route = createFileRoute("/api/whoami")({
  server: {
    handlers: {
      GET: async () => {
        requireUnlocked();
        const updates = await getUpdates();
        const chats = new Map<number, { id: number; title: string; type: string }>();
        for (const u of updates) {
          const c = u.message?.chat;
          if (c) chats.set(c.id, { id: c.id, title: c.title ?? "(private)", type: c.type });
        }
        return Response.json({ chats: Array.from(chats.values()) });
      },
    },
  },
});