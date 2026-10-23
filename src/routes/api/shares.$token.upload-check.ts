import { createFileRoute } from "@tanstack/react-router";
import { validateShareToken } from "@/lib/shares-db.server";
import { findDuplicateFile } from "@/lib/files-db.server";
import { isFolderDescendantOf } from "@/lib/folders-db.server";
import { z } from "zod";

const bodySchema = z.object({
  folder_id: z.string().uuid().optional().nullable(),
  files: z
    .array(
      z.object({
        filename: z.string().trim().min(1).max(255),
        size: z.number().int().nonnegative(),
      }),
    )
    .min(1)
    .max(500),
});

export const Route = createFileRoute("/api/shares/$token/upload-check")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const share = await validateShareToken(params.token);
        if (!share) return new Response("invalid or expired link", { status: 404 });
        if (!share.allow_upload) return new Response("uploads not allowed", { status: 403 });

        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return Response.json({ error: "Invalid duplicate check" }, { status: 400 });
        }

        let folderId = share.folder_id;
        if (parsed.data.folder_id && parsed.data.folder_id !== share.folder_id) {
          const isDescendant = await isFolderDescendantOf(parsed.data.folder_id, share.folder_id);
          if (isDescendant) {
            folderId = parsed.data.folder_id;
          }
        }

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
