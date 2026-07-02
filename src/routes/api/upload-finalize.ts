import { createFileRoute } from "@tanstack/react-router";
import { requireUnlocked } from "@/lib/gate.server";
import { insertFile } from "@/lib/files-db.server";
import { kindFromMime } from "@/lib/telegram.server";

export const Route = createFileRoute("/api/upload-finalize")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        requireUnlocked();
        const body = (await request.json()) as {
          filename: string;
          mime: string;
          size: number;
          parts: Array<{ index: number; file_id: string; message_id: number; size: number }>;
          thumb_file_id?: string | null;
        };
        const parts = [...body.parts].sort((a, b) => a.index - b.index);
        const row = await insertFile({
          filename: body.filename,
          mime: body.mime || "application/octet-stream",
          size_bytes: body.size,
          kind: kindFromMime(body.mime || ""),
          parts,
          tags: [],
          thumb_file_id: body.thumb_file_id ?? null,
        });
        return Response.json({ file: row });
      },
    },
  },
});