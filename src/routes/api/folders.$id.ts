import { createFileRoute } from "@tanstack/react-router";
import { requireUnlocked } from "@/lib/gate.server";
import { getFolder, getFolderBreadcrumbs, renameFolder, deleteFolder } from "@/lib/folders-db.server";

export const Route = createFileRoute("/api/folders/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        requireUnlocked();
        const folder = await getFolder(params.id);
        if (!folder) return new Response("not found", { status: 404 });
        const breadcrumbs = await getFolderBreadcrumbs(params.id);
        return Response.json({ folder, breadcrumbs });
      },
      PATCH: async ({ params, request }) => {
        requireUnlocked();
        const body = (await request.json()) as { name?: string };
        if (!body.name?.trim()) return new Response("name required", { status: 400 });
        const folder = await renameFolder(params.id, body.name.trim().slice(0, 255));
        return Response.json({ folder });
      },
      DELETE: async ({ params }) => {
        requireUnlocked();
        const folder = await getFolder(params.id);
        if (!folder) return new Response("not found", { status: 404 });
        await deleteFolder(params.id);
        return Response.json({ ok: true });
      },
    },
  },
});
