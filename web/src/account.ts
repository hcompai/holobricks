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

/** Show the signed-in user under the display name they just chose. */
export function renamed(name: string) {
  if (account) set({ ...account, user: { ...account.user, name } });
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

function leave(verifier: string | null) {
  const pending: Pending = {
    previous: localStorage.getItem(PREVIOUS),
    back: window.location.pathname + window.location.search,
    verifier,
  };
  document.cookie = setCookie(PENDING, JSON.stringify(pending), 600, "/api/session");
}

/** Leave for the portal's Google sign-in; it comes back through /api/session, then to this page. */
export async function signIn() {
  const loopback = window.location.hostname === LOOPBACK;
  const verifier = loopback ? base64url(crypto.getRandomValues(new Uint8Array(32))) : null;
  leave(verifier);
  const query = new URLSearchParams({ provider: "google", redirect_uri: `${window.location.origin}/api/session` });
  if (verifier) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    query.set("code_challenge", base64url(new Uint8Array(digest)));
    query.set("code_challenge_method", "S256");
  }
  window.location.assign(`${H.portal}/auth/authorize?${query}`);
}

/**
 * Sign in on the Platform's login page, in a popup, with any method it takes (email and password, Google, MFA),
 * then post its access token to /api/session, which hands the sign-in to this page like the Google redirect does.
 * Resolves false if the popup was blocked, true once it closes.
 */
export function signInOnPlatform(): Promise<boolean> {
  const query = new URLSearchParams({ sdk_auth: "true", return_origin: window.location.origin });
  const popup = window.open(`${H.platform}/login?${query}`, "h-platform-sign-in", "width=520,height=720");
  if (!popup) return Promise.resolve(false);
  return new Promise((resolve) => {
    const done = () => {
      window.removeEventListener("message", received);
      clearInterval(watch);
      resolve(true);
    };
    const received = (event: MessageEvent) => {
      if (event.origin !== H.platform || event.source !== popup) return;
      if (event.data?.type !== "H_PORTAL_AUTH_SUCCESS" || typeof event.data.accessToken !== "string") return;
      done();
      popup.close();
      leave(null);
      const form = document.createElement("form");
      form.method = "POST";
      form.action = "/api/session";
      const access = form.appendChild(document.createElement("input"));
      access.type = "hidden";
      access.name = "access";
      access.value = event.data.accessToken;
      document.body.appendChild(form).submit();
    };
    const watch = setInterval(() => popup.closed && done(), 500);
    window.addEventListener("message", received);
  });
}

/** The key stopped working, revoked or expired: sign out. */
export function expired() {
  if (account) set(null);
}
