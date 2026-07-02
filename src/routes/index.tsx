import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { FileManager } from "@/components/file-manager";
import { useUnlockStatus } from "@/hooks/use-unlock";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const nav = useNavigate();
  const { data, isLoading } = useUnlockStatus();
  useEffect(() => {
    if (!isLoading && data && !data.unlocked) {
      nav({ to: "/unlock" });
    }
  }, [isLoading, data, nav]);
  if (isLoading) return <div className="min-h-screen bg-background" />;
  if (!data?.unlocked) return null;
  return <FileManager />;
}