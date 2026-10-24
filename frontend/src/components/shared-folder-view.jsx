import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Folder, FolderPlus, Upload, Download, Search, LayoutGrid, List, Eye, FileText, Image as ImageIcon, Film, Music, Archive, File as FileIcon, X, Loader2, CheckCircle2, AlertCircle, Clock, ShieldCheck, ShieldAlert, ArrowDownToLine, RefreshCw, ChevronRight, ChevronLeft, Home, CheckSquare, Square, ArrowUpDown, } from "lucide-react";
import { formatBytes, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { uploadFileShared, DuplicateFileError } from "@/lib/upload-shared";
const KIND_FILTERS = [
    { key: "all", label: "All", Icon: LayoutGrid },
    { key: "image", label: "Photos", Icon: ImageIcon },
    { key: "video", label: "Videos", Icon: Film },
    { key: "audio", label: "Audio", Icon: Music },
    { key: "pdf", label: "PDFs", Icon: FileText },
    { key: "archive", label: "Archives", Icon: Archive },
    { key: "other", label: "Other", Icon: FileIcon },
];
export function SharedFolderView({ token }) {
    const [data, setData] = useState(null);
    const [currentFolderId, setCurrentFolderId] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    // Search & Filter state
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedKind, setSelectedKind] = useState("all");
    const [sortKey, setSortKey] = useState("created_desc");
    const [viewMode, setViewMode] = useState("grid");
    // Selection state
    const [selectedIds, setSelectedIds] = useState(new Set());
    // ZIP download states
    const [bulkDownloading, setBulkDownloading] = useState(false);
    const [folderDownloading, setFolderDownloading] = useState(null);
    // Preview state
    const [previewFile, setPreviewFile] = useState(null);
    // New folder dialog state
    const [newFolderOpen, setNewFolderOpen] = useState(false);
    const [newFolderName, setNewFolderName] = useState("");
    const [creatingFolder, setCreatingFolder] = useState(false);
    // Upload state
    const [uploads, setUploads] = useState([]);
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef(null);
    const fetchFolder = useCallback(async (folderId, activeSort = sortKey, activeKind = selectedKind) => {
        try {
            setLoading(true);
            setError(null);
            const queryParams = new URLSearchParams();
            if (folderId)
                queryParams.set("folder_id", folderId);
            if (activeSort)
                queryParams.set("sort", activeSort);
            if (activeKind && activeKind !== "all")
                queryParams.set("kind", activeKind);
            const res = await fetch(`/api/shares/${token}?${queryParams.toString()}`);
            if (!res.ok) {
                if (res.status === 404) {
                    setError("This shared link does not exist, has expired, or was revoked.");
                }
                else {
                    setError(`Unable to access folder (HTTP ${res.status})`);
                }
                return;
            }
            const json = (await res.json());
            setData(json);
        }
        catch {
            setError("Failed to connect to the server. Please check your internet connection.");
        }
        finally {
            setLoading(false);
        }
    }, [token, sortKey, selectedKind]);
    useEffect(() => {
        fetchFolder(currentFolderId, sortKey, selectedKind);
    }, [fetchFolder, currentFolderId, sortKey, selectedKind]);
    // Navigate folder helper
    const navigateToFolder = (folderId) => {
        setSearchQuery("");
        setSelectedIds(new Set());
        setData((prev) => (prev ? { ...prev, folders: [], files: [] } : prev));
        setCurrentFolderId(folderId);
    };
    // Create Subfolder
    const handleCreateFolder = async (e) => {
        e.preventDefault();
        const name = newFolderName.trim();
        if (!name)
            return;
        setCreatingFolder(true);
        try {
            const activeFolderId = currentFolderId || data?.rootFolder.id;
            const res = await fetch(`/api/shares/${token}/create-folder`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    name,
                    parent_id: activeFolderId,
                }),
            });
            if (!res.ok) {
                const body = (await res.json().catch(() => ({})));
                throw new Error(body.error || "Failed to create folder");
            }
            toast.success(`Folder "${name}" created`);
            setNewFolderOpen(false);
            setNewFolderName("");
            fetchFolder(currentFolderId);
        }
        catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to create folder");
        }
        finally {
            setCreatingFolder(false);
        }
    };
    // Handle uploading files
    const handleFiles = useCallback(async (fileList) => {
        if (!data?.permissions.allow_upload) {
            toast.error("Uploads are not permitted on this shared link.");
            return;
        }
        const filesToAdd = Array.from(fileList);
        if (filesToAdd.length === 0)
            return;
        const targetFolderId = currentFolderId || data.rootFolder.id;
        const newUploads = filesToAdd.map((file) => ({
            id: `${file.name}-${file.size}-${Date.now()}-${Math.random()}`,
            file,
            targetFolderId,
            progress: {
                loaded: 0,
                total: file.size,
                partIndex: 1,
                totalParts: Math.max(1, Math.ceil(file.size / (19 * 1024 * 1024))),
                phase: "uploading",
            },
            done: false,
            controller: new AbortController(),
        }));
        setUploads((prev) => [...newUploads, ...prev]);
        // Upload files sequentially
        for (const item of newUploads) {
            try {
                await uploadFileShared(token, item.file, (progress) => {
                    setUploads((prev) => prev.map((u) => (u.id === item.id ? { ...u, progress } : u)));
                }, targetFolderId, item.controller.signal);
                setUploads((prev) => prev.map((u) => (u.id === item.id ? { ...u, done: true } : u)));
                toast.success(`Uploaded "${item.file.name}"`);
                fetchFolder(currentFolderId);
            }
            catch (err) {
                if (err instanceof DuplicateFileError) {
                    setUploads((prev) => prev.map((u) => (u.id === item.id ? { ...u, error: err.message } : u)));
                    toast.error(err.message);
                }
                else if (err instanceof Error && err.name === "AbortError") {
                    setUploads((prev) => prev.filter((u) => u.id !== item.id));
                }
                else {
                    const msg = err instanceof Error ? err.message : "Upload failed";
                    setUploads((prev) => prev.map((u) => (u.id === item.id ? { ...u, error: msg } : u)));
                    toast.error(`Upload error: ${msg}`);
                }
            }
        }
    }, [data?.permissions.allow_upload, data?.rootFolder.id, currentFolderId, fetchFolder, token]);
    // Drag and drop listeners
    const onDragOver = (e) => {
        e.preventDefault();
        if (data?.permissions.allow_upload) {
            setIsDragging(true);
        }
    };
    const onDragLeave = (e) => {
        e.preventDefault();
        setIsDragging(false);
    };
    const onDrop = (e) => {
        e.preventDefault();
        setIsDragging(false);
        if (!data?.permissions.allow_upload)
            return;
        if (e.dataTransfer.files?.length) {
            handleFiles(e.dataTransfer.files);
        }
    };
    // Filtered lists
    const filteredFolders = useMemo(() => {
        if (!data?.folders)
            return [];
        if (selectedKind !== "all")
            return []; // folders hidden when filtering by specific file kind
        if (!searchQuery.trim())
            return data.folders;
        const q = searchQuery.toLowerCase();
        return data.folders.filter((f) => f.name.toLowerCase().includes(q));
    }, [data?.folders, searchQuery, selectedKind]);
    const filteredFiles = useMemo(() => {
        if (!data?.files)
            return [];
        let list = data.files;
        if (selectedKind !== "all") {
            list = list.filter((f) => f.kind === selectedKind);
        }
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            list = list.filter((f) => f.filename.toLowerCase().includes(q));
        }
        return list;
    }, [data?.files, searchQuery, selectedKind]);
    // Selection helpers
    const toggleSelect = (id) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id))
                next.delete(id);
            else
                next.add(id);
            return next;
        });
    };
    const selectAll = () => {
        if (selectedIds.size === filteredFiles.length && filteredFiles.length > 0) {
            setSelectedIds(new Set());
        }
        else {
            setSelectedIds(new Set(filteredFiles.map((f) => f.id)));
        }
    };
    const clearSelection = () => {
        setSelectedIds(new Set());
    };
    const allSelected = filteredFiles.length > 0 && selectedIds.size === filteredFiles.length;
    // Single file download
    const handleDownload = (file) => {
        if (!data?.permissions.allow_download) {
            toast.error("Downloads are disabled for this shared folder.");
            return;
        }
        const downloadUrl = `/api/shares/${token}/files/${file.id}/stream?dl=1`;
        const a = document.createElement("a");
        a.href = downloadUrl;
        a.download = file.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };
    // Bulk ZIP download
    const handleBulkDownload = async () => {
        if (!data?.permissions.allow_download) {
            toast.error("Downloads are disabled for this shared folder.");
            return;
        }
        const ids = Array.from(selectedIds);
        if (ids.length === 0)
            return;
        setBulkDownloading(true);
        try {
            const res = await fetch(`/api/shares/${token}/download-zip`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ ids }),
            });
            if (!res.ok) {
                throw new Error(`ZIP generation failed (HTTP ${res.status})`);
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${data.currentFolder.name}-${ids.length}-files.zip`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            toast.success(`Downloaded ${ids.length} file${ids.length !== 1 ? "s" : ""} as ZIP`);
        }
        catch (err) {
            toast.error(err instanceof Error ? err.message : "ZIP download failed");
        }
        finally {
            setBulkDownloading(false);
        }
    };
    // Folder ZIP download (current folder or subfolder)
    const handleFolderDownload = async (folderId, folderName) => {
        if (!data?.permissions.allow_download) {
            toast.error("Downloads are disabled for this shared folder.");
            return;
        }
        setFolderDownloading(folderId);
        try {
            const res = await fetch(`/api/shares/${token}/download-zip`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ folderId }),
            });
            if (!res.ok) {
                if (res.status === 404) {
                    toast.info(`"${folderName}" has no downloadable files.`);
                    return;
                }
                throw new Error(`Folder ZIP failed (HTTP ${res.status})`);
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${folderName}.zip`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            toast.success(`Downloaded folder "${folderName}" as ZIP`);
        }
        catch (err) {
            toast.error(err instanceof Error ? err.message : "Folder ZIP download failed");
        }
        finally {
            setFolderDownloading(null);
        }
    };
    if (loading && !data) {
        return (<div className="min-h-screen flex flex-col items-center justify-center bg-background text-foreground gap-4">
        <div className="relative">
          <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center animate-pulse">
            <Folder className="h-8 w-8 text-primary"/>
          </div>
          <Loader2 className="h-6 w-6 text-primary animate-spin absolute -bottom-1 -right-1"/>
        </div>
        <div className="text-center">
          <h2 className="text-xl font-semibold tracking-tight">Accessing Shared Folder</h2>
          <p className="text-sm text-muted-foreground mt-1">Verifying link credentials…</p>
        </div>
      </div>);
    }
    if (error || !data) {
        return (<div className="min-h-screen flex flex-col items-center justify-center bg-background text-foreground px-4">
        <div className="w-full max-w-md text-center p-8 rounded-2xl border border-border bg-card/60 backdrop-blur shadow-xl">
          <div className="mx-auto h-16 w-16 rounded-2xl bg-destructive/10 flex items-center justify-center text-destructive mb-5">
            <ShieldAlert className="h-8 w-8"/>
          </div>
          <h2 className="text-2xl font-bold tracking-tight mb-2">Folder Unavailable</h2>
          <p className="text-sm text-muted-foreground leading-relaxed mb-6">
            {error || "This shared link is invalid or has expired."}
          </p>
          <Button variant="outline" onClick={() => fetchFolder(currentFolderId)} className="gap-2">
            <RefreshCw className="h-4 w-4"/> Try Again
          </Button>
        </div>
      </div>);
    }
    const activeUploadsCount = uploads.filter((u) => !u.done && !u.error).length;
    const isInsideSubfolder = data.currentFolder.id !== data.rootFolder.id;
    return (<div className="min-h-screen bg-background text-foreground flex flex-col relative" onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => {
            if (e.target.files)
                handleFiles(e.target.files);
            e.target.value = "";
        }}/>

      {/* Drag overlay */}
      {isDragging && data.permissions.allow_upload && (<div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur border-4 border-dashed border-primary">
          <div className="text-center p-8 rounded-2xl bg-card border border-border shadow-2xl">
            <Upload className="h-16 w-16 mx-auto text-primary animate-bounce mb-4"/>
            <p className="text-2xl font-bold">Drop files to upload</p>
            <p className="text-sm text-muted-foreground mt-2">
              Uploading into{" "}
              <span className="font-semibold text-foreground">{data.currentFolder.name}</span>
            </p>
          </div>
        </div>)}

      {/* Top Header */}
      <header className="sticky top-0 z-30 border-b border-border bg-card/85 backdrop-blur-md shadow-xs">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center shrink-0 border border-primary/20 shadow-xs">
              <Folder className="h-6 w-6 text-primary"/>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold truncate text-foreground">{data.rootFolder.name}</h1>
                <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-muted text-muted-foreground border border-border shrink-0">
                  Shared
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                <span className="flex items-center gap-1">
                  <ShieldCheck className="h-3.5 w-3.5 text-primary"/>
                  {data.permissions.allow_upload && data.permissions.allow_download
            ? "View, Download & Upload"
            : data.permissions.allow_upload
                ? "Upload only"
                : "View & Download"}
                </span>
                {data.expires_at && (<span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5 text-amber-500"/>
                    Expires {formatDate(data.expires_at)}
                  </span>)}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto flex-wrap sm:flex-nowrap">
            {/* Download Entire/Current Folder as ZIP */}
            {data.permissions.allow_download && (<Button variant="outline" size="sm" onClick={() => handleFolderDownload(currentFolderId || data.rootFolder.id, data.currentFolder.name)} disabled={folderDownloading === (currentFolderId || data.rootFolder.id)} className="gap-2 font-medium h-9 rounded-xl" title={`Download "${data.currentFolder.name}" as ZIP`}>
                {folderDownloading === (currentFolderId || data.rootFolder.id) ? (<Loader2 className="h-4 w-4 animate-spin text-primary"/>) : (<Download className="h-4 w-4 text-primary"/>)}
                <span>
                  {folderDownloading === (currentFolderId || data.rootFolder.id)
                ? "Preparing ZIP…"
                : "Download Folder (ZIP)"}
                </span>
              </Button>)}

            {data.permissions.allow_upload && (<>
                <Button variant="outline" size="sm" onClick={() => setNewFolderOpen(true)} className="gap-2 font-medium h-9 rounded-xl">
                  <FolderPlus className="h-4 w-4"/>
                  New Folder
                </Button>
                <Button size="sm" onClick={() => fileInputRef.current?.click()} className="gap-2 font-medium h-9 rounded-xl flex-1 sm:flex-initial">
                  <Upload className="h-4 w-4"/>
                  Upload
                </Button>
              </>)}
          </div>
        </div>

        {/* Breadcrumb Navigation Bar */}
        <div className="border-t border-border/60 bg-muted/20 px-4 sm:px-6 py-2">
          <div className="mx-auto max-w-7xl flex items-center gap-1 text-sm overflow-x-auto">
            <button onClick={() => navigateToFolder(null)} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-colors hover:bg-muted ${!isInsideSubfolder
            ? "text-foreground font-semibold"
            : "text-muted-foreground hover:text-foreground"}`}>
              <Home className="h-4 w-4"/>
              <span>{data.rootFolder.name}</span>
            </button>

            {data.breadcrumbs.map((crumb) => {
            if (crumb.id === data.rootFolder.id)
                return null;
            const isCurrent = crumb.id === data.currentFolder.id;
            return (<span key={crumb.id} className="flex items-center gap-1 shrink-0">
                  <ChevronRight className="h-4 w-4 text-muted-foreground"/>
                  <button onClick={() => navigateToFolder(crumb.id)} className={`px-2 py-1 rounded-lg transition-colors hover:bg-muted ${isCurrent
                    ? "text-foreground font-semibold"
                    : "text-muted-foreground hover:text-foreground"}`}>
                    {crumb.name}
                  </button>
                </span>);
        })}
          </div>
        </div>

        {/* Kind chips (same as admin console) */}
        <div className="border-t border-border/60 bg-muted/10 px-4 sm:px-6 py-2">
          <div className="mx-auto max-w-7xl flex items-center gap-2 overflow-x-auto scrollbar-none">
            {KIND_FILTERS.map(({ key, label, Icon }) => {
            const active = selectedKind === key;
            return (<button key={key} onClick={() => setSelectedKind(key)} className={`shrink-0 flex items-center gap-1.5 rounded-full px-3.5 py-1 text-xs font-medium border transition-all active:scale-95 ${active
                    ? "border-primary/50 bg-primary/15 text-primary shadow-xs"
                    : "border-border text-muted-foreground hover:text-foreground hover:border-border hover:bg-muted/40"}`}>
                  <Icon className="h-3.5 w-3.5"/>
                  <span>{label}</span>
                </button>);
        })}
          </div>
        </div>

        {/* Search, Sort & View controls bar */}
        <div className="border-t border-border/60 bg-card/60 px-4 sm:px-6 py-2.5">
          <div className="mx-auto max-w-7xl flex items-center justify-between gap-3">
            {/* Search Input */}
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"/>
              <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder={`Search in ${data.currentFolder.name}…`} className="pl-9 h-9 text-sm bg-card/60 rounded-xl"/>
              {searchQuery && (<button onClick={() => setSearchQuery("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5"/>
                </button>)}
            </div>

            <div className="flex items-center gap-2">
              {/* Sort Selector */}
              <div className="relative flex items-center">
                <ArrowUpDown className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted-foreground"/>
                <select value={sortKey} onChange={(e) => setSortKey(e.target.value)} className="h-9 rounded-xl border border-border bg-card pl-8 pr-7 text-xs font-medium text-foreground outline-none hover:bg-muted/30 transition-colors cursor-pointer appearance-none" aria-label="Sort by">
                  <option value="created_desc">Newest</option>
                  <option value="created_asc">Oldest</option>
                  <option value="name_asc">Name A→Z</option>
                  <option value="name_desc">Name Z→A</option>
                  <option value="size_desc">Largest</option>
                  <option value="size_asc">Smallest</option>
                </select>
              </div>

              {/* View mode toggle */}
              <div className="flex items-center rounded-xl border border-border bg-card p-0.5">
                <button onClick={() => setViewMode("grid")} className={`p-1.5 rounded-lg transition-colors ${viewMode === "grid"
            ? "bg-primary text-primary-foreground shadow-xs"
            : "text-muted-foreground hover:text-foreground"}`} aria-label="Grid view">
                  <LayoutGrid className="h-4 w-4"/>
                </button>
                <button onClick={() => setViewMode("table")} className={`p-1.5 rounded-lg transition-colors ${viewMode === "table"
            ? "bg-primary text-primary-foreground shadow-xs"
            : "text-muted-foreground hover:text-foreground"}`} aria-label="Table view">
                  <List className="h-4 w-4"/>
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 mx-auto max-w-7xl w-full px-4 sm:px-6 py-6 pb-28">
        {loading && data ? (<div className="flex flex-col items-center justify-center py-24 text-muted-foreground gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary"/>
            <span className="text-sm">Loading folder…</span>
          </div>) : filteredFolders.length === 0 && filteredFiles.length === 0 ? (<div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="h-16 w-16 rounded-2xl bg-muted/60 flex items-center justify-center text-muted-foreground mb-4">
              <Folder className="h-8 w-8"/>
            </div>
            <h3 className="text-lg font-semibold text-foreground">
              {searchQuery
                ? "No matching items"
                : selectedKind !== "all"
                    ? `No ${selectedKind} files found`
                    : "This folder is empty"}
            </h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              {searchQuery
                ? `No items matching "${searchQuery}". Clear search to view all contents.`
                : selectedKind !== "all"
                    ? "Try switching to 'All' or picking a different category."
                    : data.permissions.allow_upload
                        ? "Drag and drop files here, create a subfolder, or click the upload button to get started."
                        : "No files or subfolders have been added to this location yet."}
            </p>
            {data.permissions.allow_upload && !searchQuery && selectedKind === "all" && (<div className="flex gap-2.5 mt-5">
                <Button variant="outline" onClick={() => setNewFolderOpen(true)} className="gap-2">
                  <FolderPlus className="h-4 w-4"/> New Folder
                </Button>
                <Button onClick={() => fileInputRef.current?.click()} className="gap-2">
                  <Upload className="h-4 w-4"/> Upload Files
                </Button>
              </div>)}
          </div>) : (<div className="space-y-6">
            {/* Subfolders Section */}
            {filteredFolders.length > 0 && (<div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Folder className="h-4 w-4 text-primary"/>
                    <h2 className="text-sm font-semibold text-foreground">Folders</h2>
                    <span className="text-xs text-muted-foreground">({filteredFolders.length})</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3.5">
                  {filteredFolders.map((subfolder) => {
                    const isDownloadingThis = folderDownloading === subfolder.id;
                    return (<div key={subfolder.id} onClick={() => navigateToFolder(subfolder.id)} className="group relative rounded-2xl border border-border bg-card overflow-hidden hover:border-primary/50 hover:bg-card/90 transition-all cursor-pointer p-4 flex flex-col justify-between shadow-xs">
                        <div className="aspect-square rounded-xl bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
                          <Folder className="h-10 w-10 text-primary/80"/>
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold truncate text-foreground" title={subfolder.name}>
                            {subfolder.name}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">Folder</p>
                        </div>

                        {/* Subfolder ZIP download button */}
                        {data.permissions.allow_download && (<div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={(e) => {
                                e.stopPropagation();
                                handleFolderDownload(subfolder.id, subfolder.name);
                            }} disabled={isDownloadingThis} className="h-8 w-8 flex items-center justify-center rounded-lg bg-background/85 backdrop-blur border border-border text-muted-foreground hover:text-foreground hover:border-primary shadow-xs transition-colors" title="Download as ZIP">
                              {isDownloadingThis ? (<Loader2 className="h-4 w-4 animate-spin text-primary"/>) : (<Download className="h-4 w-4"/>)}
                            </button>
                          </div>)}
                      </div>);
                })}
                </div>
              </div>)}

            {/* Files Section */}
            {filteredFiles.length > 0 && (<div>
                {/* Section header & Select-all bar */}
                <div className="flex items-center justify-between mb-3 px-1">
                  <div className="flex items-center gap-2">
                    <FileIcon className="h-4 w-4 text-muted-foreground"/>
                    <h2 className="text-sm font-semibold text-foreground">Files</h2>
                    <span className="text-xs text-muted-foreground">({filteredFiles.length})</span>
                  </div>

                  <button onClick={selectAll} className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors group cursor-pointer">
                    <div className={`h-4 w-4 rounded border flex items-center justify-center transition-colors ${allSelected
                    ? "bg-primary border-primary text-primary-foreground"
                    : selectedIds.size > 0
                        ? "bg-primary/30 border-primary"
                        : "border-border group-hover:border-primary/60"}`}>
                      {allSelected && <CheckSquare className="h-3 w-3 stroke-[3]"/>}
                    </div>
                    <span>{allSelected ? "Deselect all" : `Select all (${filteredFiles.length})`}</span>
                  </button>
                </div>

                {viewMode === "grid" ? (<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3.5">
                    {filteredFiles.map((file) => (<FileGridCard key={file.id} file={file} token={token} isSelected={selectedIds.has(file.id)} hasSelection={selectedIds.size > 0} allowDownload={data.permissions.allow_download} onToggleSelect={() => toggleSelect(file.id)} onPreview={() => setPreviewFile(file)} onDownload={() => handleDownload(file)}/>))}
                  </div>) : (<div className="rounded-xl border border-border bg-card overflow-hidden shadow-xs">
                    <table className="w-full text-left text-sm border-collapse">
                      <thead>
                        <tr className="border-b border-border bg-muted/30 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          <th className="px-4 py-3 w-10">
                            <button onClick={selectAll} className="flex items-center justify-center text-muted-foreground hover:text-foreground" title={allSelected ? "Deselect all" : "Select all"}>
                              {allSelected ? (<CheckSquare className="h-4 w-4 text-primary"/>) : (<Square className="h-4 w-4"/>)}
                            </button>
                          </th>
                          <th className="px-4 py-3">Name</th>
                          <th className="px-4 py-3 hidden sm:table-cell">Type</th>
                          <th className="px-4 py-3 text-right hidden sm:table-cell">Size</th>
                          <th className="px-4 py-3 text-right">Modified</th>
                          <th className="px-4 py-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {/* Subfolders in table view */}
                        {filteredFolders.map((subfolder) => {
                        const isDownloadingThis = folderDownloading === subfolder.id;
                        return (<tr key={`folder-${subfolder.id}`} onClick={() => navigateToFolder(subfolder.id)} className="hover:bg-muted/30 cursor-pointer transition-colors bg-muted/5">
                              <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                                <Folder className="h-4 w-4 text-primary"/>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-3 min-w-0">
                                  <span className="font-semibold text-foreground truncate max-w-xs sm:max-w-md">
                                    {subfolder.name}
                                  </span>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground hidden sm:table-cell">
                                folder
                              </td>
                              <td className="px-4 py-3 text-right tabular-nums text-muted-foreground hidden sm:table-cell">
                                —
                              </td>
                              <td className="px-4 py-3 text-right tabular-nums text-xs text-muted-foreground">
                                {formatDate(subfolder.created_at)}
                              </td>
                              <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                                <div className="flex items-center justify-end gap-1.5">
                                  {data.permissions.allow_download && (<button onClick={() => handleFolderDownload(subfolder.id, subfolder.name)} disabled={isDownloadingThis} className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title="Download as ZIP">
                                      {isDownloadingThis ? (<Loader2 className="h-4 w-4 animate-spin text-primary"/>) : (<Download className="h-4 w-4"/>)}
                                    </button>)}
                                  <ChevronRight className="h-4 w-4 text-muted-foreground inline"/>
                                </div>
                              </td>
                            </tr>);
                    })}

                        {/* Files in table view */}
                        {filteredFiles.map((file) => {
                        const isSelected = selectedIds.has(file.id);
                        return (<tr key={file.id} onClick={() => setPreviewFile(file)} className={`hover:bg-muted/30 cursor-pointer transition-colors ${isSelected ? "bg-primary/5" : ""}`}>
                              <td className="px-4 py-3" onClick={(e) => {
                                e.stopPropagation();
                                toggleSelect(file.id);
                            }}>
                                <Checkbox checked={isSelected} onCheckedChange={() => toggleSelect(file.id)} aria-label={`Select ${file.filename}`} className="h-4 w-4"/>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-3 min-w-0">
                                  <FileKindIcon kind={file.kind} className="h-5 w-5 shrink-0 text-muted-foreground"/>
                                  <span className="font-medium text-foreground truncate max-w-xs sm:max-w-md">
                                    {file.filename}
                                  </span>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground hidden sm:table-cell">
                                {file.kind}
                              </td>
                              <td className="px-4 py-3 text-right tabular-nums text-muted-foreground hidden sm:table-cell">
                                {formatBytes(Number(file.size_bytes))}
                              </td>
                              <td className="px-4 py-3 text-right tabular-nums text-xs text-muted-foreground">
                                {formatDate(file.created_at)}
                              </td>
                              <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                                <div className="flex items-center justify-end gap-1.5">
                                  <button onClick={() => setPreviewFile(file)} className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title="Preview">
                                    <Eye className="h-4 w-4"/>
                                  </button>
                                  {data.permissions.allow_download && (<button onClick={() => handleDownload(file)} className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title="Download">
                                      <Download className="h-4 w-4"/>
                                    </button>)}
                                </div>
                              </td>
                            </tr>);
                    })}
                      </tbody>
                    </table>
                  </div>)}
              </div>)}
          </div>)}
      </main>

      {/* Bulk Action Bar (fixed at bottom when items selected) */}
      {selectedIds.size > 0 && (<div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card/95 backdrop-blur-md shadow-2xl animate-in slide-in-from-bottom-5 duration-200">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-foreground tabular-nums">
                {selectedIds.size} file{selectedIds.size !== 1 ? "s" : ""} selected
              </span>
              <button onClick={clearSelection} className="text-xs text-muted-foreground hover:text-foreground underline transition-colors">
                Clear
              </button>
            </div>

            <div className="flex items-center gap-2">
              {data.permissions.allow_download && (<Button size="sm" onClick={handleBulkDownload} disabled={bulkDownloading} className="gap-2 font-medium rounded-xl shadow-xs">
                  {bulkDownloading ? (<Loader2 className="h-4 w-4 animate-spin"/>) : (<Download className="h-4 w-4"/>)}
                  <span>
                    {bulkDownloading
                    ? "Preparing ZIP…"
                    : `Download ${selectedIds.size} as ZIP`}
                  </span>
                </Button>)}
              <Button size="sm" variant="ghost" onClick={clearSelection} className="h-9 w-9 p-0 rounded-xl" aria-label="Clear selection">
                <X className="h-4 w-4"/>
              </Button>
            </div>
          </div>
        </div>)}

      {/* New Folder Dialog */}
      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Folder</DialogTitle>
            <DialogDescription>
              Create a new folder inside{" "}
              <span className="font-semibold text-foreground">{data.currentFolder.name}</span>.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateFolder} className="space-y-4 pt-2">
            <Input value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} placeholder="Folder name" autoFocus required/>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setNewFolderOpen(false)} disabled={creatingFolder}>
                Cancel
              </Button>
              <Button type="submit" disabled={creatingFolder || !newFolderName.trim()}>
                {creatingFolder ? (<>
                    <Loader2 className="h-4 w-4 animate-spin mr-1.5"/> Creating…
                  </>) : ("Create Folder")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Active Uploads Drawer */}
      {uploads.length > 0 && (<aside className="fixed bottom-4 right-4 z-40 w-96 max-w-[calc(100vw-2rem)] rounded-2xl border border-border bg-card/95 backdrop-blur-md shadow-2xl p-4">
          <div className="flex items-center justify-between pb-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Upload className="h-4 w-4 text-primary"/>
              <span className="text-sm font-semibold">
                Uploads ({uploads.filter((u) => u.done).length}/{uploads.length})
              </span>
            </div>
            {activeUploadsCount === 0 && (<button onClick={() => setUploads([])} className="text-xs text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded transition-colors">
                Clear
              </button>)}
          </div>

          <div className="mt-3 max-h-60 overflow-y-auto space-y-3 pr-1">
            {uploads.map((u) => (<div key={u.id} className="text-xs space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-foreground">{u.file.name}</span>
                  {u.done ? (<span className="text-emerald-500 flex items-center gap-1 shrink-0">
                      <CheckCircle2 className="h-3.5 w-3.5"/> Done
                    </span>) : u.error ? (<span className="text-destructive flex items-center gap-1 shrink-0" title={u.error}>
                      <AlertCircle className="h-3.5 w-3.5"/> Failed
                    </span>) : (<span className="text-muted-foreground tabular-nums shrink-0">
                      {Math.round((u.progress.loaded / (u.progress.total || 1)) * 100)}%
                    </span>)}
                </div>

                {!u.done && !u.error && (<div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary transition-all duration-200" style={{
                        width: `${Math.round((u.progress.loaded / (u.progress.total || 1)) * 100)}%`,
                    }}/>
                  </div>)}
                {u.error && (<p className="text-[11px] text-destructive leading-tight">{u.error}</p>)}
              </div>))}
          </div>
        </aside>)}

      {/* Recipient File Preview Modal */}
      {previewFile && (<SharedPreviewModal file={previewFile} files={filteredFiles} token={token} allowDownload={data.permissions.allow_download} onSelectFile={setPreviewFile} onClose={() => setPreviewFile(null)} onDownload={() => handleDownload(previewFile)}/>)}
    </div>);
}
function FileKindIcon({ kind, className }) {
    switch (kind) {
        case "image":
            return <ImageIcon className={className}/>;
        case "video":
            return <Film className={className}/>;
        case "audio":
            return <Music className={className}/>;
        case "pdf":
        case "document":
            return <FileText className={className}/>;
        case "archive":
            return <Archive className={className}/>;
        default:
            return <FileIcon className={className}/>;
    }
}
function FileGridCard({ file, token, isSelected, hasSelection, allowDownload, onToggleSelect, onPreview, onDownload, }) {
    const thumbUrl = file.thumb_file_id ? `/api/shares/${token}/files/${file.id}/thumb` : null;
    return (<div onClick={onPreview} className={`group relative rounded-2xl border bg-card overflow-hidden hover:border-primary/50 hover:bg-card/90 transition-all cursor-pointer flex flex-col justify-between shadow-xs ${isSelected ? "border-primary ring-2 ring-primary/20 bg-primary/5" : "border-border"}`}>
      <div className="aspect-square bg-muted/40 relative overflow-hidden flex items-center justify-center">
        {thumbUrl ? (<img src={thumbUrl} alt={file.filename} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" onError={(e) => {
                e.currentTarget.style.display = "none";
            }}/>) : (<FileKindIcon kind={file.kind} className="h-12 w-12 text-muted-foreground/60"/>)}

        {/* Selection Checkbox */}
        <div onClick={(e) => {
            e.stopPropagation();
            onToggleSelect();
        }} className={`absolute top-2 left-2 transition-opacity ${isSelected || hasSelection ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
          <div className={`h-6 w-6 rounded-lg flex items-center justify-center transition-colors shadow-xs ${isSelected
            ? "bg-primary text-primary-foreground"
            : "bg-background/90 backdrop-blur border border-border hover:border-primary"}`}>
            {isSelected && <CheckSquare className="h-4 w-4 stroke-[2.5]"/>}
          </div>
        </div>

        {/* Download single button */}
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
          {allowDownload && (<button onClick={(e) => {
                e.stopPropagation();
                onDownload();
            }} className="h-8 w-8 flex items-center justify-center rounded-lg bg-background/85 backdrop-blur border border-border text-muted-foreground hover:text-foreground shadow-xs" title="Download file">
              <Download className="h-4 w-4"/>
            </button>)}
        </div>
      </div>

      <div className="p-3">
        <p className="text-sm font-semibold truncate text-foreground" title={file.filename}>
          {file.filename}
        </p>
        <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
          <span>{formatBytes(Number(file.size_bytes))}</span>
          <span className="capitalize">{file.kind}</span>
        </div>
      </div>
    </div>);
}
function SharedPreviewModal({ file, files, token, allowDownload, onSelectFile, onClose, onDownload, }) {
    const streamUrl = `/api/shares/${token}/files/${file.id}/stream`;
    const currentIndex = files.findIndex((f) => f.id === file.id);
    const hasPrev = currentIndex > 0;
    const hasNext = currentIndex >= 0 && currentIndex < files.length - 1;
    const handlePrev = useCallback(() => {
        if (hasPrev)
            onSelectFile(files[currentIndex - 1]);
    }, [hasPrev, files, currentIndex, onSelectFile]);
    const handleNext = useCallback(() => {
        if (hasNext)
            onSelectFile(files[currentIndex + 1]);
    }, [hasNext, files, currentIndex, onSelectFile]);
    useEffect(() => {
        function onKeyDown(e) {
            if (e.key === "Escape")
                onClose();
            else if (e.key === "ArrowLeft")
                handlePrev();
            else if (e.key === "ArrowRight")
                handleNext();
        }
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [onClose, handlePrev, handleNext]);
    return (<div className="fixed inset-0 z-50 flex items-stretch bg-background/95 backdrop-blur-md">
      <div className="flex flex-1 flex-col md:flex-row min-w-0">
        {/* Media display area */}
        <div className="relative flex-1 flex items-center justify-center p-4 md:p-8 min-h-0 min-w-0">
          {/* Close button */}
          <button onClick={onClose} className="absolute top-4 left-4 h-9 w-9 rounded-xl border border-border bg-card/80 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors z-10" aria-label="Close">
            <X className="h-4 w-4"/>
          </button>

          {/* Prev/Next buttons */}
          {hasPrev && (<button onClick={handlePrev} className="absolute left-4 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full border border-border bg-card/80 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors z-10 shadow-lg" title="Previous file (Left Arrow)" aria-label="Previous file">
              <ChevronLeft className="h-5 w-5"/>
            </button>)}

          {hasNext && (<button onClick={handleNext} className="absolute right-4 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full border border-border bg-card/80 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors z-10 shadow-lg" title="Next file (Right Arrow)" aria-label="Next file">
              <ChevronRight className="h-5 w-5"/>
            </button>)}

          <div className="w-full h-full flex items-center justify-center overflow-auto p-2">
            {file.kind === "image" ? (<img src={streamUrl} alt={file.filename} className="max-h-full max-w-full object-contain rounded-lg shadow-lg"/>) : file.kind === "video" ? (<video src={streamUrl} controls autoPlay className="max-h-full max-w-full rounded-lg bg-black shadow-lg"/>) : file.kind === "audio" ? (<div className="w-full max-w-md p-6 rounded-2xl border border-border bg-card shadow-xl text-center">
                <Music className="h-16 w-16 mx-auto text-primary mb-4"/>
                <p className="font-semibold text-foreground mb-4 truncate">{file.filename}</p>
                <audio src={streamUrl} controls className="w-full"/>
              </div>) : file.kind === "pdf" ? (<iframe src={streamUrl} title={file.filename} className="w-full h-full min-h-[70vh] rounded-lg bg-white border border-border shadow-lg"/>) : (<div className="text-center p-8 rounded-2xl bg-card border border-border shadow-md">
                <FileKindIcon kind={file.kind} className="h-20 w-20 mx-auto text-muted-foreground mb-4"/>
                <p className="text-base font-semibold text-foreground">{file.filename}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Inline preview is not available for this file format.
                </p>
                {allowDownload && (<Button onClick={onDownload} className="mt-5 gap-2">
                    <ArrowDownToLine className="h-4 w-4"/> Download (
                    {formatBytes(Number(file.size_bytes))})
                  </Button>)}
              </div>)}
          </div>
        </div>

        {/* Sidebar Info */}
        <aside className="w-full md:w-80 border-t md:border-t-0 md:border-l border-border bg-card/80 backdrop-blur p-6 flex flex-col justify-between overflow-y-auto">
          <div>
            <h3 className="text-lg font-bold text-foreground break-all leading-snug">
              {file.filename}
            </h3>
            <p className="text-xs text-muted-foreground mt-1 uppercase tracking-wider">{file.mime}</p>

            <dl className="mt-6 space-y-3.5 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Size</dt>
                <dd className="font-medium text-foreground">
                  {formatBytes(Number(file.size_bytes))}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Type</dt>
                <dd className="font-medium text-foreground capitalize">{file.kind}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Uploaded</dt>
                <dd className="font-medium text-foreground">{formatDate(file.created_at)}</dd>
              </div>
              {files.length > 1 && (<div className="flex justify-between gap-2 text-xs text-muted-foreground pt-2 border-t border-border/60">
                  <span>File</span>
                  <span>
                    {currentIndex + 1} of {files.length}
                  </span>
                </div>)}
            </dl>
          </div>

          <div className="mt-8 space-y-2.5">
            {allowDownload && (<Button onClick={onDownload} className="w-full gap-2">
                <Download className="h-4 w-4"/> Download File
              </Button>)}
            <Button variant="outline" onClick={onClose} className="w-full">
              Close
            </Button>
          </div>
        </aside>
      </div>
    </div>);
}
