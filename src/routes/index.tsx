import { createFileRoute, redirect } from "@tanstack/react-router";
import { FileManager } from "@/components/file-manager";
import { getAuthStatus } from "@/lib/auth-guard.server";

export const Route = createFileRoute("/")({
  // Server-side guard: runs before any HTML is sent.
  // Unauthenticated requests are redirected at the server, not after React boots.
  loader: async () => {
    const { unlocked } = await getAuthStatus();
    if (!unlocked) throw redirect({ to: "/unlock", replace: true });
  },
  component: FileManager,
});
