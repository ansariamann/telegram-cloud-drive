import { createFileRoute } from "@tanstack/react-router";
import { requireUnlocked } from "@/lib/gate.server";
import { getFile } from "@/lib/files-db.server";
import { signFileToken } from "@/lib/signed-url.server";

export const Route = createFileRoute("/api/files/$id/link")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        requireUnlocked();
        const file = await getFile(params.id);
        if (!file) return new Response("not found", { status: 404 });
        const token = signFileToken(params.id, 60 * 60);
        return Response.json({
          filename: file.filename,
          url: `/api/files/${params.id}/stream?dl=1&t=${encodeURIComponent(token)}`,
        });
      },
    },
  },
});
