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
