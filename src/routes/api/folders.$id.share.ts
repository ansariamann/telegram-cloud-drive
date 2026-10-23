import { createFileRoute } from "@tanstack/react-router";
import { requireUnlocked } from "@/lib/gate.server";
import { getFolder } from "@/lib/folders-db.server";
import {
  listFolderShares,
  createFolderShare,
  revokeFolderShare,
  getFolderShare,
} from "@/lib/shares-db.server";

export const Route = createFileRoute("/api/folders/$id/share")({
  server: {
    handlers: {
      /** List active shares for a folder */
      GET: async ({ params }) => {
        requireUnlocked();
        try {
          const folder = await getFolder(params.id);
          if (!folder) return Response.json({ error: "Folder not found" }, { status: 404 });
          const shares = await listFolderShares(params.id);
          return Response.json({ shares });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[folders.share.GET]", err);
          return Response.json({ error: msg }, { status: 500 });
        }
      },
      /** Create a new share link */
      POST: async ({ params, request }) => {
        requireUnlocked();
        try {
          const folder = await getFolder(params.id);
          if (!folder) return Response.json({ error: "Folder not found" }, { status: 404 });
          const body = (await request.json().catch(() => ({}))) as {
            label?: string;
            allow_upload?: boolean;
            allow_download?: boolean;
            expires_in?: string; // "never" | "24h" | "7d" | "30d"
          };
          let expiresAt: string | null = null;
          if (body.expires_in && body.expires_in !== "never") {
            const now = Date.now();
            const durations: Record<string, number> = {
              "24h": 24 * 60 * 60 * 1000,
              "7d": 7 * 24 * 60 * 60 * 1000,
              "30d": 30 * 24 * 60 * 60 * 1000,
            };
            const ms = durations[body.expires_in];
            if (ms) expiresAt = new Date(now + ms).toISOString();
          }
          const share = await createFolderShare({
            folderId: params.id,
            label: body.label,
            allowUpload: body.allow_upload,
            allowDownload: body.allow_download,
            expiresAt,
          });
          return Response.json({ share });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[folders.share.POST]", err);
          return Response.json({ error: msg }, { status: 500 });
        }
      },
      /** Revoke a share link (pass shareId in query param) */
      DELETE: async ({ params, request }) => {
        requireUnlocked();
        try {
          const url = new URL(request.url);
          const shareId = url.searchParams.get("shareId");
          if (!shareId) return Response.json({ error: "shareId required" }, { status: 400 });
          const share = await getFolderShare(shareId);
          if (!share || share.folder_id !== params.id) {
            return Response.json({ error: "Share not found" }, { status: 404 });
          }
          await revokeFolderShare(shareId);
          return Response.json({ ok: true });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[folders.share.DELETE]", err);
          return Response.json({ error: msg }, { status: 500 });
        }
      },
    },
  },
});
