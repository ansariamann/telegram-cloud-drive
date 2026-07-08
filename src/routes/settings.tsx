import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setVaultSession, vaultFetch } from "@/lib/vault-client";
import { getAuthStatus } from "@/lib/auth-guard.server";

export const Route = createFileRoute("/settings")({
  // Server-side guard — same as index route
  loader: async () => {
    const { unlocked } = await getAuthStatus();
    if (!unlocked) throw redirect({ to: "/unlock", replace: true });
  },
  component: Settings,
});

function Settings() {
  const nav = useNavigate();
  const [chats, setChats] = useState<Array<{ id: number; title: string; type: string }> | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function fetchChats() {
    setLoading(true);
    setErr(null);
    try {
      const res = await vaultFetch("/api/whoami");
      if (res.status === 401) {
        await nav({ to: "/unlock" });
        return;
      }
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as {
        chats: Array<{ id: number; title: string; type: string }>;
      };
      setChats(data.chats);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  async function lock() {
    await vaultFetch("/api/lock", { method: "POST" });
    setVaultSession(null);
    await nav({ to: "/unlock" });
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-6 py-4">
          <Link to="/" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-sm font-medium tracking-tight">Settings</h1>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-8 space-y-8">
        <section>
          <h2 className="text-base font-semibold mb-1">Detect chat ID</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Send any message to your private group after adding the bot. Then click below to see
            which chats the bot can see. Use that ID as{" "}
            <code className="text-xs bg-muted px-1.5 py-0.5 rounded">TELEGRAM_CHAT_ID</code>.
          </p>
          <Button onClick={fetchChats} disabled={loading} variant="secondary">
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Checking…" : "Check bot updates"}
          </Button>
          {err && <p className="mt-3 text-sm text-destructive">{err}</p>}
          {chats && (
            <div className="mt-4 rounded-lg border border-border overflow-hidden">
              {chats.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">
                  No recent chats. Make sure the bot is in a group and someone has sent a message.
                </div>
              ) : (
                <table className="w-full text-sm tabular-nums">
                  <thead className="bg-muted/40 text-xs text-muted-foreground">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium">Chat</th>
                      <th className="text-left px-4 py-2 font-medium">Type</th>
                      <th className="text-left px-4 py-2 font-medium">ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chats.map((c) => (
                      <tr key={c.id} className="border-t border-border">
                        <td className="px-4 py-2">{c.title}</td>
                        <td className="px-4 py-2 text-muted-foreground">{c.type}</td>
                        <td className="px-4 py-2 font-mono">{c.id}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </section>

        <section>
          <h2 className="text-base font-semibold mb-1">Session</h2>
          <p className="text-sm text-muted-foreground mb-4">Sign out and require passcode again.</p>
          <Button onClick={lock} variant="destructive">
            Lock vault
          </Button>
        </section>

        <section>
          <h2 className="text-base font-semibold mb-1">Limits</h2>
          <p className="text-sm text-muted-foreground">
            Files up to 19MB upload as a single Telegram document. Larger files are automatically
            split into 19MB parts (Telegram Bot API download limit is 20MB) and stitched back together on download.
          </p>
        </section>
      </main>
    </div>
  );
}
