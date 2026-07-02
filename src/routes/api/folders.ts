import { createFileRoute } from "@tanstack/react-router";
import { requireUnlocked } from "@/lib/gate.server";
import { listFolders, createFolder } from "@/lib/folders-db.server";

export const Route = createFileRoute("/api/folders")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        requireUnlocked();
        const url = new URL(request.url);
        const parentParam = url.searchParams.get("parent_id");
        const parentId = parentParam && parentParam !== "root" ? parentParam : null;
        const folders = await listFolders(parentId);
        return Response.json({ folders });
      },
      POST: async ({ request }) => {
        requireUnlocked();
        const body = (await request.json()) as { name: string; parent_id?: string | null };
        if (!body.name?.trim()) return new Response("name required", { status: 400 });
        const folder = await createFolder(body.name.trim().slice(0, 255), body.parent_id ?? null);
        return Response.json({ folder });
      },
    },
  },
});
