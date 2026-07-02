import { createFileRoute } from "@tanstack/react-router";
import { requireUnlocked } from "@/lib/gate.server";
import { extractFileId, extractThumbId, sendFile } from "@/lib/telegram.server";

export const Route = createFileRoute("/api/upload-chunk")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        requireUnlocked();
        const form = await request.formData();
        const blob = form.get("blob");
        const filename = String(form.get("filename") ?? "file");
        const mime = String(form.get("mime") ?? "application/octet-stream");
        const index = Number(form.get("index") ?? 0);
        const totalParts = Number(form.get("totalParts") ?? 1);
        if (!(blob instanceof Blob)) return new Response("missing blob", { status: 400 });
        const bytes = await blob.arrayBuffer();
        const forceDocument = totalParts > 1;
        const partName = totalParts > 1 ? `${filename}.part${String(index).padStart(4, "0")}` : filename;
        const caption = totalParts > 1 ? `${filename} (part ${index + 1}/${totalParts})` : filename;
        const res = await sendFile({ filename: partName, mime, bytes, caption, forceDocument });
        return Response.json({
          index,
          file_id: extractFileId(res),
          message_id: res.message_id,
          size: bytes.byteLength,
          thumb_file_id: extractThumbId(res),
        });
      },
    },
  },
});