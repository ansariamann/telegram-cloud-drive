import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState, useEffect } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function Unlock() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const passcodeRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    document.title = "Unlock | Telegram File Vault";
  }, []);

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const passcode = passcodeRef.current?.value ?? "";
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
      await qc.invalidateQueries({ queryKey: ["unlock-status"] });
      nav("/");
    } catch {
      setError("Failed to communicate with server");
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
          ref={passcodeRef}
          type="password"
          placeholder="Passcode"
          autoFocus
          autoComplete="current-password"
          className="mb-3"
        />
        {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={loading} className="w-full">
          {loading ? "Unlocking…" : "Unlock"}
        </Button>
      </form>
    </div>
  );
}
