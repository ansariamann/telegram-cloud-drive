import { createFileRoute } from "@tanstack/react-router";
import { requireUnlocked } from "@/lib/gate.server";
import { listFiles } from "@/lib/files-db.server";

export const Route = createFileRoute("/api/files")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        requireUnlocked();
        const url = new URL(request.url);
        const q = url.searchParams.get("q") ?? undefined;
        const folderParam = url.searchParams.get("folder_id");
        // When searching, don't filter by folder (search across all)
        const folderId = q ? undefined : (!folderParam || folderParam === "root" ? null : folderParam);
        const files = await listFiles({
          q,
          kind: url.searchParams.get("kind") ?? undefined,
          sort: (url.searchParams.get("sort") as never) ?? undefined,
          folderId,
        });
        return Response.json({ files });
      },
    },
  },
});