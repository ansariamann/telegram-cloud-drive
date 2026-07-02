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

        if (file.parts.length === 1) {
          const upstream = await fetchTelegramFile(file.parts[0].file_id);
          return new Response(upstream.body, {
            headers: {
              "content-type": file.mime,
              "content-length": String(file.size_bytes),
              "content-disposition": disposition,
              "cache-control": "private, max-age=600",
            },
          });
        }

        const parts = [...file.parts].sort((a, b) => a.index - b.index);
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            try {
              for (const p of parts) {
                const upstream = await fetchTelegramFile(p.file_id);
                if (!upstream.body) continue;
                const reader = upstream.body.getReader();
                for (;;) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  if (value) controller.enqueue(value);
                }
              }
              controller.close();
            } catch (err) {
              controller.error(err);
            }
          },
        });
        return new Response(stream, {
          headers: {
            "content-type": file.mime,
            "content-length": String(file.size_bytes),
            "content-disposition": disposition,
          },
        });
      },
    },
  },
});