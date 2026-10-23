import { createFileRoute } from "@tanstack/react-router";
import { requireUnlocked } from "@/lib/gate.server";
import { getFolder } from "@/lib/folders-db.server";
import {
  listFolderShares,
  createFolderShare,
  updateFolderShare,
  revokeFolderShare,
  getFolderShare,
  getActiveFolderShare,
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
      /** Create a new share link or return/update existing active share */
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
            force_new?: boolean;
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

          // If a link is already there and not forcing a brand new link, reuse existing active share!
          if (!body.force_new) {
            const existing = await getActiveFolderShare(params.id);
            if (existing) {
              const updated = await updateFolderShare(existing.id, {
                label: body.label !== undefined ? body.label : existing.label,
                allowUpload: body.allow_upload !== undefined ? body.allow_upload : existing.allow_upload,
                allowDownload: body.allow_download !== undefined ? body.allow_download : existing.allow_download,
                expiresAt: body.expires_in !== undefined ? expiresAt : existing.expires_at,
              });
              return Response.json({ share: updated, reused: true });
            }
          }

          const share = await createFolderShare({
            folderId: params.id,
            label: body.label,
            allowUpload: body.allow_upload,
            allowDownload: body.allow_download,
            expiresAt,
          });
          return Response.json({ share, reused: false });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[folders.share.POST]", err);
          return Response.json({ error: msg }, { status: 500 });
        }
      },
      /** Update an existing share link's settings */
      PATCH: async ({ params, request }) => {
        requireUnlocked();
        try {
          const body = (await request.json().catch(() => ({}))) as {
            shareId?: string;
            label?: string;
            allow_upload?: boolean;
            allow_download?: boolean;
            expires_in?: string;
          };
          if (!body.shareId) return Response.json({ error: "shareId required" }, { status: 400 });
          const share = await getFolderShare(body.shareId);
          if (!share || share.folder_id !== params.id) {
            return Response.json({ error: "Share not found" }, { status: 404 });
          }
          let expiresAt: string | null | undefined = undefined;
          if (body.expires_in !== undefined) {
            if (body.expires_in === "never") {
              expiresAt = null;
            } else {
              const now = Date.now();
              const durations: Record<string, number> = {
                "24h": 24 * 60 * 60 * 1000,
                "7d": 7 * 24 * 60 * 60 * 1000,
                "30d": 30 * 24 * 60 * 60 * 1000,
              };
              const ms = durations[body.expires_in];
              if (ms) expiresAt = new Date(now + ms).toISOString();
            }
          }
          const updated = await updateFolderShare(body.shareId, {
            label: body.label,
            allowUpload: body.allow_upload,
            allowDownload: body.allow_download,
            expiresAt,
          });
          return Response.json({ share: updated });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[folders.share.PATCH]", err);
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
