import { createFileRoute } from "@tanstack/react-router";
import { requireUnlocked } from "@/lib/gate.server";
import { getFile } from "@/lib/files-db.server";
import { fetchTelegramFile } from "@/lib/telegram.server";

export const Route = createFileRoute("/api/files/$id/thumb")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        requireUnlocked();
        const file = await getFile(params.id);
        if (!file || !file.thumb_file_id) return new Response("no thumb", { status: 404 });
        const upstream = await fetchTelegramFile(file.thumb_file_id);
        return new Response(upstream.body, {
          headers: {
            "content-type": upstream.headers.get("content-type") ?? "image/jpeg",
            "cache-control": "private, max-age=3600",
          },
        });
      },
    },
  },
});