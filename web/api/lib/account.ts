import { createHmac, timingSafeEqual } from "node:crypto";
import { bearer, Refusal } from "./http";

const DOMAIN = "@hcompany.ai";

export interface User {
  id: string;
  email: string;
  name: string;
}

/** "jane.doe@hcompany.ai" as "Jane Doe". */
export const nameOf = (email: string) =>
  email
    .split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");

export function admit(user: { id: string; email: string }): User {
  if (!user.email.toLowerCase().endsWith(DOMAIN)) throw new Refusal(403, "Brickyard is open to H Company accounts.");
  return { ...user, name: nameOf(user.email) };
}

export const isAdmin = (user: User) =>
  (process.env.BRICKYARD_ADMINS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .includes(user.email.toLowerCase());

function seal(payload: string): Buffer {
  const secret = process.env.BRICKYARD_SECRET;
  if (!secret) throw new Error("BRICKYARD_SECRET is not set");
  return createHmac("sha256", secret).update(payload).digest();
}

/** A pass naming the user to this API until `expires` (seconds). */
export function pass(user: User, expires: number): string {
  const payload = Buffer.from(JSON.stringify({ ...user, expires })).toString("base64url");
  return `${payload}.${seal(payload).toString("base64url")}`;
}

/** The user whose pass the request carries. */
export function holder(request: Request): User {
  const [payload, signature] = (bearer(request) ?? "").split(".");
  if (!payload || !signature) throw new Refusal(401, "Sign in first.");
  const given = Buffer.from(signature, "base64url");
  const expected = seal(payload);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new Refusal(401, "Sign in again.");
  const { id, email, name, expires } = JSON.parse(Buffer.from(payload, "base64url").toString());
  if (expires < Date.now() / 1000) throw new Refusal(401, "Your sign-in expired: sign in again.");
  return { id, email, name };
}
