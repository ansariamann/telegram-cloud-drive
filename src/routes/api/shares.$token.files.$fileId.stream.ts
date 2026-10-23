import { createFileRoute } from "@tanstack/react-router";
import { validateShareToken } from "@/lib/shares-db.server";
import { getFile } from "@/lib/files-db.server";
import { fetchTelegramFile } from "@/lib/telegram.server";
import { isFolderDescendantOf } from "@/lib/folders-db.server";

export const Route = createFileRoute("/api/shares/$token/files/$fileId/stream")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const share = await validateShareToken(params.token);
        if (!share) return new Response("invalid or expired link", { status: 404 });
        if (!share.allow_download) return new Response("downloads not allowed", { status: 403 });

        const file = await getFile(params.fileId);
        if (!file) return new Response("not found", { status: 404 });

        // Sandbox: ensure the file belongs to the shared folder or any of its subfolders
        if (!file.folder_id) return new Response("forbidden", { status: 403 });
        if (file.folder_id !== share.folder_id) {
          const isAllowed = await isFolderDescendantOf(file.folder_id, share.folder_id);
          if (!isAllowed) return new Response("forbidden", { status: 403 });
        }

        // Safe Content-Disposition
        const safeAscii = file.filename.replace(/["\\]/g, "_").replace(/[^\x20-\x7E]/g, "_");
        const encoded = encodeURIComponent(file.filename);
        const url = new URL(request.url);
        const dispositionType = url.searchParams.get("dl") ? "attachment" : "inline";
        const disposition = `${dispositionType}; filename="${safeAscii}"; filename*=UTF-8''${encoded}`;

        const totalSize = file.size_bytes;
        const rangeHeader = request.headers.get("range");

        let start = 0;
        let end = totalSize - 1;
        let isRange = false;

        if (rangeHeader) {
          const match = /^bytes=(\d+)-(\d+)?$/.exec(rangeHeader);
          if (match) {
            isRange = true;
            start = parseInt(match[1], 10);
            if (match[2]) end = parseInt(match[2], 10);
          }
        }

        if (isRange && (start < 0 || end >= totalSize || start > end)) {
          return new Response(null, {
            status: 416,
            headers: { "content-range": `bytes */${totalSize}` },
          });
        }

        // Single-part fast path
        if (file.parts.length === 1 && !isRange) {
          try {
            const upstream = await fetchTelegramFile(file.parts[0].file_id);
            return new Response(upstream.body, {
              headers: {
                "content-type": file.mime || "application/octet-stream",
                "content-length": String(totalSize),
                "content-disposition": disposition,
                "cache-control": "private, no-transform, max-age=600",
                "accept-ranges": "bytes",
                "x-content-type-options": "nosniff",
              },
            });
          } catch (err) {
            console.error(`[shares.stream] Fast-path failed for ${file.filename}:`, err);
          }
        }

        const parts = [...file.parts].sort((a, b) => a.index - b.index);

        // Calculate part boundaries
        let currentOffset = 0;
        const partsWithBoundaries = parts.map((p) => {
          const partStart = currentOffset;
          const partEnd = currentOffset + p.size;
          currentOffset = partEnd;
          return { ...p, partStart, partEnd };
        });

        const overlappingParts = partsWithBoundaries.filter(
          (p) => !(p.partEnd <= start || p.partStart > end),
        );

        const headers: Record<string, string> = {
          "content-type": file.mime || "application/octet-stream",
          "content-disposition": disposition,
          "accept-ranges": "bytes",
          "x-content-type-options": "nosniff",
        };

        if (isRange) {
          headers["content-length"] = String(end - start + 1);
          headers["content-range"] = `bytes ${start}-${end}/${totalSize}`;
        } else {
          headers["content-length"] = String(totalSize);
          headers["cache-control"] = "private, no-transform, max-age=600";
        }

        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            try {
              for (const p of overlappingParts) {
                const overlapStart = Math.max(p.partStart, start);
                const overlapEnd = Math.min(p.partEnd - 1, end);
                const skipBytes = overlapStart - p.partStart;
                const takeBytes = overlapEnd - overlapStart + 1;
                if (takeBytes <= 0) continue;

                const upstream = await fetchTelegramFile(p.file_id);
                if (!upstream.body) continue;
                const reader = upstream.body.getReader();
                let bytesSkipped = 0;
                let bytesTaken = 0;

                try {
                  for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (!value) continue;
                    let chunk = value;

                    if (bytesSkipped < skipBytes) {
                      const needed = skipBytes - bytesSkipped;
                      if (chunk.length <= needed) {
                        bytesSkipped += chunk.length;
                        continue;
                      }
                      chunk = chunk.subarray(needed);
                      bytesSkipped = skipBytes;
                    }

                    const remaining = takeBytes - bytesTaken;
                    if (chunk.length <= remaining) {
                      controller.enqueue(chunk);
                      bytesTaken += chunk.length;
                    } else {
                      controller.enqueue(chunk.subarray(0, remaining));
                      bytesTaken = takeBytes;
                    }
                    if (bytesTaken >= takeBytes) break;
                  }
                } finally {
                  reader.releaseLock();
                  try { await upstream.body.cancel(); } catch { /* ignore */ }
                }
              }
              controller.close();
            } catch (err) {
              console.error(`[shares.stream] Error for file ${params.fileId}:`, err);
              controller.error(err);
            }
          },
        });

        return new Response(stream, {
          status: isRange ? 206 : 200,
          headers,
        });
      },
    },
  },
});
