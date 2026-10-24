import { createFileRoute } from "@tanstack/react-router";
import { validateShareToken } from "@/lib/shares-db.server";
import { getFile, listFiles, type FileRow } from "@/lib/files-db.server";
import { getFolder, listFolders, isFolderDescendantOf } from "@/lib/folders-db.server";
import { fetchTelegramFile } from "@/lib/telegram.server";
import { Zip, ZipPassThrough } from "fflate";

export const Route = createFileRoute("/api/shares/$token/download-zip")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const share = await validateShareToken(params.token);
        if (!share) return new Response("invalid or expired link", { status: 404 });
        if (!share.allow_download) {
          return new Response("downloads not allowed on this share", { status: 403 });
        }

        let ids: string[] | undefined;
        let folderId: string | undefined;

        try {
          const body = (await request.json()) as { ids?: unknown; folderId?: unknown };
          if (Array.isArray(body.ids)) {
            ids = body.ids.filter((x): x is string => typeof x === "string").slice(0, 200);
          }
          if (typeof body.folderId === "string" && body.folderId.trim()) {
            folderId = body.folderId.trim();
          }
        } catch {
          return new Response("invalid JSON body", { status: 400 });
        }

        const rootFolder = await getFolder(share.folder_id);
        if (!rootFolder) return new Response("root folder not found", { status: 404 });

        type ZipFileItem = { file: FileRow; zipPath: string };
        const itemsToZip: ZipFileItem[] = [];
        let zipArchiveName = `${rootFolder.name}-files.zip`;

        if (ids && ids.length > 0) {
          // Explicit file selection
          const fetched = await Promise.all(ids.map((id) => getFile(id)));
          for (const file of fetched) {
            if (!file) continue;
            // Verify file belongs to share root or descendant
            if (!file.folder_id) continue;
            if (
              file.folder_id === share.folder_id ||
              (await isFolderDescendantOf(file.folder_id, share.folder_id))
            ) {
              itemsToZip.push({ file, zipPath: file.filename });
            }
          }
          zipArchiveName = `${rootFolder.name}-${itemsToZip.length}-files.zip`;
        } else {
          // Folder download (target folderId or default to share root)
          const targetFolderId = folderId || share.folder_id;
          if (
            targetFolderId !== share.folder_id &&
            !(await isFolderDescendantOf(targetFolderId, share.folder_id))
          ) {
            return new Response("forbidden", { status: 403 });
          }

          const targetFolder = await getFolder(targetFolderId);
          if (!targetFolder) return new Response("folder not found", { status: 404 });
          zipArchiveName = `${targetFolder.name}.zip`;

          // Collect files recursively within this folder
          const queue: { id: string; pathPrefix: string }[] = [{ id: targetFolderId, pathPrefix: "" }];
          let safetyLimit = 50;

          while (queue.length > 0 && safetyLimit-- > 0) {
            const current = queue.shift()!;
            const files = await listFiles({ folderId: current.id });
            for (const f of files) {
              const zipPath = current.pathPrefix
                ? `${current.pathPrefix}/${f.filename}`
                : f.filename;
              itemsToZip.push({ file: f, zipPath });
              if (itemsToZip.length >= 500) break; // cap at 500 files per zip
            }
            if (itemsToZip.length >= 500) break;

            const subfolders = await listFolders(current.id);
            for (const sub of subfolders) {
              const prefix = current.pathPrefix ? `${current.pathPrefix}/${sub.name}` : sub.name;
              queue.push({ id: sub.id, pathPrefix: prefix });
            }
          }
        }

        if (itemsToZip.length === 0) {
          return new Response("no downloadable files found", { status: 404 });
        }

        // Deduplicate paths in the zip
        const seenPaths = new Map<string, number>();
        const safeZipPaths = itemsToZip.map((item) => {
          const parts = item.zipPath.split("/");
          const baseName = parts[parts.length - 1]
            .replace(/\.\.([\/\\]|$)/g, "_")  // strip ../  ..\  or trailing ..
            .replace(/^[\/\\]+/, "")           // strip leading slashes
            .replace(/[\\/:*?"<>|]/g, "_");   // sanitize illegal filename chars
          const dirPath = parts.slice(0, -1).join("/");
          const fullKey = dirPath ? `${dirPath}/${baseName}` : baseName;

          const count = seenPaths.get(fullKey) ?? 0;
          seenPaths.set(fullKey, count + 1);

          if (count === 0) return fullKey;

          const dot = baseName.lastIndexOf(".");
          const dedupedName =
            dot > 0
              ? baseName.slice(0, dot) + ` (${count})` + baseName.slice(dot)
              : `${baseName} (${count})`;

          return dirPath ? `${dirPath}/${dedupedName}` : dedupedName;
        });

        // Stream ZIP archive via fflate
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const zip = new Zip((err, data, final) => {
              if (err) {
                controller.error(err);
                return;
              }
              controller.enqueue(data);
              if (final) controller.close();
            });

            for (let i = 0; i < itemsToZip.length; i++) {
              const { file } = itemsToZip[i];
              const entryPath = safeZipPaths[i];
              const parts = [...file.parts].sort((a, b) => a.index - b.index);

              // Use ZipPassThrough (store-only, no recompression) for speed
              const entry = new ZipPassThrough(entryPath);
              zip.add(entry);

              for (const part of parts) {
                let partSuccess = false;
                for (let attempt = 0; attempt < 3; attempt++) {
                  try {
                    const upstream = await fetchTelegramFile(part.file_id);
                    if (!upstream.body) break;
                    const reader = upstream.body.getReader();
                    try {
                      for (;;) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        if (value) entry.push(value, false);
                      }
                      partSuccess = true;
                      break;
                    } finally {
                      reader.releaseLock();
                    }
                  } catch {
                    if (attempt < 2) {
                      await new Promise((r) => setTimeout(r, (attempt + 1) * 1000));
                    }
                  }
                }
                if (!partSuccess) {
                  console.warn(
                    `[shared-download-zip] Could not stream part ${part.index} of ${file.filename}`,
                  );
                }
              }
              entry.push(new Uint8Array(0), true); // end of file entry
            }

            zip.end();
          },
        });

        const safeZipName = zipArchiveName.replace(/["\\]/g, "_");
        return new Response(stream, {
          headers: {
            "content-type": "application/zip",
            "content-disposition": `attachment; filename="${safeZipName}"; filename*=UTF-8''${encodeURIComponent(zipArchiveName)}`,
            "transfer-encoding": "chunked",
            "x-content-type-options": "nosniff",
          },
        });
      },
    },
  },
});
