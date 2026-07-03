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
  Loader2,
  Filter,
  FolderPlus,
  Folder,
  ChevronRight,
  Home,
  X,
  MoreHorizontal,
  Pencil,
  FolderInput,
  RotateCcw,
  CheckSquare,
  PackageOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { formatBytes, formatDate } from "@/lib/format";
import { uploadFile, type UploadProgress } from "@/lib/upload";
import { FilePreview } from "@/components/file-preview";
import { NewFolderDialog } from "@/components/new-folder-dialog";
import { FolderPicker } from "@/components/folder-picker";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { vaultFetch, vaultUrl } from "@/lib/vault-client";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type FileRow = {
  id: string;
  filename: string;
  mime: string;
  size_bytes: number;
  kind: string;
  tags: string[];
  thumb_file_id: string | null;
  created_at: string;
  folder_id: string | null;
  parts: Array<{ index: number; size: number }>;
};

type FolderRow = {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
};

type Breadcrumb = { id: string; name: string };

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
  controller: AbortController;
};

// ---------- pending delete state ----------
type PendingDelete =
  | { type: "file"; id: string; name: string }
  | { type: "folder"; id: string; name: string }
  | { type: "bulk"; ids: string[]; count: number };

// ---------- concurrent upload pool ----------
const UPLOAD_CONCURRENCY = 3;

