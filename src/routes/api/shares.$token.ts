import { createFileRoute } from "@tanstack/react-router";
import { validateShareToken } from "@/lib/shares-db.server";
import {
  getFolder,
  listFolders,
  isFolderDescendantOf,
  getShareBreadcrumbs,
} from "@/lib/folders-db.server";
import { listFiles } from "@/lib/files-db.server";

export const Route = createFileRoute("/api/shares/$token")({
  server: {
    handlers: {
      /** Validate token & return folder info, subfolders + file list */
      GET: async ({ params, request }) => {
        const share = await validateShareToken(params.token);
        if (!share) return new Response("invalid or expired link", { status: 404 });
        const rootFolder = await getFolder(share.folder_id);
        if (!rootFolder) return new Response("folder not found", { status: 404 });

        const url = new URL(request.url);
        const folderIdParam = url.searchParams.get("folder_id");

        let targetFolderId = share.folder_id;
        if (folderIdParam && folderIdParam !== share.folder_id) {
          const isDescendant = await isFolderDescendantOf(folderIdParam, share.folder_id);
          if (isDescendant) {
            targetFolderId = folderIdParam;
          }
        }

        const currentFolder = await getFolder(targetFolderId);
        if (!currentFolder) return new Response("folder not found", { status: 404 });

        const breadcrumbs = await getShareBreadcrumbs(targetFolderId, share.folder_id);

        const q = url.searchParams.get("q") ?? undefined;
        const kind = url.searchParams.get("kind") ?? undefined;
        const sort = (url.searchParams.get("sort") as never) ?? undefined;

        // Fetch subfolders in targetFolderId (when not searching specific types)
        const folders = !q && (!kind || kind === "all") ? await listFolders(targetFolderId) : [];

        // Fetch files in targetFolderId
        const files = await listFiles({
          q,
          kind,
          sort,
          folderId: targetFolderId,
        });

        return Response.json({
          rootFolder: { id: rootFolder.id, name: rootFolder.name },
          currentFolder: { id: currentFolder.id, name: currentFolder.name },
          folder: { id: currentFolder.id, name: currentFolder.name }, // compatibility
          breadcrumbs: breadcrumbs.map((b) => ({ id: b.id, name: b.name })),
          permissions: {
            allow_upload: share.allow_upload,
            allow_download: share.allow_download,
          },
          expires_at: share.expires_at,
          folders,
          files,
        });
      },
    },
  },
});
