import { createFileRoute } from "@tanstack/react-router";
import { getFile } from "@/lib/files-db.server";
import { fetchTelegramFile } from "@/lib/telegram.server";
import { verifyFileToken } from "@/lib/signed-url.server";
import { isUnlocked } from "@/lib/gate.server";

export const Route = createFileRoute("/api/files/$id/stream")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const url = new URL(request.url);
        const token = url.searchParams.get("t");
        const authed = (token && verifyFileToken(token, params.id)) || isUnlocked();
        if (!authed) return new Response("unauthorized", { status: 401 });
        const file = await getFile(params.id);
        if (!file) return new Response("not found", { status: 404 });

        const disposition = url.searchParams.get("dl")
          ? `attachment; filename="${encodeURIComponent(file.filename)}"`
          : `inline; filename="${encodeURIComponent(file.filename)}"`;

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
            if (match[2]) {
              end = parseInt(match[2], 10);
            }
          }
        }

        if (isRange) {
          if (start < 0 || end >= totalSize || start > end) {
            return new Response(null, {
              status: 416,
              headers: {
                "Content-Range": `bytes */${totalSize}`,
                "Cache-Control": "no-cache",
              },
            });
          }
        }

        // Fast-path: Single part and not a Range request
        if (!isRange && file.parts.length === 1) {
          const upstream = await fetchTelegramFile(file.parts[0].file_id);
          return new Response(upstream.body, {
            headers: {
              "content-type": file.mime,
              "content-length": String(totalSize),
              "content-disposition": disposition,
              "cache-control": "private, max-age=600",
              "accept-ranges": "bytes",
            },
          });
        }

        const parts = [...file.parts].sort((a, b) => a.index - b.index);

        // Calculate boundary spans for each part
        let currentOffset = 0;
        const partsWithBoundaries = parts.map((p) => {
          const partStart = currentOffset;
          const partEnd = currentOffset + p.size;
          currentOffset = partEnd;
          return { ...p, partStart, partEnd };
        });

        const headers: Record<string, string> = {
          "content-type": file.mime,
          "content-disposition": disposition,
          "accept-ranges": "bytes",
        };

        if (isRange) {
          headers["content-length"] = String(end - start + 1);
          headers["content-range"] = `bytes ${start}-${end}/${totalSize}`;
        } else {
          headers["content-length"] = String(totalSize);
          headers["cache-control"] = "private, max-age=600";
        }

        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            try {
              for (const p of partsWithBoundaries) {
                // If this part does not overlap with the requested byte range, skip it
                if (p.partEnd <= start || p.partStart > end) {
                  continue;
                }

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
                    const chunkLength = chunk.length;

                    // Handle skipping initial bytes
                    if (bytesSkipped < skipBytes) {
                      const neededToSkip = skipBytes - bytesSkipped;
                      if (chunkLength <= neededToSkip) {
                        bytesSkipped += chunkLength;
                        continue;
                      } else {
                        chunk = chunk.subarray(neededToSkip);
                        bytesSkipped = skipBytes;
                      }
                    }

                    // Handle taking target bytes
                    const remainingToTake = takeBytes - bytesTaken;
                    if (chunk.length <= remainingToTake) {
                      controller.enqueue(chunk);
                      bytesTaken += chunk.length;
                    } else {
                      controller.enqueue(chunk.subarray(0, remainingToTake));
                      bytesTaken = takeBytes;
                    }

                    if (bytesTaken >= takeBytes) {
                      break; // Range satisfied for this part
                    }
                  }
                } finally {
                  reader.releaseLock();
                  // Cancel upstream stream connection to free Telegram Bot API network resources
                  try {
                    await upstream.body.cancel();
                  } catch {
                    // Ignore cancel error
                  }
                }
              }
              controller.close();
            } catch (err) {
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