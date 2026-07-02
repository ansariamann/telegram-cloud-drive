import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X, Download, Pencil, Trash2, Loader2, Check } from "lucide-react";
import { formatBytes, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

type FileDetail = {
  id: string;
  filename: string;
  mime: string;
  size_bytes: number;
  kind: string;
  tags: string[];
  parts: Array<{ index: number; size: number; message_id: number }>;
  created_at: string;
  updated_at: string;
};

export function FilePreview({ fileId, onClose }: { fileId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { data, isLoading } = useQuery({
    queryKey: ["file", fileId],
    queryFn: async () => {
      const res = await fetch(`/api/files/${fileId}`);
      if (!res.ok) throw new Error("Not found");
      return (await res.json()) as { file: FileDetail; token: string };
    },
  });

  const rename = useMutation({
    mutationFn: async (filename: string) => {
      const res = await fetch(`/api/files/${fileId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename }),
      });
      if (!res.ok) throw new Error("Rename failed");
    },
    onSuccess: () => {
      toast.success("Renamed");
      setRenaming(false);
      qc.invalidateQueries({ queryKey: ["file", fileId] });
      qc.invalidateQueries({ queryKey: ["files"] });
    },
    onError: () => toast.error("Rename failed"),
  });

  const del = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/files/${fileId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["files"] });
      onClose();
    },
    onError: () => toast.error("Delete failed"),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-stretch bg-background/90 backdrop-blur">
      <div className="flex flex-1 flex-col md:flex-row">
        {/* Viewer */}
        <div className="relative flex-1 flex items-center justify-center min-h-0 min-w-0 p-4 md:p-8">
          <button
            onClick={onClose}
            className="absolute top-4 left-4 h-9 w-9 rounded-md border border-border bg-card/80 flex items-center justify-center text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
          {isLoading || !data ? (
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          ) : (
            <PreviewBody file={data.file} />
          )}
        </div>

        {/* Sidebar */}
        <aside className="w-full md:w-80 border-t md:border-t-0 md:border-l border-border bg-card/80 backdrop-blur p-5 overflow-y-auto">
          {data && (
            <>
              <div className="mb-4">
                {renaming ? (
                  <div className="flex gap-1.5">
                    <Input
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      className="h-8 text-sm"
                      autoFocus
                    />
                    <Button
                      size="sm"
                      className="h-8 px-2"
                      onClick={() => rename.mutate(newName)}
                      disabled={!newName.trim() || rename.isPending}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-start gap-1.5 group">
                    <h2 className="text-base font-semibold break-all flex-1">{data.file.filename}</h2>
                    <button
                      onClick={() => {
                        setNewName(data.file.filename);
                        setRenaming(true);
                      }}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground p-1"
                      aria-label="Rename"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                <p className="text-xs text-muted-foreground mt-1 uppercase tracking-wider">{data.file.kind}</p>
              </div>

              <dl className="space-y-3 text-xs">
                <Row label="Size" value={formatBytes(Number(data.file.size_bytes))} />
                <Row label="MIME" value={data.file.mime} mono />
                <Row label="Added" value={new Date(data.file.created_at).toLocaleString()} />
                <Row label="Parts" value={String(data.file.parts.length)} />
              </dl>

              <div className="mt-6 flex flex-col gap-2">
                <a
                  href={`/api/files/${fileId}/stream?dl=1`}
                  className="inline-flex items-center justify-center h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
                >
                  <Download className="h-4 w-4 mr-1.5" />
                  Download
                </a>
                <Button
                  variant="destructive"
                  onClick={() => {
                    if (confirm(`Delete ${data.file.filename}?`)) del.mutate();
                  }}
                  className="w-full"
                >
                  <Trash2 className="h-4 w-4 mr-1.5" />
                  Delete
                </Button>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`text-right ${mono ? "font-mono" : ""} break-all`}>{value}</dd>
    </div>
  );
}

function PreviewBody({ file }: { file: FileDetail }) {
  const src = `/api/files/${file.id}/stream`;
  if (file.kind === "image") {
    return <img src={src} alt={file.filename} className="max-h-full max-w-full object-contain rounded-md" />;
  }
  if (file.kind === "video") {
    return <video src={src} controls className="max-h-full max-w-full rounded-md bg-black" />;
  }
  if (file.kind === "audio") {
    return (
      <div className="w-full max-w-md">
        <audio src={src} controls className="w-full" />
        <p className="mt-3 text-center text-sm text-muted-foreground truncate">{file.filename}</p>
      </div>
    );
  }
  if (file.kind === "pdf") {
    return <iframe src={src} title={file.filename} className="w-full h-full min-h-[70vh] rounded-md bg-white" />;
  }
  return (
    <div className="text-center">
      <div className="h-20 w-20 mx-auto rounded-2xl bg-muted flex items-center justify-center mb-4 text-muted-foreground text-xs uppercase tracking-wider">
        {file.kind}
      </div>
      <p className="text-sm">No inline preview for this file type.</p>
      <p className="text-xs text-muted-foreground mt-1">{formatBytes(Number(file.size_bytes))}</p>
    </div>
  );
}