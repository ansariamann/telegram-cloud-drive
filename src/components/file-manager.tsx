import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Upload,
  Search,
  LayoutGrid,
  Rows3,
  Settings as SettingsIcon,
  Image as ImageIcon,
  Film,
  Music,
  FileText,
  Archive,
  File as FileIcon,
  Download,
  Trash2,
  Eye,
  Pencil,
  X,
  Loader2,
  Filter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { formatBytes, formatDate } from "@/lib/format";
import { uploadFile, type UploadProgress } from "@/lib/upload";
import { FilePreview } from "@/components/file-preview";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";

type FileRow = {
  id: string;
  filename: string;
  mime: string;
  size_bytes: number;
  kind: string;
  tags: string[];
  thumb_file_id: string | null;
  created_at: string;
  parts: Array<{ index: number; size: number }>;
};

type KindFilter = "all" | "image" | "video" | "audio" | "pdf" | "archive" | "other";
type SortKey = "created_desc" | "created_asc" | "name_asc" | "name_desc" | "size_desc" | "size_asc";

const KIND_ORDER: Array<{ key: KindFilter; label: string; Icon: typeof ImageIcon }> = [
  { key: "all", label: "All", Icon: LayoutGrid },
  { key: "image", label: "Images", Icon: ImageIcon },
  { key: "video", label: "Video", Icon: Film },
  { key: "audio", label: "Audio", Icon: Music },
  { key: "pdf", label: "PDF", Icon: FileText },
  { key: "archive", label: "Archives", Icon: Archive },
  { key: "other", label: "Other", Icon: FileIcon },
];

function kindIcon(kind: string) {
  switch (kind) {
    case "image":
      return ImageIcon;
    case "video":
      return Film;
    case "audio":
      return Music;
    case "pdf":
      return FileText;
    case "archive":
      return Archive;
    default:
      return FileIcon;
  }
}

type Uploading = {
  id: string;
  file: File;
  progress: UploadProgress | null;
  error?: string;
  done?: boolean;
};

