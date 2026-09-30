import { useSyncExternalStore } from "react";
import { H } from "./hosts";
import { type Account, cookie, HANDOFF, type Handoff, LOOPBACK, PENDING, type Pending, setCookie } from "./signin";

export type { Account, User } from "./signin";

const STORE = "brickyard.account";
/** The key of the last sign-out, revoked at the next sign-in. */
const PREVIOUS = "brickyard.previous-key";

function load(): Account | null {
  try {
    const saved: Account | null = JSON.parse(localStorage.getItem(STORE) ?? "null");
    return saved && saved.expires > Date.now() / 1000 ? saved : null;
  } catch {
    return null;
  }
}

/** The sign-in /api/session handed this page, once: the cookie is cleared as it is read. */
function handedOver(): Handoff | null {
  const value = cookie(document.cookie, HANDOFF);
  if (value === null) return null;
  document.cookie = setCookie(HANDOFF, "", 0);
  try {
    return JSON.parse(value);
  } catch {
    return { error: "The sign-in failed: try again." };
  }
}

const handoff = handedOver();
/** Why the last sign-in failed, if it just did. */
export const signInError = handoff && "error" in handoff ? handoff.error : null;

let account = load();
if (handoff && !("error" in handoff)) {
  account = handoff;
  localStorage.setItem(STORE, JSON.stringify(handoff));
  localStorage.removeItem(PREVIOUS);
}

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

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** Leave for the portal's Google sign-in; it comes back through /api/session, then to this page. */
export async function signIn() {
  const loopback = window.location.hostname === LOOPBACK;
  const verifier = loopback ? base64url(crypto.getRandomValues(new Uint8Array(32))) : null;
  const pending: Pending = {
    previous: localStorage.getItem(PREVIOUS),
    back: window.location.pathname + window.location.search,
    verifier,
  };
  document.cookie = setCookie(PENDING, JSON.stringify(pending), 600, "/api/session");
  const query = new URLSearchParams({ provider: "google", redirect_uri: `${window.location.origin}/api/session` });
  if (verifier) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    query.set("code_challenge", base64url(new Uint8Array(digest)));
    query.set("code_challenge_method", "S256");
  }
  window.location.assign(`${H.portal}/auth/authorize?${query}`);
}

/** The key stopped working, revoked or expired: sign out. */
export function expired() {
  if (account) set(null);
}
