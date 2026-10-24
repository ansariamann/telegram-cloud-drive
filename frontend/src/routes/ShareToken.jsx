import { useParams } from "react-router-dom";
import { useEffect } from "react";
import { SharedFolderView } from "@/components/SharedFolderView";

export function ShareTokenPage() {
  const { token } = useParams();

  useEffect(() => {
    document.title = "Shared Folder | Vault";
  }, []);

  return <SharedFolderView token={token} />;
}
