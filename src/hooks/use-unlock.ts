import { useQuery } from "@tanstack/react-query";

export function useUnlockStatus() {
  return useQuery({
    queryKey: ["unlock-status"],
    queryFn: async () => {
      const res = await fetch("/api/status");
      return (await res.json()) as { unlocked: boolean };
    },
    staleTime: 30_000,
  });
}