import { createFileRoute } from "@tanstack/react-router";
import { validateShareToken } from "@/lib/shares-db.server";
import { getFile } from "@/lib/files-db.server";
import { fetchTelegramFile } from "@/lib/telegram.server";
import { isFolderDescendantOf } from "@/lib/folders-db.server";

export const Route = createFileRoute("/api/shares/$token/files/$fileId/thumb")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const share = await validateShareToken(params.token);
        if (!share) return new Response("invalid or expired link", { status: 404 });

        const file = await getFile(params.fileId);
        if (!file || !file.thumb_file_id) return new Response("no thumb", { status: 404 });

        // Sandbox: ensure file belongs to shared folder or any of its subfolders
        if (!file.folder_id) return new Response("forbidden", { status: 403 });
        if (file.folder_id !== share.folder_id) {
          const isAllowed = await isFolderDescendantOf(file.folder_id, share.folder_id);
          if (!isAllowed) return new Response("forbidden", { status: 403 });
        }

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
