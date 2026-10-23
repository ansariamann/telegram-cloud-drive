import { createFileRoute } from "@tanstack/react-router";
import { validateShareToken } from "@/lib/shares-db.server";
import { createFolder, isFolderDescendantOf } from "@/lib/folders-db.server";
import { z } from "zod";

const schema = z.object({
  name: z.string().trim().min(1, "Folder name is required").max(100, "Folder name too long"),
  parent_id: z.string().uuid().optional().nullable(),
});

export const Route = createFileRoute("/api/shares/$token/create-folder")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const share = await validateShareToken(params.token);
        if (!share) return Response.json({ error: "Invalid or expired link" }, { status: 404 });
        if (!share.allow_upload) {
          return Response.json({ error: "Creation not permitted on this shared link" }, { status: 403 });
        }

        const body = schema.safeParse(await request.json().catch(() => null));
        if (!body.success) {
          return Response.json({ error: body.error.issues[0]?.message || "Invalid input" }, { status: 400 });
        }

        let parentId = share.folder_id;
        if (body.data.parent_id && body.data.parent_id !== share.folder_id) {
          const isDescendant = await isFolderDescendantOf(body.data.parent_id, share.folder_id);
          if (!isDescendant) {
            return Response.json({ error: "Cannot create folder outside the shared directory" }, { status: 403 });
          }
          parentId = body.data.parent_id;
        }

        try {
          const folder = await createFolder(body.data.name, parentId);
          return Response.json({ folder });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Failed to create folder";
          return Response.json({ error: msg }, { status: 500 });
        }
      },
    },
  },
});
