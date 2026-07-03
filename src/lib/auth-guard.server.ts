import { createServerFn } from "@tanstack/react-start";
import { isUnlocked } from "@/lib/gate.server";

/**
 * Server function that checks auth status.
 * Runs entirely on the server — safe to call in route loaders.
 * The loader runs before any HTML is sent, so this gives us a true
 * server-side redirect rather than a client-side useEffect redirect.
 */
export const getAuthStatus = createServerFn({ method: "GET" }).handler(() => ({
  unlocked: isUnlocked(),
}));
