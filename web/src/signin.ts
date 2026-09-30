/** The cookie the page sets before leaving for the portal's Google sign-in, read by /api/session on the way back. */
export const PENDING = "brickyard.pending";
/** The cookie /api/session hands the sign-in over in, read and cleared by the page it redirects to. */
export const HANDOFF = "brickyard.signin";
/** How long the handoff cookie lives, in seconds: the redirect back is immediate. */
export const HANDOFF_S = 60;

export interface Pending {
  /** The key of the last sign-out, to revoke. */
  previous: string | null;
  /** The page to come back to, as a path. */
  back: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
}

/** A sign-in: the user, their Agents API key, and the pass for Brickyard's own API. */
export interface Account {
  user: User;
  key: string;
  keyId: string;
  /** In seconds. */
  expires: number;
  pass: string;
}

export type Handoff = Account | { error: string };

/** A same-site path, never another origin. */
export const local = (path: unknown): string => (typeof path === "string" && /^\/(?![/\\])/.test(path) ? path : "/");

/** The value of cookie `name` in a Cookie header or `document.cookie`. */
export function cookie(header: string | null, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === name) return decodeURIComponent(part.slice(at + 1).trim());
  }
  return null;
}

export const setCookie = (name: string, value: string, maxAge: number, path = "/") =>
  `${name}=${encodeURIComponent(value)}; Path=${path}; Max-Age=${maxAge}; Secure; SameSite=Lax`;