export function FileManager() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [sort, setSort] = useState<SortKey>("created_desc");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [uploads, setUploads] = useState<Uploading[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (kind !== "all") params.set("kind", kind);
  params.set("sort", sort);

  const filesQuery = useQuery({
    queryKey: ["files", q, kind, sort],
    queryFn: async () => {
      const res = await fetch(`/api/files?${params.toString()}`);
      if (!res.ok) throw new Error("Failed");
      const j = (await res.json()) as { files: FileRow[] };
      return j.files;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/files/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["files"] });
    },
    onError: () => toast.error("Delete failed"),
  });

  const startUpload = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        const uploadId = crypto.randomUUID();
        setUploads((u) => [...u, { id: uploadId, file, progress: null }]);
        try {
          await uploadFile(file, (p) => {
            setUploads((u) => u.map((x) => (x.id === uploadId ? { ...x, progress: p } : x)));
          });
          setUploads((u) => u.map((x) => (x.id === uploadId ? { ...x, done: true } : x)));
          toast.success(`Uploaded ${file.name}`);
          qc.invalidateQueries({ queryKey: ["files"] });
          setTimeout(() => setUploads((u) => u.filter((x) => x.id !== uploadId)), 2500);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Upload failed";
          setUploads((u) => u.map((x) => (x.id === uploadId ? { ...x, error: message } : x)));
          toast.error(`${file.name}: ${message}`);
        }
      }
    },
    [qc],
  );

  // drag & drop overlay
  const [dragActive, setDragActive] = useState(false);
  useEffect(() => {
    let counter = 0;
    function onDragEnter(e: DragEvent) {
      if (!e.dataTransfer?.types.includes("Files")) return;
      counter++;
      setDragActive(true);
    }
    function onDragLeave() {
      counter = Math.max(0, counter - 1);
      if (counter === 0) setDragActive(false);
    }
    function onDrop(e: DragEvent) {
      counter = 0;
      setDragActive(false);
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      startUpload(Array.from(e.dataTransfer.files));
    }
    function onDragOver(e: DragEvent) {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    }
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragover", onDragOver);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragover", onDragOver);
    };
  }, [startUpload]);

  const files = filesQuery.data ?? [];
  const totalSize = useMemo(() => files.reduce((n, f) => n + Number(f.size_bytes), 0), [files]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Toaster theme="dark" richColors />
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/15 text-primary">
              <Archive className="h-4 w-4" />
            </div>
            <span className="text-sm font-semibold tracking-tight">Vault</span>
          </div>

          <div className="relative ml-2 flex-1 max-w-xl">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search filenames…"
              className="pl-9 h-9"
            />
          </div>

          <div className="ml-auto flex items-center gap-2">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="h-9 rounded-md border border-border bg-input px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="created_desc">Newest</option>
              <option value="created_asc">Oldest</option>
              <option value="name_asc">Name A→Z</option>
              <option value="name_desc">Name Z→A</option>
              <option value="size_desc">Largest</option>
              <option value="size_asc">Smallest</option>
            </select>
            <div className="flex rounded-md border border-border overflow-hidden">
              <button
                onClick={() => setView("grid")}
                className={`px-2.5 h-9 flex items-center ${
                  view === "grid" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
                aria-label="Grid view"
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                onClick={() => setView("list")}
                className={`px-2.5 h-9 flex items-center border-l border-border ${
                  view === "list" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
                aria-label="List view"
              >
                <Rows3 className="h-4 w-4" />
              </button>
            </div>
            <Link
              to="/settings"
              className="h-9 w-9 flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground"
              aria-label="Settings"
            >
              <SettingsIcon className="h-4 w-4" />
            </Link>
            <Button size="sm" onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-4 w-4 mr-1.5" />
              Upload
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) startUpload(Array.from(e.target.files));
                e.target.value = "";
              }}
            />
          </div>
        </div>

        {/* Kind chips */}
        <div className="border-t border-border">
          <div className="mx-auto flex max-w-[1600px] items-center gap-1.5 overflow-x-auto px-4 sm:px-6 py-2 text-xs">
            <Filter className="h-3.5 w-3.5 text-muted-foreground mr-1 shrink-0" />
            {KIND_ORDER.map(({ key, label, Icon }) => (
              <button
                key={key}
                onClick={() => setKind(key)}
                className={`shrink-0 flex items-center gap-1.5 rounded-full px-3 py-1 border transition-colors ${
                  kind === key
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground hover:border-border"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
            <div className="ml-auto text-[11px] tabular-nums text-muted-foreground shrink-0">
              {files.length} files · {formatBytes(totalSize)}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-4 sm:px-6 py-6">
        {filesQuery.isLoading ? (
          <div className="flex items-center justify-center py-24 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading…
          </div>
        ) : files.length === 0 ? (
          <EmptyState onPick={() => fileInputRef.current?.click()} />
        ) : view === "grid" ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {files.map((f) => (
              <GridCard
                key={f.id}
                file={f}
                onOpen={() => setPreviewId(f.id)}
                onDelete={() => {
                  if (confirm(`Delete ${f.filename}?`)) deleteMutation.mutate(f.id);
                }}
              />
            ))}
          </div>
        ) : (
          <ListView
            files={files}
            onOpen={(id) => setPreviewId(id)}
            onDelete={(id, name) => {
              if (confirm(`Delete ${name}?`)) deleteMutation.mutate(id);
            }}
          />
        )}
      </main>

      {/* Upload tray */}
      {uploads.length > 0 && (
        <div className="fixed bottom-4 right-4 z-40 w-80 rounded-lg border border-border bg-card shadow-2xl overflow-hidden">
          <div className="px-3 py-2 border-b border-border flex items-center justify-between text-xs">
            <span className="font-medium">Uploads</span>
            <button
              onClick={() => setUploads((u) => u.filter((x) => !x.done && !x.error))}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Clear"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <ul className="max-h-72 overflow-y-auto divide-y divide-border">
            {uploads.map((u) => {
              const pct = u.progress ? Math.round((u.progress.loaded / u.progress.total) * 100) : 0;
              return (
                <li key={u.id} className="px-3 py-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="truncate flex-1">{u.file.name}</span>
                    <span className="tabular-nums text-muted-foreground">{formatBytes(u.file.size)}</span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <Progress value={u.done ? 100 : pct} className="h-1 flex-1" />
                    <span className="tabular-nums text-[10px] w-8 text-right text-muted-foreground">
                      {u.error ? "err" : u.done ? "100%" : `${pct}%`}
                    </span>
                  </div>
                  {u.progress && u.progress.totalParts > 1 && !u.done && !u.error && (
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      Part {u.progress.partIndex}/{u.progress.totalParts}
                    </div>
                  )}
                  {u.error && <div className="mt-1 text-[10px] text-destructive">{u.error}</div>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Drag overlay */}
      {dragActive && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur pointer-events-none">
          <div className="rounded-2xl border-2 border-dashed border-primary px-16 py-12 text-center">
            <Upload className="h-10 w-10 mx-auto text-primary mb-3" />
            <p className="text-lg font-semibold">Drop to upload</p>
            <p className="text-xs text-muted-foreground mt-1">Any file, any size (auto-chunked)</p>
          </div>
        </div>
      )}

      {previewId && <FilePreview fileId={previewId} onClose={() => setPreviewId(null)} />}
    </div>
  );
}

function EmptyState({ onPick }: { onPick: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="h-14 w-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-4">
        <Upload className="h-6 w-6" />
      </div>
      <h2 className="text-lg font-semibold">Vault is empty</h2>
      <p className="text-sm text-muted-foreground mt-1 max-w-sm">
        Drop files anywhere on this page, or click Upload. Everything goes into your private Telegram group.
      </p>
      <Button className="mt-5" onClick={onPick}>
        <Upload className="h-4 w-4 mr-1.5" />
        Choose files
      </Button>
    </div>
  );
}

function GridCard({
  file,
  onOpen,
  onDelete,
}: {
  file: FileRow;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const Icon = kindIcon(file.kind);
  const hasThumb = !!file.thumb_file_id || file.kind === "image";
  return (
    <div className="group relative rounded-lg border border-border bg-card overflow-hidden hover:border-primary/40 transition-colors">
      <button onClick={onOpen} className="block w-full text-left">
        <div className="aspect-square bg-muted flex items-center justify-center relative overflow-hidden">
          {hasThumb ? (
            <img
              src={`/api/files/${file.id}/thumb`}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <Icon className="h-10 w-10 text-muted-foreground" />
          )}
          {!hasThumb && (
            <div className="absolute bottom-1.5 left-1.5 text-[9px] font-mono uppercase tracking-wider text-muted-foreground bg-background/70 px-1.5 py-0.5 rounded">
              {file.kind}
            </div>
          )}
        </div>
        <div className="p-2">
          <div className="text-xs font-medium truncate">{file.filename}</div>
          <div className="mt-0.5 flex items-center justify-between text-[10px] tabular-nums text-muted-foreground">
            <span>{formatBytes(Number(file.size_bytes))}</span>
            <span>{formatDate(file.created_at)}</span>
          </div>
        </div>
      </button>
      <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <a
          href={`/api/files/${file.id}/stream?dl=1`}
          className="h-7 w-7 flex items-center justify-center rounded-md bg-background/80 backdrop-blur border border-border text-muted-foreground hover:text-foreground"
          aria-label="Download"
        >
          <Download className="h-3.5 w-3.5" />
        </a>
        <button
          onClick={onDelete}
          className="h-7 w-7 flex items-center justify-center rounded-md bg-background/80 backdrop-blur border border-border text-muted-foreground hover:text-destructive"
          aria-label="Delete"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function ListView({
  files,
  onOpen,
  onDelete,
}: {
  files: FileRow[];
  onOpen: (id: string) => void;
  onDelete: (id: string, name: string) => void;
}) {
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 text-xs text-muted-foreground">
          <tr>
            <th className="text-left px-3 py-2 font-medium">Name</th>
            <th className="text-left px-3 py-2 font-medium w-24">Kind</th>
            <th className="text-right px-3 py-2 font-medium w-24 tabular-nums">Size</th>
            <th className="text-right px-3 py-2 font-medium w-32 tabular-nums">Added</th>
            <th className="w-24" />
          </tr>
        </thead>
        <tbody>
          {files.map((f) => {
            const Icon = kindIcon(f.kind);
            return (
              <tr
                key={f.id}
                className="border-t border-border hover:bg-muted/20 cursor-pointer"
                onClick={() => onOpen(f.id)}
              >
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{f.filename}</span>
                  </div>
                </td>
                <td className="px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground">{f.kind}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {formatBytes(Number(f.size_bytes))}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatDate(f.created_at)}</td>
                <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end gap-1">
                    <a
                      href={`/api/files/${f.id}/stream?dl=1`}
                      className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
                      aria-label="Download"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </a>
                    <button
                      onClick={() => onDelete(f.id, f.filename)}
                      className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-muted"
                      aria-label="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}