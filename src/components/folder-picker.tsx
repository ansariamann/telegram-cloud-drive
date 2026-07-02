import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Folder, ChevronRight, Home } from "lucide-react";
import { toast } from "sonner";

type FolderItem = {
  id: string;
  name: string;
  parent_id: string | null;
};

type Breadcrumb = { id: string; name: string };

export function FolderPicker({
  open,
  onOpenChange,
  onSelect,
  currentFolderId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (folderId: string | null) => void;
  currentFolderId?: string | null;
}) {
  const [browseFolderId, setBrowseFolderId] = useState<string | null>(null);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setBrowseFolderId(null);
    setBreadcrumbs([]);
    setSelectedId(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const param = browseFolderId ?? "root";
    fetch(`/api/folders?parent_id=${param}`)
      .then((r) => r.json())
      .then((d: { folders: FolderItem[] }) => setFolders(d.folders))
      .catch(() => toast.error("Failed to load folders"))
      .finally(() => setLoading(false));
  }, [open, browseFolderId]);

  function navigateInto(folder: FolderItem) {
    setBreadcrumbs((b) => [...b, { id: folder.id, name: folder.name }]);
    setBrowseFolderId(folder.id);
    setSelectedId(folder.id);
  }

  function navigateTo(index: number) {
    if (index < 0) {
      setBrowseFolderId(null);
      setBreadcrumbs([]);
      setSelectedId(null);
    } else {
      const crumb = breadcrumbs[index];
      setBrowseFolderId(crumb.id);
      setBreadcrumbs((b) => b.slice(0, index + 1));
      setSelectedId(crumb.id);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move to Folder</DialogTitle>
        </DialogHeader>

        {/* Breadcrumb navigation */}
        <div className="flex items-center gap-1 text-xs text-muted-foreground overflow-x-auto py-1">
          <button
            onClick={() => navigateTo(-1)}
            className={`shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded hover:text-foreground hover:bg-muted transition-colors ${
              selectedId === null ? "text-primary font-medium" : ""
            }`}
          >
            <Home className="h-3.5 w-3.5" />
            Root
          </button>
          {breadcrumbs.map((crumb, i) => (
            <span key={crumb.id} className="flex items-center gap-1 shrink-0">
              <ChevronRight className="h-3 w-3" />
              <button
                onClick={() => navigateTo(i)}
                className={`px-1.5 py-0.5 rounded hover:text-foreground hover:bg-muted transition-colors ${
                  selectedId === crumb.id ? "text-primary font-medium" : ""
                }`}
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </div>

        {/* Folder list */}
        <div className="border border-border rounded-md overflow-hidden min-h-[160px] max-h-[280px] overflow-y-auto">
          {/* Root / parent option */}
          <button
            onClick={() => setSelectedId(browseFolderId)}
            className={`w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-muted/50 transition-colors border-b border-border ${
              selectedId === browseFolderId ? "bg-primary/10 text-primary" : "text-muted-foreground"
            }`}
          >
            <Folder className="h-4 w-4" />
            <span className="italic">Current folder</span>
          </button>
          {loading ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">Loading\u2026</div>
          ) : folders.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">No sub-folders</div>
          ) : (
            folders.map((f) => (
              <button
                key={f.id}
                onClick={() => setSelectedId(f.id)}
                onDoubleClick={() => navigateInto(f)}
                className={`w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-muted/50 transition-colors ${
                  selectedId === f.id ? "bg-primary/10 text-primary" : ""
                }`}
              >
                <Folder className="h-4 w-4 text-primary/70" />
                <span className="truncate flex-1 text-left">{f.name}</span>
                <ChevronRight
                  className="h-3.5 w-3.5 text-muted-foreground shrink-0"
                  onClick={(e) => { e.stopPropagation(); navigateInto(f); }}
                />
              </button>
            ))
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => {
              onSelect(selectedId);
              onOpenChange(false);
            }}
          >
            Move Here
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
