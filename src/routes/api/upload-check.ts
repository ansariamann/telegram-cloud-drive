import { createFileRoute } from "@tanstack/react-router";
import { requireUnlocked } from "@/lib/gate.server";
import { findDuplicateFile } from "@/lib/files-db.server";

export const Route = createFileRoute("/api/upload-check")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        requireUnlocked();
        try {
          const body = (await request.json()) as {
            filename: string;
            size: number;
            folder_id?: string | null;
          };

          if (!body || !body.filename || body.size === undefined) {
            return Response.json({ exists: false });
          }

          const existing = await findDuplicateFile({
            filename: body.filename,
            size_bytes: body.size,
            folder_id: body.folder_id ?? null,
          });

          if (existing) {
            return Response.json({ exists: true, file: existing, isDuplicate: true });
          }

          return Response.json({ exists: false });
        } catch (err) {
          console.error("[upload-check] Error:", err);
          return Response.json({ exists: false });
        }
      },
    },
  },
});
