import { createFileRoute, redirect } from "@tanstack/react-router";
import { FileManager } from "@/components/file-manager";
import { getAuthStatus } from "@/lib/auth-guard.server";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Telegram File Vault" },
      { name: "description", content: "Upload, organize, preview, and download files stored in a private Telegram group." },
      { property: "og:title", content: "Telegram File Vault" },
      { property: "og:description", content: "A private online file manager backed by Telegram." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  // Server-side guard: runs before any HTML is sent.
  // Unauthenticated requests are redirected at the server, not after React boots.
  loader: async () => {
    const { unlocked } = await getAuthStatus();
    if (!unlocked) throw redirect({ to: "/unlock", replace: true });
  },
  component: FileManager,
});
