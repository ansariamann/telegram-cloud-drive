import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setVaultSession } from "@/lib/vault-client";

export const Route = createFileRoute("/unlock")({
  component: Unlock,
});

function Unlock() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [passcode, setPasscode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/unlock", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passcode }),
      });
      if (!res.ok) {
        setError("Incorrect passcode");
        return;
      }
      const data = (await res.json()) as { ok: true; session?: string };
      if (data.session) setVaultSession(data.session);
      await qc.invalidateQueries({ queryKey: ["unlock-status"] });
      await nav({ to: "/" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-xl border border-border bg-card p-8 shadow-2xl"
      >
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Lock className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Vault</h1>
            <p className="text-xs text-muted-foreground">Enter passcode to unlock</p>
          </div>
        </div>
        <Input
          type="password"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          placeholder="Passcode"
          autoFocus
          autoComplete="current-password"
          className="mb-3"
        />
        {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={loading || !passcode} className="w-full">
          {loading ? "Unlocking…" : "Unlock"}
        </Button>
      </form>
    </div>
  );
}