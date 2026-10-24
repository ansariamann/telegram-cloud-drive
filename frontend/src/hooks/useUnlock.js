import { useQuery } from "@tanstack/react-query";
import { vaultFetch } from "@/lib/apiClient";

export function useUnlockStatus() {
  return useQuery({
    queryKey: ["unlock-status"],
    queryFn: async () => {
      const res = await vaultFetch("/api/status");
      return await res.json();
    },
    staleTime: 30_000,
  });
}
