import { useSyncExternalStore } from "react";

const PORTAL = "https://portal.hcompany.ai";
const STORE = "brickyard.account";
/** The key of the last sign-out, revoked at the next sign-in. */
const PREVIOUS = "brickyard.previous-key";

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

function load(): Account | null {
  try {
    const saved: Account | null = JSON.parse(localStorage.getItem(STORE) ?? "null");
    return saved && saved.expires > Date.now() / 1000 ? saved : null;
  } catch {
    return null;
  }
}

let account = load();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

window.addEventListener("storage", (e) => {
  if (e.key !== STORE) return;
  account = load();
  notify();
});

function set(next: Account | null) {
  account = next;
  if (next) localStorage.setItem(STORE, JSON.stringify(next));
  else localStorage.removeItem(STORE);
  notify();
}

export const current = () => account;

export const useAccount = () =>
  useSyncExternalStore((l) => {
    listeners.add(l);
    return () => listeners.delete(l);
  }, current);

/** The Agents API key of the signed-in user. */
export function key(): string {
  if (!account) throw new Error("Sign in to build with Holo.");
  return account.key;
}

export function signOut() {
  if (account) localStorage.setItem(PREVIOUS, account.keyId);
  set(null);
}

/** The portal's access token, from its sign-in window; null if the window closes first. */
function portalToken(): Promise<string | null> {
  const query = new URLSearchParams({ sdk_auth: "true", return_origin: window.location.origin });
  const popup = window.open(`${PORTAL}/login?${query}`, "brickyard-sign-in", "popup,width=480,height=720");
  if (!popup) return Promise.reject(new Error("Allow pop-ups for this site to sign in."));
  return new Promise((resolve, reject) => {
    const finish = () => {
      window.removeEventListener("message", receive);
      clearInterval(watch);
    };
    const receive = (e: MessageEvent) => {
      if (e.origin !== PORTAL || e.source !== popup) return;
      if (e.data?.type === "H_PORTAL_AUTH_ERROR") {
        finish();
        reject(new Error(e.data.error || "The sign-in failed."));
      } else if (e.data?.type === "H_PORTAL_AUTH_SUCCESS" && typeof e.data.accessToken === "string") {
        finish();
        resolve(e.data.accessToken);
      }
    };
    const watch = setInterval(() => {
      if (!popup.closed) return;
      finish();
      resolve(null);
    }, 500);
    window.addEventListener("message", receive);
  });
}

/** Sign in with an H account in the portal's window; resolves once signed in, or once the window is closed. */
export async function signIn(): Promise<void> {
  const accessToken = await portalToken();
  if (!accessToken) return;
  const previousKey = account?.keyId ?? localStorage.getItem(PREVIOUS);
  const response = await fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accessToken, previousKey }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `The sign-in failed (HTTP ${response.status}).`);
  localStorage.removeItem(PREVIOUS);
  set(body);
}

/** The key stopped working, revoked or expired: sign out. */
export function expired() {
  if (account) set(null);
}
