import { createFileRoute } from "@tanstack/react-router";
import { requireUnlocked } from "@/lib/gate.server";
import { getFile } from "@/lib/files-db.server";
import { fetchTelegramFile } from "@/lib/telegram.server";
import { Zip, ZipPassThrough } from "fflate";

export const Route = createFileRoute("/api/files/download-zip")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        requireUnlocked();

        let ids: string[];
        try {
          const body = (await request.json()) as { ids?: unknown };
          if (!Array.isArray(body.ids) || body.ids.length === 0) {
            return new Response("ids must be a non-empty array", { status: 400 });
          }
          ids = body.ids.filter((x): x is string => typeof x === "string").slice(0, 100); // max 100 files
        } catch {
          return new Response("invalid JSON body", { status: 400 });
        }

        // Fetch all file metadata in parallel
        const fileRows = (await Promise.all(ids.map((id) => getFile(id)))).filter(Boolean);
        if (fileRows.length === 0) return new Response("no files found", { status: 404 });

        // Deduplicate filenames
        const seen = new Map<string, number>();
        const safeNames = fileRows.map((f) => {
          const base = f!.filename.replace(/[\\/:*?"<>|]/g, "_");
          const count = seen.get(base) ?? 0;
          seen.set(base, count + 1);
          if (count === 0) return base;
          const dot = base.lastIndexOf(".");
          return dot > 0
            ? base.slice(0, dot) + ` (${count})` + base.slice(dot)
            : `${base} (${count})`;
        });

        // Stream a ZIP archive
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

            for (let i = 0; i < fileRows.length; i++) {
              const file = fileRows[i]!;
              const name = safeNames[i];
              const parts = [...file.parts].sort((a, b) => a.index - b.index);

              // Use ZipPassThrough (store-only, no recompression) for speed
              const entry = new ZipPassThrough(name);
              zip.add(entry);

              for (const part of parts) {
                try {
                  const upstream = await fetchTelegramFile(part.file_id);
                  if (!upstream.body) continue;
                  const reader = upstream.body.getReader();
                  for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (value) entry.push(value, false);
                  }
                } catch {
                  // Skip unreadable parts; still close the entry
                }
              }
              entry.push(new Uint8Array(0), true); // signal end of this file
            }

            zip.end();
          },
        });

        const zipName = `vault-${fileRows.length}-files.zip`;
        return new Response(stream, {
          headers: {
            "content-type": "application/zip",
            "content-disposition": `attachment; filename="${encodeURIComponent(zipName)}"`,
            "transfer-encoding": "chunked",
          },
        });
      },
    },
  },
});
