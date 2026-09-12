import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireUnlocked } from "@/lib/gate.server";
import { findDuplicateFile } from "@/lib/files-db.server";

const bodySchema = z.object({
  folder_id: z.string().uuid().nullable().optional(),
  files: z.array(
    z.object({
      filename: z.string().trim().min(1).max(255),
      size: z.number().int().nonnegative(),
    }),
  ).min(1).max(500),
});

export const Route = createFileRoute("/api/upload-check")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        requireUnlocked();
        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return Response.json({ error: "Invalid duplicate check" }, { status: 400 });
        }

        const folderId = parsed.data.folder_id ?? null;
        const checks = await Promise.all(
          parsed.data.files.map(async (file, index) => ({
            index,
            duplicate: Boolean(await findDuplicateFile(file.filename, file.size, folderId)),
          })),
        );

        return Response.json({
          duplicateIndexes: checks.filter((item) => item.duplicate).map((item) => item.index),
        });
      },
    },
  },
});