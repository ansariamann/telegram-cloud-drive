import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { vaultFetch } from "@/lib/vault-client";
import {
  Link2,
  Copy,
  Check,
  Loader2,
  Trash2,
  Upload,
  Download,
  ExternalLink,
  Shield,
  Plus,
} from "lucide-react";
import { toast } from "sonner";

type ShareRow = {
  id: string;
  folder_id: string;
  token: string;
  label: string | null;
  allow_upload: boolean;
  allow_download: boolean;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
};

export function ShareFolderDialog({
  open,
  onOpenChange,
  folderId,
  folderName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderId: string;
  folderName: string;
}) {
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  // Whether the "create new link" form is shown
  const [showCreateForm, setShowCreateForm] = useState(false);

  // Create form state
  const [allowUpload, setAllowUpload] = useState(true);
  const [allowDownload, setAllowDownload] = useState(true);
  const [expiresIn, setExpiresIn] = useState("never");

  // Load existing shares
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setShares([]);
    setShowCreateForm(false);
    vaultFetch(`/api/folders/${folderId}/share`)
      .then(async (res) => {
        if (res.ok) {
          const data = (await res.json()) as { shares: ShareRow[] };
          setShares(data.shares);
          // Auto-show create form if there are no active links yet
          if (data.shares.length === 0) {
            setShowCreateForm(true);
          }
        }
      })
      .finally(() => setLoading(false));
  }, [open, folderId]);

  async function createShare(forceNew = false) {
    setCreating(true);
    try {
      const res = await vaultFetch(`/api/folders/${folderId}/share`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          allow_upload: allowUpload,
          allow_download: allowDownload,
          expires_in: expiresIn,
          force_new: forceNew,
        }),
      });
      if (!res.ok) {
        const errJson = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errJson.error || "Failed to create share link");
      }
      const data = (await res.json()) as { share: ShareRow; reused?: boolean };
      // Replace if reused (same id), otherwise prepend
      setShares((prev) => {
        const exists = prev.some((s) => s.id === data.share.id);
        if (exists) return prev.map((s) => (s.id === data.share.id ? data.share : s));
        return [data.share, ...prev];
      });
      setShowCreateForm(false);
      toast.success(data.reused ? "Existing share link returned" : "Share link created");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create link");
    } finally {
      setCreating(false);
    }
  }

  async function revokeShare(shareId: string) {
    try {
      const res = await vaultFetch(`/api/folders/${folderId}/share?shareId=${shareId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const errJson = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errJson.error || "Failed to revoke link");
      }
      const remaining = shares.filter((s) => s.id !== shareId);
      setShares(remaining);
      toast.success("Share link revoked");
      if (remaining.length === 0) setShowCreateForm(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to revoke");
    }
  }

  function getShareUrl(token: string) {
    return `${window.location.origin}/share/${token}`;
  }

  async function copyLink(token: string) {
    const url = getShareUrl(token);
    await navigator.clipboard.writeText(url);
    setCopied(token);
    toast.success("Link copied to clipboard");
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5 text-primary" />
            Share &ldquo;{folderName}&rdquo;
          </DialogTitle>
          <DialogDescription>
            Create a public link to let anyone access this folder. Recipients do not need a
            passcode.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          {/* Loading state */}
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* Existing shares list */}
              {shares.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-foreground">
                    {shares.length === 1 ? "Active link" : `Active links (${shares.length})`}
                  </h3>
                  {shares.map((share) => (
                    <div
                      key={share.id}
                      className="rounded-xl border border-border bg-card p-3 space-y-2"
                    >
                      {/* URL row */}
                      <div className="flex items-center gap-2">
                        <div className="flex-1 min-w-0 font-mono text-xs text-muted-foreground bg-muted/40 rounded-lg px-2.5 py-1.5 truncate border border-border/60">
                          {getShareUrl(share.token)}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 px-3 shrink-0 gap-1.5 text-xs"
                          onClick={() => copyLink(share.token)}
                        >
                          {copied === share.token ? (
                            <>
                              <Check className="h-3.5 w-3.5 text-green-500" /> Copied!
                            </>
                          ) : (
                            <>
                              <Copy className="h-3.5 w-3.5" /> Copy
                            </>
                          )}
                        </Button>
                      </div>

                      {/* Permissions & meta row */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
                          {share.allow_upload && (
                            <span className="flex items-center gap-1">
                              <Upload className="h-3 w-3" /> Upload
                            </span>
                          )}
                          {share.allow_download && (
                            <span className="flex items-center gap-1">
                              <Download className="h-3 w-3" /> Download
                            </span>
                          )}
                          {share.expires_at ? (
                            <span>Expires {new Date(share.expires_at).toLocaleDateString()}</span>
                          ) : (
                            <span>No expiry</span>
                          )}
                        </div>

                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => window.open(getShareUrl(share.token), "_blank")}
                            title="Open link"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                            onClick={() => revokeShare(share.id)}
                            title="Revoke link"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Create form (shown when no shares, or user expands it) */}
              {showCreateForm ? (
                <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground">
                      {shares.length > 0 ? "Create another link" : "New share link"}
                    </h3>
                    {shares.length > 0 && (
                      <button
                        onClick={() => setShowCreateForm(false)}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Cancel
                      </button>
                    )}
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm">
                      <Upload className="h-4 w-4 text-muted-foreground" />
                      <span>Allow uploads</span>
                    </div>
                    <Switch checked={allowUpload} onCheckedChange={setAllowUpload} />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm">
                      <Download className="h-4 w-4 text-muted-foreground" />
                      <span>Allow downloads</span>
                    </div>
                    <Switch checked={allowDownload} onCheckedChange={setAllowDownload} />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm">
                      <Shield className="h-4 w-4 text-muted-foreground" />
                      <span>Expires</span>
                    </div>
                    <Select value={expiresIn} onValueChange={setExpiresIn}>
                      <SelectTrigger className="w-[140px] h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="never">Never</SelectItem>
                        <SelectItem value="24h">24 hours</SelectItem>
                        <SelectItem value="7d">7 days</SelectItem>
                        <SelectItem value="30d">30 days</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <Button
                    onClick={() => createShare(shares.length > 0)}
                    disabled={creating}
                    className="w-full h-10 rounded-xl"
                  >
                    {creating ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Link2 className="h-4 w-4 mr-2" />
                    )}
                    {creating ? "Creating\u2026" : "Create share link"}
                  </Button>
                </div>
              ) : (
                /* Button to show create form when shares already exist */
                shares.length > 0 && (
                  <button
                    onClick={() => setShowCreateForm(true)}
                    className="w-full flex items-center justify-center gap-1.5 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors border border-dashed border-border rounded-xl hover:border-primary/40"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Create another link
                  </button>
                )
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
