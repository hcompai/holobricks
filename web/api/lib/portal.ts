import { Refusal } from "./http";

const PORTAL_API = "https://portal.api.eu.hcompany.ai/api";
const KEY_NAME = "Brickyard";
const KEY_DAYS = 30;

export interface Key {
  id: string;
  key: string;
  /** The last day the key works, YYYY-MM-DD. */
  expires: string;
}

const call = (path: string, access: string, init: RequestInit = {}) =>
  fetch(`${PORTAL_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json", ...init.headers },
  });

/** The organization a portal access token acts for. */
function organization(access: string): string {
  try {
    const org = JSON.parse(Buffer.from(access.split(".")[1], "base64url").toString()).access?.org_id;
    if (typeof org === "string") return org;
  } catch {}
  throw new Refusal(403, "Your H account has no organization to build in.");
}

/** Who a portal access token belongs to, as the portal vouches for it. */
export async function whoami(access: string): Promise<{ id: string; email: string }> {
  const response = await call("/auth/me", access);
  if (response.status === 401 || response.status === 403) throw new Refusal(401, "The sign-in expired: try again.");
  if (!response.ok) throw new Error(`The portal failed to identify a user (HTTP ${response.status})`);
  const { user } = await response.json();
  return { id: user.id, email: user.email };
}

/** A Brickyard API key for the token's user, valid for a month. */
export async function mint(access: string): Promise<Key> {
  const expiry = new Date(Date.now() + KEY_DAYS * 86_400_000).toISOString().slice(0, 10);
  const response = await call(`/organizations/${organization(access)}/keys/`, access, {
    method: "POST",
    body: JSON.stringify({ name: KEY_NAME, expiry_date: expiry }),
  });
  if (!response.ok) throw new Error(`The portal failed to create an API key (HTTP ${response.status})`);
  const created = await response.json();
  return { id: created.id, key: created.key, expires: created.expires_at ?? expiry };
}

/** Revoke a key this browser held before; a key already gone is fine. */
export async function revoke(access: string, id: string) {
  const response = await call(`/organizations/${organization(access)}/keys/${encodeURIComponent(id)}`, access, {
    method: "DELETE",
  });
  if (!response.ok && response.status !== 404) console.warn(`Could not revoke key ${id} (HTTP ${response.status})`);
}
