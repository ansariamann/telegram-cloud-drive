export function getVaultSession(): string | null {
  return null;
}

export function setVaultSession(session: string | null) {
  // No-op: Session is managed purely via HttpOnly cookies.
}

export function vaultFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  return fetch(input, {
    ...init,
    credentials: "include",
  });
}

export function vaultUrl(path: string) {
  // Cookies are automatically sent for same-origin media/thumbnails, no need for token in URL query params.
  return path;
}

/**
 * Downloads a file using a short-lived signed URL.
 * Plain <a href> navigations can lose the session cookie inside embedded
 * previews, so we mint a signed link first (cookie sent via fetch) and then
 * navigate to that link.
 */
export async function downloadFileById(id: string): Promise<void> {
  const res = await vaultFetch(`/api/files/${id}/link`);
  if (!res.ok) throw new Error(`Could not prepare download (${res.status})`);
  const { url, filename } = (await res.json()) as { url: string; filename: string };
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
