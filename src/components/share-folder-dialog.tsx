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

  // Create form state
  const [allowUpload, setAllowUpload] = useState(true);
  const [allowDownload, setAllowDownload] = useState(true);
  const [expiresIn, setExpiresIn] = useState("never");

  // Load existing shares
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    vaultFetch(`/api/folders/${folderId}/share`)
      .then(async (res) => {
        if (res.ok) {
          const data = (await res.json()) as { shares: ShareRow[] };
          setShares(data.shares);
        }
      })
      .finally(() => setLoading(false));
  }, [open, folderId]);

  async function createShare() {
    setCreating(true);
    try {
      const res = await vaultFetch(`/api/folders/${folderId}/share`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          allow_upload: allowUpload,
          allow_download: allowDownload,
          expires_in: expiresIn,
        }),
      });
      if (!res.ok) {
        const errJson = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errJson.error || "Failed to create share link");
      }
      const data = (await res.json()) as { share: ShareRow };
      setShares((prev) => [data.share, ...prev]);
      toast.success("Share link created");
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
      setShares((prev) => prev.filter((s) => s.id !== shareId));
      toast.success("Share link revoked");
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
            Share "{folderName}"
          </DialogTitle>
          <DialogDescription>
            Create a public link to let anyone access this folder. Recipients do not need a
            passcode.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 pt-2">
          {/* Create new share */}
          <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-4">
            <h3 className="text-sm font-semibold text-foreground">New share link</h3>

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

            <Button onClick={createShare} disabled={creating} className="w-full h-10 rounded-xl">
              {creating ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Link2 className="h-4 w-4 mr-2" />
              )}
              {creating ? "Creating…" : "Create share link"}
            </Button>
          </div>

          {/* Existing shares */}
          {loading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : shares.length > 0 ? (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">Active links</h3>
              {shares.map((share) => (
                <div
                  key={share.id}
                  className="flex items-center gap-3 rounded-xl border border-border bg-card p-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
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
                      {share.expires_at && (
                        <span>
                          Expires{" "}
                          {new Date(share.expires_at).toLocaleDateString()}
                        </span>
                      )}
                      {!share.expires_at && <span>No expiry</span>}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground/60 truncate font-mono">
                      {getShareUrl(share.token)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={() => window.open(getShareUrl(share.token), "_blank")}
                      title="Open link"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={() => copyLink(share.token)}
                      title="Copy link"
                    >
                      {copied === share.token ? (
                        <Check className="h-3.5 w-3.5 text-green-500" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                      onClick={() => revokeShare(share.id)}
                      title="Revoke link"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
