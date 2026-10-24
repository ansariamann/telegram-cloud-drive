/**
 * API client — JS port of lib/vault-client.ts
 * All requests include credentials (cookies) automatically.
 */

export function getVaultSession() {
  return null;
}

export function setVaultSession(session) {
  // Session is managed purely via HttpOnly cookies.
}

export function vaultFetch(input, init = {}) {
  return fetch(input, {
    ...init,
    credentials: 'include',
  });
}

export function vaultUrl(path) {
  return path;
}

/**
 * Downloads a file using a short-lived signed URL.
 */
export async function downloadFileById(id) {
  const res = await vaultFetch(`/api/files/${id}/link`);
  if (!res.ok) throw new Error(`Could not prepare download (${res.status})`);
  const { url, filename } = await res.json();
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
