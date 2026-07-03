const SESSION_STORAGE_KEY = "tfv_session_fallback";

export function getVaultSession(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(SESSION_STORAGE_KEY);
}

export function setVaultSession(session: string | null) {
  if (typeof window === "undefined") return;
  if (session) {
    window.localStorage.setItem(SESSION_STORAGE_KEY, session);
  } else {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  }
}

export function vaultFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const session = getVaultSession();
  if (session && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${session}`);
  }
  return fetch(input, {
    ...init,
    credentials: "include",
    headers,
  });
}

export function vaultUrl(path: string) {
  const session = getVaultSession();
  if (!session || typeof window === "undefined") return path;
  const url = new URL(path, window.location.origin);
  url.searchParams.set("t", session);
  return `${url.pathname}${url.search}${url.hash}`;
}