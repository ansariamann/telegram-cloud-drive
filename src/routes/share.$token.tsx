import { createFileRoute } from "@tanstack/react-router";
import { SharedFolderView } from "@/components/shared-folder-view";

export const Route = createFileRoute("/share/$token")({
  head: () => ({
    meta: [
      { title: "Shared Folder | Vault" },
      {
        name: "description",
        content: "Access a shared folder from Telegram File Vault.",
      },
      { property: "og:title", content: "Shared Folder | Vault" },
      {
        property: "og:description",
        content: "Access a shared folder from Telegram File Vault.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SharedPage,
});

function SharedPage() {
  const { token } = Route.useParams();
  return <SharedFolderView token={token} />;
}
