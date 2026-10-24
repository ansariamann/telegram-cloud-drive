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
        // Allowlist content-type to safe image types only to prevent content-sniffing attacks
        const SAFE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
        const upstreamType = upstream.headers.get("content-type") ?? "";
        const contentType = SAFE_IMAGE_TYPES.includes(upstreamType) ? upstreamType : "image/jpeg";
        return new Response(upstream.body, {
          headers: {
            "content-type": contentType,
            "cache-control": "private, max-age=3600",
            "x-content-type-options": "nosniff",
          },
        });
      },
    },
  },
});