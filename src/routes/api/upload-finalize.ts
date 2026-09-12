import { createFileRoute } from "@tanstack/react-router";
import { requireUnlocked } from "@/lib/gate.server";
import { insertFile, findDuplicateFile } from "@/lib/files-db.server";
import { kindFromMime } from "@/lib/telegram.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/upload-finalize")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        requireUnlocked();
        try {
          const body = (await request.json()) as {
            filename: string;
            mime: string;
            size: number;
            parts: Array<{ index: number; file_id: string; message_id: number; size: number }>;
            thumb_file_id?: string | null;
            folder_id?: string | null;
            allow_duplicate?: boolean;
          };
          const parts = [...body.parts].sort((a, b) => a.index - b.index);

          // --- Idempotency check ---
          // If a file with the same first-part message_id already exists, return it
          // instead of creating a duplicate. This handles retried finalize calls
          // after network failures.
          if (parts.length > 0) {
            const firstMessageId = parts[0].message_id;
            const { data: existing } = await supabaseAdmin
              .from("files")
              .select("*")
              .contains("parts", JSON.stringify([{ message_id: firstMessageId }]))
              .maybeSingle();
            if (existing) {
              return Response.json({ file: existing });
            }
          }

          // --- Duplicate check ---
          const folderId = body.folder_id ?? null;
          if (!body.allow_duplicate) {
            const duplicate = await findDuplicateFile(body.filename, body.size, folderId);
            if (duplicate) {
              return new Response(
                JSON.stringify({
                  error: "DUPLICATE_FILE",
                  message: `A file named "${body.filename}" (${body.size} bytes) already exists in this folder`,
                  existingFile: duplicate,
                }),
                {
                  status: 409,
                  headers: { "content-type": "application/json" },
                }
              );
            }
          }

          const row = await insertFile({
            filename: body.filename,
            mime: body.mime || "application/octet-stream",
            size_bytes: body.size,
            kind: kindFromMime(body.mime || ""),
            parts,
            tags: [],
            thumb_file_id: body.thumb_file_id ?? null,
            folder_id: body.folder_id ?? null,
          });
          return Response.json({ file: row });
        } catch (err) {
          console.error("[upload-finalize] ERROR:", err);
          if (typeof err === "object" && err !== null && "code" in err && err.code === "23505") {
            return new Response(
              JSON.stringify({
                error: "DUPLICATE_FILE",
                message: "A matching file was saved while this upload was in progress",
              }),
              { status: 409, headers: { "content-type": "application/json" } },
            );
          }
          const message = err instanceof Error ? err.message : String(err);
          return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }
      },
    },
  },
});