import { createFileRoute } from "@tanstack/react-router";
import { requireUnlocked } from "@/lib/gate.server";
import { deleteFileRow, getFile, updateFile } from "@/lib/files-db.server";
import { deleteMessage } from "@/lib/telegram.server";
import { signFileToken } from "@/lib/signed-url.server";

export const Route = createFileRoute("/api/files/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        requireUnlocked();
        const file = await getFile(params.id);
        if (!file) return new Response("not found", { status: 404 });
        const token = signFileToken(file.id);
        return Response.json({ file, token });
      },
      PATCH: async ({ params, request }) => {
        requireUnlocked();
        const body = (await request.json()) as { filename?: string; tags?: string[] };
        const patch: { filename?: string; tags?: string[] } = {};
        if (typeof body.filename === "string" && body.filename.trim()) patch.filename = body.filename.trim().slice(0, 255);
        if (Array.isArray(body.tags)) patch.tags = body.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 32);
        const file = await updateFile(params.id, patch);
        return Response.json({ file });
      },
      DELETE: async ({ params }) => {
        requireUnlocked();
        const file = await getFile(params.id);
        if (!file) return new Response("not found", { status: 404 });
        await Promise.all(file.parts.map((p) => deleteMessage(p.message_id)));
        await deleteFileRow(params.id);
        return Response.json({ ok: true });
      },
    },
  },
});