import { useQuery } from "@tanstack/react-query";
import { vaultFetch } from "@/lib/vault-client";

export function useUnlockStatus() {
  return useQuery({
    queryKey: ["unlock-status"],
    queryFn: async () => {
      const res = await vaultFetch("/api/status");
      return (await res.json()) as { unlocked: boolean };
    },
    staleTime: 30_000,
  });
}