async function runPool<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < tasks.length) {
      const idx = nextIdx++;
      try {
        results[idx] = { status: "fulfilled", value: await tasks[idx]() };
      } catch (e) {
        results[idx] = { status: "rejected", reason: e };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

export function FileManager() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [sort, setSort] = useState<SortKey>("created_desc");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [uploads, setUploads] = useState<Uploading[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Folder state
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([]);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [movePickerOpen, setMovePickerOpen] = useState(false);
  const [moveFileId, setMoveFileId] = useState<string | null>(null);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [folderNewName, setFolderNewName] = useState("");

  // Confirm dialog state
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [bulkDownloading, setBulkDownloading] = useState(false);
  const [folderDownloading, setFolderDownloading] = useState<string | null>(null);

  // Clear selection when navigating folders or searching
  useEffect(() => {
    setSelectedIds(new Set());
  }, [currentFolderId, q]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback((fileIds: string[]) => {
    setSelectedIds((prev) => {
      if (fileIds.every((id) => prev.has(id))) return new Set(); // deselect all
      return new Set(fileIds);
    });
  }, []);

  // Fetch folders for current level
  const foldersQuery = useQuery({
    queryKey: ["folders", currentFolderId],
    queryFn: async () => {
      const param = currentFolderId ?? "root";
      const res = await vaultFetch(`/api/folders?parent_id=${param}`);
      if (!res.ok) throw new Error("Failed");
      const j = (await res.json()) as { folders: FolderRow[] };
      return j.folders;
    },
    enabled: !q && kind === "all", // Don't fetch folders when searching or filtering
  });

  // Fetch files
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (kind !== "all") params.set("kind", kind);
  params.set("sort", sort);
  if (!q) params.set("folder_id", currentFolderId ?? "root");

  const filesQuery = useQuery({
    queryKey: ["files", q, kind, sort, currentFolderId],
    queryFn: async () => {
      const res = await vaultFetch(`/api/files?${params.toString()}`);
      if (!res.ok) throw new Error("Failed");
      const j = (await res.json()) as { files: FileRow[] };
      return j.files;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await vaultFetch(`/api/files/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["files"] });
    },
    onError: () => toast.error("Delete failed"),
  });

  const deleteFolderMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await vaultFetch(`/api/folders/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      toast.success("Folder deleted");
      qc.invalidateQueries({ queryKey: ["folders"] });
      qc.invalidateQueries({ queryKey: ["files"] });
    },
    onError: () => toast.error("Failed to delete folder"),
  });

  const renameFolderMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const res = await vaultFetch(`/api/folders/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error("Rename failed");
    },
    onSuccess: () => {
      toast.success("Folder renamed");
      setRenamingFolderId(null);
      qc.invalidateQueries({ queryKey: ["folders"] });
    },
    onError: () => toast.error("Failed to rename folder"),
  });

  const moveFileMutation = useMutation({
    mutationFn: async ({ fileId, folderId }: { fileId: string; folderId: string | null }) => {
      const res = await vaultFetch(`/api/files/${fileId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ folder_id: folderId }),
      });
      if (!res.ok) throw new Error("Move failed");
    },
    onSuccess: () => {
      toast.success("File moved");
      qc.invalidateQueries({ queryKey: ["files"] });
    },
    onError: () => toast.error("Failed to move file"),
  });

  // Bulk delete handler
  const handleBulkDelete = useCallback(async () => {
    const ids = [...selectedIds];
    let succeeded = 0;
    for (const id of ids) {
      try {
        const res = await vaultFetch(`/api/files/${id}`, { method: "DELETE" });
        if (res.ok) succeeded++;
      } catch {
        // continue
      }
    }
    toast.success(`Deleted ${succeeded} file${succeeded !== 1 ? "s" : ""}`);
    setSelectedIds(new Set());
    qc.invalidateQueries({ queryKey: ["files"] });
  }, [selectedIds, qc]);

  // Bulk move handler
  const handleBulkMove = useCallback(
    async (folderId: string | null) => {
      const ids = [...selectedIds];
      let succeeded = 0;
      for (const id of ids) {
        try {
          const res = await vaultFetch(`/api/files/${id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ folder_id: folderId }),
          });
          if (res.ok) succeeded++;
        } catch {
          // continue
        }
      }
      toast.success(`Moved ${succeeded} file${succeeded !== 1 ? "s" : ""}`);
      setSelectedIds(new Set());
      qc.invalidateQueries({ queryKey: ["files"] });
    },
    [selectedIds, qc],
  );

  // Bulk download (ZIP)
  const handleBulkDownload = useCallback(async () => {
    const ids = [...selectedIds];
    setBulkDownloading(true);
    try {
      const res = await vaultFetch("/api/files/download-zip", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error(`ZIP failed: ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `vault-${ids.length}-files.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Downloaded ${ids.length} file${ids.length !== 1 ? "s" : ""} as ZIP`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ZIP download failed");
    } finally {
      setBulkDownloading(false);
    }
  }, [selectedIds]);

  // Download all files in a folder as ZIP
  const handleFolderDownload = useCallback(async (folderId: string, folderName: string) => {
    setFolderDownloading(folderId);
    try {
      // Fetch all files in this folder
      const res = await vaultFetch(`/api/files?folder_id=${folderId}&sort=name_asc`);
      if (!res.ok) throw new Error("Failed to list folder files");
      const { files: folderFiles } = (await res.json()) as { files: Array<{ id: string }> };
      if (folderFiles.length === 0) {
        toast.info(`"${folderName}" is empty`);
        return;
      }
      const ids = folderFiles.map((f) => f.id);
      const zipRes = await vaultFetch("/api/files/download-zip", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!zipRes.ok) throw new Error(`ZIP failed: ${zipRes.status}`);
      const blob = await zipRes.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${folderName}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(
        `Downloaded "${folderName}" (${ids.length} file${ids.length !== 1 ? "s" : ""}) as ZIP`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Folder download failed");
    } finally {
      setFolderDownloading(null);
    }
  }, []);

  // Navigate into folder
  const navigateToFolder = useCallback(async (folderId: string | null) => {
    setCurrentFolderId(folderId);
    if (folderId === null) {
      setBreadcrumbs([]);
    } else {
      try {
        const res = await vaultFetch(`/api/folders/${folderId}`);
        if (res.ok) {
          const data = (await res.json()) as { folder: FolderRow; breadcrumbs: FolderRow[] };
          setBreadcrumbs(data.breadcrumbs.map((b) => ({ id: b.id, name: b.name })));
        }
      } catch {
        // Keep current breadcrumbs on error
      }
    }
  }, []);

  // Concurrent upload pool
  const startUpload = useCallback(
    async (files: File[]) => {
      const tasks = files.map((file) => async () => {
        const controller = new AbortController();
        const uploadId = crypto.randomUUID();
        setUploads((u) => [...u, { id: uploadId, file, progress: null, controller }]);
        try {
          await uploadFile(
            file,
            (p) => {
              setUploads((u) => u.map((x) => (x.id === uploadId ? { ...x, progress: p } : x)));
            },
            currentFolderId,
            controller.signal,
          );
          setUploads((u) => u.map((x) => (x.id === uploadId ? { ...x, done: true } : x)));
          toast.success(`Uploaded ${file.name}`);
          qc.invalidateQueries({ queryKey: ["files"] });
          setTimeout(() => setUploads((u) => u.filter((x) => x.id !== uploadId)), 2500);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Upload failed";
          if (message === "Upload cancelled") {
            setUploads((u) => u.filter((x) => x.id !== uploadId));
          } else {
            setUploads((u) => u.map((x) => (x.id === uploadId ? { ...x, error: message } : x)));
            toast.error(`${file.name}: ${message}`);
          }
        }
      });

      // Run with concurrency limit
      await runPool(tasks, UPLOAD_CONCURRENCY);
    },
    [qc, currentFolderId],
  );

  const cancelUpload = useCallback((uploadId: string) => {
    setUploads((u) => {
      const entry = u.find((x) => x.id === uploadId);
      entry?.controller.abort();
      return u.filter((x) => x.id !== uploadId);
    });
  }, []);

  const retryUpload = useCallback(
    (entry: Uploading) => {
      setUploads((u) => u.filter((x) => x.id !== entry.id));
      startUpload([entry.file]);
    },
    [startUpload],
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
  const folders = (!q && kind === "all" ? foldersQuery.data : null) ?? [];
  const totalSize = useMemo(() => files.reduce((n, f) => n + Number(f.size_bytes), 0), [files]);
  const isSearching = !!q;
  const allFileIds = files.map((f) => f.id);
  const allSelected = allFileIds.length > 0 && allFileIds.every((id) => selectedIds.has(id));

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
                  view === "grid"
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                aria-label="Grid view"
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                onClick={() => setView("list")}
                className={`px-2.5 h-9 flex items-center border-l border-border ${
                  view === "list"
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground"
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
            <Button size="sm" variant="outline" onClick={() => setNewFolderOpen(true)}>
              <FolderPlus className="h-4 w-4 mr-1.5" />
              Folder
            </Button>
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
          </div>
        </div>

        {/* Breadcrumb bar */}
        {!isSearching && (
          <div className="border-t border-border bg-muted/20">
            <div className="mx-auto flex max-w-[1600px] items-center gap-1 overflow-x-auto px-4 sm:px-6 py-1.5 text-xs">
              <button
                onClick={() => navigateToFolder(null)}
                className={`shrink-0 flex items-center gap-1 px-2 py-1 rounded-md transition-colors hover:bg-muted ${
                  currentFolderId === null
                    ? "text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Home className="h-3.5 w-3.5" />
                Vault
              </button>
              {breadcrumbs.map((crumb) => (
                <span key={crumb.id} className="flex items-center gap-1 shrink-0">
                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                  <button
                    onClick={() => navigateToFolder(crumb.id)}
                    className={`px-2 py-1 rounded-md transition-colors hover:bg-muted ${
                      currentFolderId === crumb.id
                        ? "text-foreground font-medium"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {crumb.name}
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-[1600px] px-4 sm:px-6 py-6 pb-24">
        {filesQuery.isLoading ? (
          <div className="flex items-center justify-center py-24 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading…
          </div>
        ) : folders.length === 0 && files.length === 0 ? (
          <EmptyState
            onPick={() => fileInputRef.current?.click()}
            onNewFolder={() => setNewFolderOpen(true)}
            isRoot={currentFolderId === null}
            isSearching={isSearching}
            searchQuery={q}
            onClearSearch={() => setQ("")}
          />
        ) : (
          <>
            {/* ── Select-all bar (only when files exist) ── */}
            {files.length > 0 && (
              <div className="mb-3 flex items-center gap-3 px-1">
                <button
                  onClick={() => selectAll(allFileIds)}
                  className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors group"
                  aria-label={allSelected ? "Deselect all" : "Select all files"}
                >
                  <div
                    className={`h-4 w-4 rounded border flex items-center justify-center transition-colors ${
                      allSelected
                        ? "bg-primary border-primary text-primary-foreground"
                        : selectedIds.size > 0
                          ? "bg-primary/30 border-primary"
                          : "border-border group-hover:border-primary/60"
                    }`}
                  >
                    {allSelected ? (
                      <svg viewBox="0 0 10 8" className="h-2.5 w-2.5 fill-current">
                        <path
                          d="M1 4l3 3 5-6"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          fill="none"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : selectedIds.size > 0 ? (
                      <svg viewBox="0 0 10 2" className="h-2 w-2.5 fill-current">
                        <rect x="0" y="0" width="10" height="2" rx="1" fill="currentColor" />
                      </svg>
                    ) : null}
                  </div>
                  <span>
                    {allSelected
                      ? `Deselect all ${files.length} files`
                      : selectedIds.size > 0
                        ? `${selectedIds.size} of ${files.length} selected — select all`
                        : `Select all ${files.length} files`}
                  </span>
                </button>
                {selectedIds.size > 0 && (
                  <button
                    onClick={() => setSelectedIds(new Set())}
                    className="text-xs text-muted-foreground hover:text-foreground ml-1"
                  >
                    Clear
                  </button>
                )}
                {allSelected && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-auto h-7 text-xs"
                    onClick={handleBulkDownload}
                    disabled={bulkDownloading}
                  >
                    {bulkDownloading ? (
                      <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                    ) : (
                      <Download className="h-3 w-3 mr-1.5" />
                    )}
                    {bulkDownloading ? "Preparing…" : `Download all ${files.length} files`}
                  </Button>
                )}
              </div>
            )}

            {view === "grid" ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                {/* Folders first */}
                {folders.map((f) => (
                  <FolderGridCard
                    key={f.id}
                    folder={f}
                    onOpen={() => navigateToFolder(f.id)}
                    onRename={() => {
                      setRenamingFolderId(f.id);
                      setFolderNewName(f.name);
                    }}
                    onDelete={() => setPendingDelete({ type: "folder", id: f.id, name: f.name })}
                    onDownload={() => handleFolderDownload(f.id, f.name)}
                    isDownloading={folderDownloading === f.id}
                    isRenaming={renamingFolderId === f.id}
                    renameName={folderNewName}
                    onRenameChange={setFolderNewName}
                    onRenameSubmit={() => {
                      if (folderNewName.trim())
                        renameFolderMutation.mutate({ id: f.id, name: folderNewName.trim() });
                    }}
                    onRenameCancel={() => setRenamingFolderId(null)}
                  />
                ))}
                {/* Then files */}
                {files.map((f) => (
                  <GridCard
                    key={f.id}
                    file={f}
                    selected={selectedIds.has(f.id)}
                    anySelected={selectedIds.size > 0}
                    onSelect={() => toggleSelect(f.id)}
                    onOpen={() => setPreviewId(f.id)}
                    onDelete={() => setPendingDelete({ type: "file", id: f.id, name: f.filename })}
                    onMove={() => {
                      setMoveFileId(f.id);
                      setMovePickerOpen(true);
                    }}
                  />
                ))}
              </div>
            ) : (
              <ListView
                folders={folders}
                files={files}
                selectedIds={selectedIds}
                allSelected={allSelected}
                onSelectAll={() => selectAll(allFileIds)}
                onSelectFile={toggleSelect}
                onOpenFile={(id) => setPreviewId(id)}
                onOpenFolder={(id) => navigateToFolder(id)}
                onDeleteFile={(id, name) => setPendingDelete({ type: "file", id, name })}
                onDeleteFolder={(id, name) => setPendingDelete({ type: "folder", id, name })}
                onDownloadFolder={(id, name) => handleFolderDownload(id, name)}
                folderDownloading={folderDownloading}
                onMoveFile={(id) => {
                  setMoveFileId(id);
                  setMovePickerOpen(true);
                }}
                onRenameFolder={(id, name) => {
                  setRenamingFolderId(id);
                  setFolderNewName(name);
                }}
                renamingFolderId={renamingFolderId}
                folderNewName={folderNewName}
                onFolderNewNameChange={setFolderNewName}
                onFolderRenameSubmit={(id) => {
                  if (folderNewName.trim())
                    renameFolderMutation.mutate({ id, name: folderNewName.trim() });
                }}
                onFolderRenameCancel={() => setRenamingFolderId(null)}
              />
            )}
          </>
        )}
      </main>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card/95 backdrop-blur shadow-2xl">
          <div className="mx-auto max-w-[1600px] px-4 sm:px-6 py-3 flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium text-foreground tabular-nums">
              {selectedIds.size} file{selectedIds.size !== 1 ? "s" : ""} selected
            </span>
            <div className="flex gap-2 flex-wrap ml-auto">
              <Button
                size="sm"
                variant="outline"
                onClick={handleBulkDownload}
                disabled={bulkDownloading}
              >
                {bulkDownloading ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-1.5" />
                )}
                {bulkDownloading ? "Preparing ZIP…" : "Download as ZIP"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setBulkMoveOpen(true)}>
                <FolderInput className="h-4 w-4 mr-1.5" />
                Move to folder
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() =>
                  setPendingDelete({ type: "bulk", ids: [...selectedIds], count: selectedIds.size })
                }
              >
                <Trash2 className="h-4 w-4 mr-1.5" />
                Delete {selectedIds.size}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelectedIds(new Set())}
                aria-label="Clear selection"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Upload tray */}
      {uploads.length > 0 && (
        <div
          className={`fixed z-40 w-80 rounded-lg border border-border bg-card shadow-2xl overflow-hidden transition-all ${
            selectedIds.size > 0 ? "bottom-20 right-4" : "bottom-4 right-4"
          }`}
        >
          <div className="px-3 py-2 border-b border-border flex items-center justify-between text-xs">
            <span className="font-medium">
              Uploads ({uploads.filter((u) => !u.done && !u.error).length} active)
            </span>
            <button
              onClick={() => setUploads((u) => u.filter((x) => !x.done && !x.error))}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Clear finished"
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
                    <span className="tabular-nums text-muted-foreground shrink-0">
                      {formatBytes(u.file.size)}
                    </span>
                    {/* Cancel / Retry buttons */}
                    {u.error ? (
                      <button
                        onClick={() => retryUpload(u)}
                        className="text-muted-foreground hover:text-primary"
                        aria-label="Retry upload"
                        title="Retry"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </button>
                    ) : !u.done ? (
                      <button
                        onClick={() => cancelUpload(u.id)}
                        className="text-muted-foreground hover:text-destructive"
                        aria-label="Cancel upload"
                        title="Cancel"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
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
            <p className="text-xs text-muted-foreground mt-1">
              {currentFolderId ? "Uploading to current folder" : "Uploading to root"}
            </p>
          </div>
        </div>
      )}

      {previewId && <FilePreview fileId={previewId} onClose={() => setPreviewId(null)} />}

      <NewFolderDialog
        open={newFolderOpen}
        onOpenChange={setNewFolderOpen}
        parentId={currentFolderId}
        onCreated={() => qc.invalidateQueries({ queryKey: ["folders"] })}
      />

      {/* Single-file move picker */}
      <FolderPicker
        open={movePickerOpen}
        onOpenChange={setMovePickerOpen}
        currentFolderId={currentFolderId}
        onSelect={(folderId) => {
          if (moveFileId) {
            moveFileMutation.mutate({ fileId: moveFileId, folderId });
            setMoveFileId(null);
          }
        }}
      />

      {/* Bulk move picker */}
      <FolderPicker
        open={bulkMoveOpen}
        onOpenChange={setBulkMoveOpen}
        currentFolderId={currentFolderId}
        onSelect={(folderId) => {
          handleBulkMove(folderId);
          setBulkMoveOpen(false);
        }}
      />

      {/* Unified confirm dialog */}
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={
          pendingDelete?.type === "bulk"
            ? `Delete ${pendingDelete.count} file${pendingDelete.count !== 1 ? "s" : ""}?`
            : pendingDelete?.type === "folder"
              ? `Delete folder "${pendingDelete?.name}"?`
              : `Delete "${pendingDelete?.name}"?`
        }
        description={
          pendingDelete?.type === "bulk"
            ? "All selected files will be permanently removed from Telegram. This cannot be undone."
            : pendingDelete?.type === "folder"
              ? "Sub-folders will also be deleted. Files inside will be moved to root. This cannot be undone."
              : "This file will be permanently removed from Telegram. This cannot be undone."
        }
        confirmLabel={
          pendingDelete?.type === "bulk" ? `Delete ${pendingDelete?.count} files` : "Delete"
        }
        destructive
        onConfirm={() => {
          if (!pendingDelete) return;
          if (pendingDelete.type === "file") deleteMutation.mutate(pendingDelete.id);
          else if (pendingDelete.type === "folder") deleteFolderMutation.mutate(pendingDelete.id);
          else handleBulkDelete();
          setPendingDelete(null);
        }}
      />
    </div>
  );
}

function EmptyState({
  onPick,
  onNewFolder,
  isRoot,
  isSearching,
  searchQuery,
  onClearSearch,
}: {
  onPick: () => void;
  onNewFolder: () => void;
  isRoot: boolean;
  isSearching?: boolean;
  searchQuery?: string;
  onClearSearch?: () => void;
}) {
  if (isSearching) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="h-14 w-14 rounded-2xl bg-muted flex items-center justify-center mb-4">
          <Search className="h-6 w-6 text-muted-foreground" />
        </div>
        <h2 className="text-lg font-semibold">No results for "{searchQuery}"</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-sm">
          Try a different search term or clear the search to browse all files.
        </p>
        <Button variant="outline" className="mt-5" onClick={onClearSearch}>
          <X className="h-4 w-4 mr-1.5" />
          Clear search
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="h-14 w-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-4">
        {isRoot ? <PackageOpen className="h-6 w-6" /> : <Folder className="h-6 w-6" />}
      </div>
      <h2 className="text-lg font-semibold">
        {isRoot ? "Vault is empty" : "This folder is empty"}
      </h2>
      <p className="text-sm text-muted-foreground mt-1 max-w-sm">
        Drop files anywhere on this page, or click Upload. Everything goes into your private
        Telegram group.
      </p>
      <div className="mt-5 flex gap-2">
        <Button variant="outline" onClick={onNewFolder}>
          <FolderPlus className="h-4 w-4 mr-1.5" />
          New Folder
        </Button>
        <Button onClick={onPick}>
          <Upload className="h-4 w-4 mr-1.5" />
          Choose files
        </Button>
      </div>
    </div>
  );
}

function FolderGridCard({
  folder,
  onOpen,
  onRename,
  onDelete,
  onDownload,
  isDownloading,
  isRenaming,
  renameName,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
}: {
  folder: FolderRow;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
  onDownload: () => void;
  isDownloading: boolean;
  isRenaming: boolean;
  renameName: string;
  onRenameChange: (name: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
}) {
  return (
    <div className="group relative rounded-lg border border-border bg-card overflow-hidden hover:border-primary/40 transition-colors">
      <button onClick={onOpen} className="block w-full text-left">
        <div className="aspect-square bg-muted/30 flex items-center justify-center">
          <Folder className="h-12 w-12 text-primary/60" />
        </div>
        <div className="p-2">
          {isRenaming ? (
            <input
              value={renameName}
              onChange={(e) => onRenameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onRenameSubmit();
                if (e.key === "Escape") onRenameCancel();
              }}
              onBlur={onRenameCancel}
              onClick={(e) => e.stopPropagation()}
              autoFocus
              className="w-full text-xs font-medium bg-transparent border-b border-primary outline-none"
            />
          ) : (
            <div className="text-xs font-medium truncate">{folder.name}</div>
          )}
          <div className="mt-0.5 text-[10px] text-muted-foreground">Folder</div>
        </div>
      </button>
      <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              className="h-7 w-7 flex items-center justify-center rounded-md bg-background/80 backdrop-blur border border-border text-muted-foreground hover:text-foreground"
              aria-label="Folder actions"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onDownload} disabled={isDownloading}>
              {isDownloading ? (
                <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5 mr-2" />
              )}
              {isDownloading ? "Preparing ZIP…" : "Download as ZIP"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onRename}>
              <Pencil className="h-3.5 w-3.5 mr-2" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onDelete}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function GridCard({
  file,
  selected,
  anySelected,
  onSelect,
  onOpen,
  onDelete,
  onMove,
}: {
  file: FileRow;
  selected: boolean;
  anySelected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onDelete: () => void;
  onMove: () => void;
}) {
  const Icon = kindIcon(file.kind);
  const hasThumb = !!file.thumb_file_id || file.kind === "image";
  return (
    <div
      className={`group relative rounded-lg border bg-card overflow-hidden transition-colors ${
        selected ? "border-primary ring-1 ring-primary/30" : "border-border hover:border-primary/40"
      }`}
    >
      {/* Checkbox overlay */}
      <div
        className={`absolute top-1.5 left-1.5 z-10 transition-opacity ${
          selected || anySelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
          className="h-6 w-6 flex items-center justify-center rounded bg-background/80 backdrop-blur border border-border"
          aria-label="Select file"
        >
          <Checkbox checked={selected} onCheckedChange={onSelect} className="pointer-events-none" />
        </button>
      </div>

      <button onClick={onOpen} className="block w-full text-left">
        <div className="aspect-square bg-muted flex items-center justify-center relative overflow-hidden">
          {hasThumb ? (
            <img
              src={vaultUrl(`/api/files/${file.id}/thumb`)}
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
          href={vaultUrl(`/api/files/${file.id}/stream?dl=1`)}
          className="h-7 w-7 flex items-center justify-center rounded-md bg-background/80 backdrop-blur border border-border text-muted-foreground hover:text-foreground"
          aria-label="Download"
        >
          <Download className="h-3.5 w-3.5" />
        </a>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onMove();
          }}
          className="h-7 w-7 flex items-center justify-center rounded-md bg-background/80 backdrop-blur border border-border text-muted-foreground hover:text-foreground"
          aria-label="Move"
        >
          <FolderInput className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
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
  folders,
  files,
  selectedIds,
  allSelected,
  onSelectAll,
  onSelectFile,
  onOpenFile,
  onOpenFolder,
  onDeleteFile,
  onDeleteFolder,
  onDownloadFolder,
  folderDownloading,
  onMoveFile,
  onRenameFolder,
  renamingFolderId,
  folderNewName,
  onFolderNewNameChange,
  onFolderRenameSubmit,
  onFolderRenameCancel,
}: {
  folders: FolderRow[];
  files: FileRow[];
  selectedIds: Set<string>;
  allSelected: boolean;
  onSelectAll: () => void;
  onSelectFile: (id: string) => void;
  onOpenFile: (id: string) => void;
  onOpenFolder: (id: string) => void;
  onDeleteFile: (id: string, name: string) => void;
  onDeleteFolder: (id: string, name: string) => void;
  onDownloadFolder: (id: string, name: string) => void;
  folderDownloading: string | null;
  onMoveFile: (id: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  renamingFolderId: string | null;
  folderNewName: string;
  onFolderNewNameChange: (name: string) => void;
  onFolderRenameSubmit: (id: string) => void;
  onFolderRenameCancel: () => void;
}) {
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 w-8">
              <button
                onClick={onSelectAll}
                aria-label="Select all files"
                title={allSelected ? "Deselect all" : "Select all"}
              >
                <CheckSquare
                  className={`h-4 w-4 ${allSelected ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
                />
              </button>
            </th>
            <th className="text-left px-3 py-2 font-medium">Name</th>
            <th className="text-left px-3 py-2 font-medium w-24">Kind</th>
            <th className="text-right px-3 py-2 font-medium w-24 tabular-nums">Size</th>
            <th className="text-right px-3 py-2 font-medium w-32 tabular-nums">Added</th>
            <th className="w-28" />
          </tr>
        </thead>
        <tbody>
          {/* Folders first */}
          {folders.map((f) => (
            <tr
              key={`folder-${f.id}`}
              className="border-t border-border hover:bg-muted/20 cursor-pointer"
              onClick={() => onOpenFolder(f.id)}
            >
              <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                {/* Folders are not selectable */}
              </td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Folder className="h-4 w-4 shrink-0 text-primary/70" />
                  {renamingFolderId === f.id ? (
                    <input
                      value={folderNewName}
                      onChange={(e) => onFolderNewNameChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") onFolderRenameSubmit(f.id);
                        if (e.key === "Escape") onFolderRenameCancel();
                      }}
                      onBlur={onFolderRenameCancel}
                      onClick={(e) => e.stopPropagation()}
                      autoFocus
                      className="flex-1 bg-transparent border-b border-primary outline-none text-sm"
                    />
                  ) : (
                    <span className="truncate font-medium">{f.name}</span>
                  )}
                </div>
              </td>
              <td className="px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground">
                folder
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">—</td>
              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                {formatDate(f.created_at)}
              </td>
              <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-end gap-1">
                  <button
                    onClick={() => onDownloadFolder(f.id, f.name)}
                    disabled={folderDownloading === f.id}
                    className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50"
                    aria-label="Download folder as ZIP"
                    title="Download as ZIP"
                  >
                    {folderDownloading === f.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <button
                    onClick={() => onRenameFolder(f.id, f.name)}
                    className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
                    aria-label="Rename folder"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => onDeleteFolder(f.id, f.name)}
                    className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-muted"
                    aria-label="Delete folder"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {/* Then files */}
          {files.map((f) => {
            const Icon = kindIcon(f.kind);
            const isSelected = selectedIds.has(f.id);
            return (
              <tr
                key={f.id}
                className={`border-t border-border hover:bg-muted/20 cursor-pointer transition-colors ${isSelected ? "bg-primary/5" : ""}`}
                onClick={() => onOpenFile(f.id)}
              >
                <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => onSelectFile(f.id)}
                    aria-label={`Select ${f.filename}`}
                  />
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{f.filename}</span>
                  </div>
                </td>
                <td className="px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground">
                  {f.kind}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {formatBytes(Number(f.size_bytes))}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {formatDate(f.created_at)}
                </td>
                <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end gap-1">
                    <a
                      href={vaultUrl(`/api/files/${f.id}/stream?dl=1`)}
                      className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
                      aria-label="Download"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </a>
                    <button
                      onClick={() => onMoveFile(f.id)}
                      className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
                      aria-label="Move"
                    >
                      <FolderInput className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => onDeleteFile(f.id, f.filename)}
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
