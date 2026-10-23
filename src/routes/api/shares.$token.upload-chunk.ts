import { createFileRoute } from "@tanstack/react-router";
import { validateShareToken } from "@/lib/shares-db.server";
import { extractFileId, extractThumbId, sendFile } from "@/lib/telegram.server";

export const Route = createFileRoute("/api/shares/$token/upload-chunk")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const share = await validateShareToken(params.token);
        if (!share) return new Response("invalid or expired link", { status: 404 });
        if (!share.allow_upload) return new Response("uploads not allowed", { status: 403 });

        try {
          const form = await request.formData();
          const blob = form.get("blob") ?? form.get("file");
          const filename = String(form.get("filename") ?? "file");
          const mime = String(form.get("mime") ?? "application/octet-stream");
          const index = Number(form.get("index") ?? 0);
          const totalParts = Number(form.get("totalParts") ?? 1);

          if (!blob || typeof (blob as Blob).arrayBuffer !== "function") {
            return new Response(JSON.stringify({ error: "missing or invalid blob" }), {
              status: 400,
              headers: { "content-type": "application/json" },
            });
          }

          const bytes = await (blob as Blob).arrayBuffer();
          const forceDocument = totalParts > 1;
          const partName = totalParts > 1 ? `${filename}.part${String(index).padStart(4, "0")}` : filename;
          const caption = totalParts > 1 ? `${filename} (part ${index + 1}/${totalParts})` : filename;

          const res = await sendFile({
            filename: partName,
            mime,
            bytes,
            caption,
            forceDocument,
            signal: request.signal,
          });

          return Response.json({
            index,
            file_id: extractFileId(res),
            message_id: res.message_id,
            size: bytes.byteLength,
            thumb_file_id: extractThumbId(res),
          });
        } catch (err) {
          if (request.signal.aborted) return new Response(null, { status: 499 });
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[shares/upload-chunk] Error:", msg);
          return new Response(JSON.stringify({ error: msg }), {
            status: 502,
            headers: { "content-type": "application/json" },
          });
        }
      },
    },
  },
});
