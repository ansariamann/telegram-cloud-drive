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
  ChevronLeft,
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
  { key: "image", label: "Photos", Icon: ImageIcon },
  { key: "video", label: "Videos", Icon: Film },
  { key: "audio", label: "Audio", Icon: Music },
  { key: "pdf", label: "PDFs", Icon: FileText },
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

// ---------- ID generation ----------
function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

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

// ---------- Date grouping ----------
function getDateGroupLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const fileDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  if (fileDay.getTime() === today.getTime()) return "Today";
  if (fileDay.getTime() === yesterday.getTime()) return "Yesterday";

  const diffDays = Math.floor((today.getTime() - fileDay.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 7) {
    return d.toLocaleDateString(undefined, { weekday: "long" });
  }

  return d.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

function groupFilesByDate(files: FileRow[]): Array<{ label: string; files: FileRow[] }> {
  const groups: Map<string, FileRow[]> = new Map();
  for (const f of files) {
    const label = getDateGroupLabel(f.created_at);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(f);
  }
  return Array.from(groups.entries()).map(([label, files]) => ({ label, files }));
}

export function FileManager() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");

  // Custom premium notification state
  const [notification, setNotification] = useState<{
    message: string;
    type: "success" | "error" | "info";
    id: string;
  } | null>(null);

  const toast = useMemo(() => {
    const fn = (message: string, type: "success" | "error" | "info" = "success") => {
      setNotification({ message, type, id: generateId() });
    };
    return {
      success: (msg: string) => fn(msg, "success"),
      error: (msg: string) => fn(msg, "error"),
      info: (msg: string) => fn(msg, "info"),
    };
  }, []);

  // auto-dismiss notification after 3.5 seconds
  useEffect(() => {
    if (!notification) return;
    const t = setTimeout(() => setNotification(null), 3500);
    return () => clearTimeout(t);
  }, [notification]);
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

  // ---------- Back-button navigation ----------
  // Push a history entry when entering a folder so the device back button
  // navigates up a level instead of leaving the app entirely.
  const navigateToFolder = useCallback(async (folderId: string | null, fromPopState = false) => {
    setCurrentFolderId(folderId);
    if (folderId === null) {
      setBreadcrumbs([]);
      if (!fromPopState) {
        // Going to root: replace so we don't stack extra entries
        history.replaceState({ folderId: null }, "");
      }
    } else {
      if (!fromPopState) {
        history.pushState({ folderId }, "");
      }
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

  useEffect(() => {
    // Seed the initial history state
    history.replaceState({ folderId: null }, "");

    function onPopState(e: PopStateEvent) {
      const state = e.state as { folderId: string | null } | null;
      const targetId = state?.folderId ?? null;
      navigateToFolder(targetId, true);
    }

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [navigateToFolder]);

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
      if (fileIds.every((id) => prev.has(id))) return new Set();
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
    enabled: !q && kind === "all",
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

  // Concurrent upload pool
  const startUpload = useCallback(
    async (files: File[]) => {
      const tasks = files.map((file) => async () => {
        const controller = new AbortController();
        const uploadId = generateId();
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

  // Date-grouped files for gallery view
  const dateGroups = useMemo(() => groupFilesByDate(files), [files]);

  const canGoBack = breadcrumbs.length > 0 || currentFolderId !== null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Premium Dynamic Notification Pill */}
      {notification && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none animate-in fade-in slide-in-from-top-5 duration-300">
          <div className={`flex items-center gap-3 px-6 py-3 rounded-full border shadow-2xl backdrop-blur-xl pointer-events-auto transition-all bg-card/90 border-border/80 text-foreground
            ${
              notification.type === "success"
                ? "shadow-emerald-950/20"
                : notification.type === "error"
                  ? "shadow-destructive/10"
                  : "shadow-primary/10"
            }`}
          >
            {notification.type === "success" && (
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </span>
            )}
            {notification.type === "error" && (
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-destructive/20 text-destructive-foreground">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </span>
            )}
            {notification.type === "info" && (
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </span>
            )}
            <span className="text-sm font-semibold tracking-wide">{notification.message}</span>
            <button
              onClick={() => setNotification(null)}
              className="ml-2 text-muted-foreground hover:text-foreground transition-colors rounded-full p-0.5 hover:bg-muted"
            >
              <X className="h-4.5 w-4.5" />
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        {/* Row 1: Logo + Actions */}
        <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-4 py-3 sm:px-6">

          {/* Back button — only shows when inside a folder */}
          {canGoBack && (
            <button
              onClick={() => {
                if (breadcrumbs.length >= 2) {
                  navigateToFolder(breadcrumbs[breadcrumbs.length - 2].id);
                } else {
                  navigateToFolder(null);
                }
              }}
              className="h-10 w-10 flex items-center justify-center rounded-xl border border-border text-muted-foreground hover:text-foreground hover:bg-muted active:scale-95 transition-all shrink-0"
              aria-label="Go back"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          )}

          <div className="flex items-center gap-2.5 shrink-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/20 text-primary">
              <Archive className="h-5 w-5" />
            </div>
            <span className="text-lg font-bold tracking-tight hidden sm:inline">Vault</span>
          </div>

          {/* Search — inline on desktop */}
          <div className="relative flex-1 hidden sm:block max-w-xl mx-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search files…"
              className="pl-9 h-11 text-base rounded-xl"
            />
          </div>

          <div className="ml-auto flex items-center gap-2">
            {/* Sort */}
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="hidden sm:block h-10 rounded-xl border border-border bg-input px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="created_desc">Newest</option>
              <option value="created_asc">Oldest</option>
              <option value="name_asc">Name A→Z</option>
              <option value="name_desc">Name Z→A</option>
              <option value="size_desc">Largest</option>
              <option value="size_asc">Smallest</option>
            </select>

            {/* View toggle */}
            <div className="flex rounded-xl border border-border overflow-hidden">
              <button
                onClick={() => setView("grid")}
                className={`px-2.5 h-10 flex items-center transition-colors ${
                  view === "grid"
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                aria-label="Grid view"
              >
                <LayoutGrid className="h-5 w-5" />
              </button>
              <button
                onClick={() => setView("list")}
                className={`px-2.5 h-10 flex items-center border-l border-border transition-colors ${
                  view === "list"
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                aria-label="List view"
              >
                <Rows3 className="h-5 w-5" />
              </button>
            </div>

            <Link
              to="/settings"
              className="h-10 w-10 flex items-center justify-center rounded-xl border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Settings"
            >
              <SettingsIcon className="h-5 w-5" />
            </Link>

            {/* New Folder */}
            <button
              onClick={() => setNewFolderOpen(true)}
              className="h-10 w-10 flex items-center justify-center rounded-xl border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors sm:hidden"
              aria-label="New folder"
            >
              <FolderPlus className="h-5 w-5" />
            </button>
            <Button size="sm" variant="outline" onClick={() => setNewFolderOpen(true)} className="hidden sm:flex h-10 px-4 rounded-xl text-sm">
              <FolderPlus className="h-4 w-4 mr-2" />
              New Folder
            </Button>

            {/* Upload */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="h-10 w-10 flex items-center justify-center rounded-xl bg-primary text-primary-foreground active:scale-95 transition-all sm:hidden"
              aria-label="Upload files"
            >
              <Upload className="h-5 w-5" />
            </button>
            <Button size="sm" onClick={() => fileInputRef.current?.click()} className="hidden sm:flex h-10 px-4 rounded-xl text-sm">
              <Upload className="h-4 w-4 mr-2" />
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

        {/* Mobile search row */}
        <div className="sm:hidden px-4 pb-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search files…"
              className="pl-9 h-11 text-base rounded-xl w-full"
            />
            {q && (
              <button
                onClick={() => setQ("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Kind chips */}
        <div className="border-t border-border">
          <div className="mx-auto flex max-w-[1600px] items-center gap-2 overflow-x-auto px-4 sm:px-6 py-2.5 scrollbar-none">
            {KIND_ORDER.map(({ key, label, Icon }) => (
              <button
                key={key}
                onClick={() => setKind(key)}
                className={`shrink-0 flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium border transition-all active:scale-95 ${
                  kind === key
                    ? "border-primary/50 bg-primary/15 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground hover:border-border hover:bg-muted/40"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Breadcrumb bar */}
        {!isSearching && (
          <div className="border-t border-border bg-muted/20">
            <div className="mx-auto flex max-w-[1600px] items-center gap-1 overflow-x-auto px-4 sm:px-6 py-2 text-sm">
              <button
                onClick={() => navigateToFolder(null)}
                className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-colors hover:bg-muted ${
                  currentFolderId === null
                    ? "text-foreground font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Home className="h-4 w-4" />
                Vault
              </button>
              {breadcrumbs.map((crumb) => (
                <span key={crumb.id} className="flex items-center gap-1 shrink-0">
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  <button
                    onClick={() => navigateToFolder(crumb.id)}
                    className={`px-2.5 py-1.5 rounded-lg transition-colors hover:bg-muted ${
                      currentFolderId === crumb.id
                        ? "text-foreground font-semibold"
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

      <main className="mx-auto max-w-[1600px] px-4 sm:px-6 py-6 pb-28">
        {filesQuery.isLoading ? (
          <div className="flex flex-col items-center justify-center py-32 text-muted-foreground gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span className="text-base">Loading your files…</span>
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
            {/* ── Folders Section (always at top) ── */}
            {folders.length > 0 && (
              <section className="mb-8">
                <div className="flex items-center gap-2 mb-4">
                  <Folder className="h-5 w-5 text-primary" />
                  <h2 className="text-lg font-bold text-foreground">Folders</h2>
                  <span className="text-sm text-muted-foreground ml-1">({folders.length})</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
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
                </div>
              </section>
            )}

            {/* ── Files ── */}
            {files.length > 0 && (
              <>
                {/* Select-all bar */}
                <div className="mb-4 flex items-center gap-3 px-1">
                  <button
                    onClick={() => selectAll(allFileIds)}
                    className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors group"
                    aria-label={allSelected ? "Deselect all" : "Select all files"}
                  >
                    <div
                      className={`h-5 w-5 rounded border-2 flex items-center justify-center transition-colors ${
                        allSelected
                          ? "bg-primary border-primary text-primary-foreground"
                          : selectedIds.size > 0
                            ? "bg-primary/30 border-primary"
                            : "border-border group-hover:border-primary/60"
                      }`}
                    >
                      {allSelected ? (
                        <svg viewBox="0 0 10 8" className="h-3 w-3 fill-current">
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
                        <svg viewBox="0 0 10 2" className="h-2 w-3 fill-current">
                          <rect x="0" y="0" width="10" height="2" rx="1" fill="currentColor" />
                        </svg>
                      ) : null}
                    </div>
                    <span>
                      {allSelected
                        ? `Deselect all ${files.length}`
                        : selectedIds.size > 0
                          ? `${selectedIds.size} of ${files.length} selected`
                          : `Select all ${files.length} files`}
                    </span>
                  </button>
                  {selectedIds.size > 0 && (
                    <button
                      onClick={() => setSelectedIds(new Set())}
                      className="text-sm text-muted-foreground hover:text-foreground ml-1"
                    >
                      Clear
                    </button>
                  )}
                  {allSelected && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-auto h-9 text-sm rounded-xl"
                      onClick={handleBulkDownload}
                      disabled={bulkDownloading}
                    >
                      {bulkDownloading ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4 mr-2" />
                      )}
                      {bulkDownloading ? "Preparing…" : `Download all ${files.length}`}
                    </Button>
                  )}
                </div>

                {view === "grid" ? (
                  /* Gallery: date-grouped sections */
                  <div className="space-y-8">
                    {dateGroups.map(({ label, files: groupFiles }) => (
                      <section key={label}>
                        {/* Date section header */}
                        <div className="flex items-center gap-3 mb-3">
                          <h3 className="text-base font-bold text-foreground">{label}</h3>
                          <div className="flex-1 h-px bg-border" />
                          <span className="text-sm text-muted-foreground shrink-0">
                            {groupFiles.length} {groupFiles.length === 1 ? "item" : "items"}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-1.5 sm:gap-2">
                          {groupFiles.map((f) => (
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
                      </section>
                    ))}
                  </div>
                ) : (
                  <ListView
                    folders={[]}
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
          </>
        )}
      </main>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card/95 backdrop-blur shadow-2xl">
          <div className="mx-auto max-w-[1600px] px-4 sm:px-6 py-3 flex items-center gap-3">
            <span className="text-base font-semibold text-foreground tabular-nums shrink-0">
              {selectedIds.size} selected
            </span>
            <div className="flex gap-2 ml-auto items-center">
              {/* Download */}
              <button
                onClick={handleBulkDownload}
                disabled={bulkDownloading}
                title="Download as ZIP"
                className="h-10 w-10 sm:hidden flex items-center justify-center rounded-xl border border-border text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                {bulkDownloading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Download className="h-5 w-5" />}
              </button>
              <Button size="sm" variant="outline" onClick={handleBulkDownload} disabled={bulkDownloading} className="hidden sm:flex h-10 rounded-xl">
                {bulkDownloading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                {bulkDownloading ? "Preparing…" : "Download ZIP"}
              </Button>

              {/* Move */}
              <button
                onClick={() => setBulkMoveOpen(true)}
                title="Move to folder"
                className="h-10 w-10 sm:hidden flex items-center justify-center rounded-xl border border-border text-muted-foreground hover:text-foreground"
              >
                <FolderInput className="h-5 w-5" />
              </button>
              <Button size="sm" variant="outline" onClick={() => setBulkMoveOpen(true)} className="hidden sm:flex h-10 rounded-xl">
                <FolderInput className="h-4 w-4 mr-2" />
                Move
              </Button>

              {/* Delete */}
              <button
                onClick={() => setPendingDelete({ type: "bulk", ids: [...selectedIds], count: selectedIds.size })}
                title={`Delete ${selectedIds.size} files`}
                className="h-10 w-10 sm:hidden flex items-center justify-center rounded-xl border border-destructive/40 text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-5 w-5" />
              </button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => setPendingDelete({ type: "bulk", ids: [...selectedIds], count: selectedIds.size })}
                className="hidden sm:flex h-10 rounded-xl"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete {selectedIds.size}
              </Button>

              <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())} aria-label="Clear selection" className="h-10 w-10 rounded-xl">
                <X className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Upload tray */}
      {uploads.length > 0 && (
        <div
          className={`fixed z-40 rounded-2xl border border-border bg-card shadow-2xl overflow-hidden transition-all
            left-3 right-3 sm:left-auto sm:right-4 sm:w-80
            ${selectedIds.size > 0 ? "bottom-20 sm:bottom-20" : "bottom-4"}
          `}
        >
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <span className="font-semibold text-sm">
              Uploads ({uploads.filter((u) => !u.done && !u.error).length} active)
            </span>
            <button
              onClick={() => setUploads((u) => u.filter((x) => !x.done && !x.error))}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Clear finished"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <ul className="max-h-72 overflow-y-auto divide-y divide-border">
            {uploads.map((u) => {
              const pct = u.progress ? Math.round((u.progress.loaded / u.progress.total) * 100) : 0;
              return (
                <li key={u.id} className="px-4 py-3 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="truncate flex-1">{u.file.name}</span>
                    <span className="tabular-nums text-muted-foreground shrink-0 text-xs">
                      {formatBytes(u.file.size)}
                    </span>
                    {u.error ? (
                      <button
                        onClick={() => retryUpload(u)}
                        className="text-muted-foreground hover:text-primary"
                        aria-label="Retry upload"
                        title="Retry"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </button>
                    ) : !u.done ? (
                      <button
                        onClick={() => cancelUpload(u.id)}
                        className="text-muted-foreground hover:text-destructive"
                        aria-label="Cancel upload"
                        title="Cancel"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Progress value={u.done ? 100 : pct} className="h-1.5 flex-1" />
                    <span className="tabular-nums text-xs w-9 text-right text-muted-foreground">
                      {u.error ? "err" : u.done ? "100%" : `${pct}%`}
                    </span>
                  </div>
                  {u.progress && u.progress.totalParts > 1 && !u.done && !u.error && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      Part {u.progress.partIndex}/{u.progress.totalParts}
                    </div>
                  )}
                  {u.error && <div className="mt-1 text-xs text-destructive">{u.error}</div>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Drag overlay */}
      {dragActive && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur pointer-events-none">
          <div className="rounded-3xl border-2 border-dashed border-primary px-16 py-14 text-center">
            <Upload className="h-12 w-12 mx-auto text-primary mb-4" />
            <p className="text-2xl font-bold">Drop to upload</p>
            <p className="text-base text-muted-foreground mt-2">
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
      <div className="flex flex-col items-center justify-center py-32 text-center">
        <div className="h-20 w-20 rounded-3xl bg-muted flex items-center justify-center mb-5">
          <Search className="h-9 w-9 text-muted-foreground" />
        </div>
        <h2 className="text-2xl font-bold">No results for "{searchQuery}"</h2>
        <p className="text-base text-muted-foreground mt-2 max-w-sm">
          Try a different search term or clear the search to browse all files.
        </p>
        <Button variant="outline" className="mt-6 h-11 px-6 rounded-xl text-base" onClick={onClearSearch}>
          <X className="h-4 w-4 mr-2" />
          Clear search
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center justify-center py-32 text-center">
      <div className="h-20 w-20 rounded-3xl bg-primary/10 text-primary flex items-center justify-center mb-5">
        {isRoot ? <PackageOpen className="h-9 w-9" /> : <Folder className="h-9 w-9" />}
      </div>
      <h2 className="text-2xl font-bold">
        {isRoot ? "Your vault is empty" : "This folder is empty"}
      </h2>
      <p className="text-base text-muted-foreground mt-2 max-w-sm">
        Drop files anywhere on this page, or tap Upload. Everything goes into your private
        Telegram group.
      </p>
      <div className="mt-6 flex gap-3">
        <Button variant="outline" onClick={onNewFolder} className="h-11 px-5 rounded-xl text-base">
          <FolderPlus className="h-5 w-5 mr-2" />
          New Folder
        </Button>
        <Button onClick={onPick} className="h-11 px-5 rounded-xl text-base">
          <Upload className="h-5 w-5 mr-2" />
          Upload files
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
    <div className="group relative rounded-2xl border border-border bg-card overflow-hidden hover:border-primary/50 hover:bg-card/80 active:scale-95 transition-all cursor-pointer">
      <button onClick={onOpen} className="block w-full text-left">
        <div className="aspect-square bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center">
          <Folder className="h-14 w-14 text-primary/70" />
        </div>
        <div className="p-3">
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
              className="w-full text-sm font-semibold bg-transparent border-b-2 border-primary outline-none"
            />
          ) : (
            <div className="text-sm font-semibold truncate">{folder.name}</div>
          )}
          <div className="mt-0.5 text-xs text-muted-foreground">Folder</div>
        </div>
      </button>
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              className="h-8 w-8 flex items-center justify-center rounded-lg bg-background/80 backdrop-blur border border-border text-muted-foreground hover:text-foreground"
              aria-label="Folder actions"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="text-base">
            <DropdownMenuItem onClick={onDownload} disabled={isDownloading} className="py-2.5">
              {isDownloading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              {isDownloading ? "Preparing ZIP…" : "Download as ZIP"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onRename} className="py-2.5">
              <Pencil className="h-4 w-4 mr-2" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onDelete}
              className="text-destructive focus:text-destructive py-2.5"
            >
              <Trash2 className="h-4 w-4 mr-2" />
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
      className={`group relative rounded-xl border bg-card overflow-hidden transition-all active:scale-95 ${
        selected ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary/40"
      }`}
    >
      {/* Checkbox overlay */}
      <div
        className={`absolute top-2 left-2 z-10 transition-opacity ${
          selected || anySelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
          className="h-7 w-7 flex items-center justify-center rounded-lg bg-background/80 backdrop-blur border-2 border-border"
          aria-label="Select file"
        >
          <Checkbox checked={selected} onCheckedChange={onSelect} className="pointer-events-none" />
        </button>
      </div>

      <button onClick={onOpen} className="block w-full text-left">
        {/* Square thumbnail — tighter for gallery feel */}
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
            <Icon className="h-10 w-10 text-muted-foreground/60" />
          )}
          {!hasThumb && (
            <div className="absolute bottom-2 left-2 text-[10px] font-mono uppercase tracking-wider text-muted-foreground bg-background/70 px-1.5 py-0.5 rounded-md">
              {file.kind}
            </div>
          )}
          {/* Video play indicator */}
          {file.kind === "video" && hasThumb && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="h-8 w-8 rounded-full bg-black/50 flex items-center justify-center">
                <Film className="h-4 w-4 text-white" />
              </div>
            </div>
          )}
        </div>
        <div className="px-2 py-2">
          <div className="text-sm font-medium truncate leading-tight">{file.filename}</div>
          <div className="mt-0.5 flex items-center justify-between text-xs tabular-nums text-muted-foreground">
            <span>{formatBytes(Number(file.size_bytes))}</span>
            <span>{formatDate(file.created_at)}</span>
          </div>
        </div>
      </button>

      {/* Action buttons — show on hover */}
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <a
          href={vaultUrl(`/api/files/${file.id}/stream?dl=1`)}
          className="h-8 w-8 flex items-center justify-center rounded-lg bg-background/80 backdrop-blur border border-border text-muted-foreground hover:text-foreground"
          aria-label="Download"
        >
          <Download className="h-4 w-4" />
        </a>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onMove();
          }}
          className="h-8 w-8 flex items-center justify-center rounded-lg bg-background/80 backdrop-blur border border-border text-muted-foreground hover:text-foreground"
          aria-label="Move"
        >
          <FolderInput className="h-4 w-4" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="h-8 w-8 flex items-center justify-center rounded-lg bg-background/80 backdrop-blur border border-border text-muted-foreground hover:text-destructive"
          aria-label="Delete"
        >
          <Trash2 className="h-4 w-4" />
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
    <div className="rounded-2xl border border-border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-sm text-muted-foreground">
          <tr>
            <th className="px-4 py-3 w-10">
              <button
                onClick={onSelectAll}
                aria-label="Select all files"
                title={allSelected ? "Deselect all" : "Select all"}
              >
                <CheckSquare
                  className={`h-5 w-5 ${allSelected ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
                />
              </button>
            </th>
            <th className="text-left px-4 py-3 font-semibold">Name</th>
            <th className="text-left px-4 py-3 font-semibold w-24 hidden sm:table-cell">Kind</th>
            <th className="text-right px-4 py-3 font-semibold w-24 tabular-nums hidden sm:table-cell">Size</th>
            <th className="text-right px-4 py-3 font-semibold w-32 tabular-nums">Added</th>
            <th className="w-32" />
          </tr>
        </thead>
        <tbody>
          {/* Folders */}
          {folders.map((f) => (
            <tr
              key={`folder-${f.id}`}
              className="border-t border-border hover:bg-muted/20 cursor-pointer transition-colors"
              onClick={() => onOpenFolder(f.id)}
            >
              <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                {/* Folders not selectable */}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Folder className="h-5 w-5 shrink-0 text-primary/70" />
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
                      className="flex-1 bg-transparent border-b-2 border-primary outline-none text-base font-medium"
                    />
                  ) : (
                    <span className="truncate font-semibold text-base">{f.name}</span>
                  )}
                </div>
              </td>
              <td className="px-4 py-3 text-sm uppercase tracking-wider text-muted-foreground hidden sm:table-cell">
                folder
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-muted-foreground hidden sm:table-cell">—</td>
              <td className="px-4 py-3 text-right tabular-nums text-muted-foreground text-sm">
                {formatDate(f.created_at)}
              </td>
              <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-end gap-1.5">
                  <button
                    onClick={() => onDownloadFolder(f.id, f.name)}
                    disabled={folderDownloading === f.id}
                    className="h-9 w-9 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50 transition-colors"
                    aria-label="Download folder as ZIP"
                    title="Download as ZIP"
                  >
                    {folderDownloading === f.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    onClick={() => onRenameFolder(f.id, f.name)}
                    className="h-9 w-9 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    aria-label="Rename folder"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => onDeleteFolder(f.id, f.name)}
                    className="h-9 w-9 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-muted transition-colors"
                    aria-label="Delete folder"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {/* Files */}
          {files.map((f) => {
            const Icon = kindIcon(f.kind);
            const isSelected = selectedIds.has(f.id);
            return (
              <tr
                key={f.id}
                className={`border-t border-border hover:bg-muted/20 cursor-pointer transition-colors ${isSelected ? "bg-primary/5" : ""}`}
                onClick={() => onOpenFile(f.id)}
              >
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => onSelectFile(f.id)}
                    aria-label={`Select ${f.filename}`}
                    className="h-5 w-5"
                  />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
                    <span className="truncate text-base font-medium">{f.filename}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm uppercase tracking-wider text-muted-foreground hidden sm:table-cell">
                  {f.kind}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground hidden sm:table-cell">
                  {formatBytes(Number(f.size_bytes))}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground text-sm">
                  {formatDate(f.created_at)}
                </td>
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end gap-1.5">
                    <a
                      href={vaultUrl(`/api/files/${f.id}/stream?dl=1`)}
                      className="h-9 w-9 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      aria-label="Download"
                    >
                      <Download className="h-4 w-4" />
                    </a>
                    <button
                      onClick={() => onMoveFile(f.id)}
                      className="h-9 w-9 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      aria-label="Move"
                    >
                      <FolderInput className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => onDeleteFile(f.id, f.filename)}
                      className="h-9 w-9 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-muted transition-colors"
                      aria-label="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
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
