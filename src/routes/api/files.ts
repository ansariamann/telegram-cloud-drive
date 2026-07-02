import { createFileRoute } from "@tanstack/react-router";
import { requireUnlocked } from "@/lib/gate.server";
import { listFiles } from "@/lib/files-db.server";

export const Route = createFileRoute("/api/files")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        requireUnlocked();
        const url = new URL(request.url);
        const files = await listFiles({
          q: url.searchParams.get("q") ?? undefined,
          kind: url.searchParams.get("kind") ?? undefined,
          sort: (url.searchParams.get("sort") as never) ?? undefined,
        });
        return Response.json({ files });
      },
    },
  },
});