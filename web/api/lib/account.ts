import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { bearer, Refusal } from "./http";

const DOMAIN = "@hcompany.ai";

export interface User {
  id: string;
  email: string;
  name: string;
}

export const isStaff = (email: string) => email.toLowerCase().endsWith(DOMAIN);

const capital = (word: string) => word[0].toUpperCase() + word.slice(1);

/** The default public name: "Jane Doe" for jane.doe@hcompany.ai, "Jane D." for jane.doe@gmail.com, else none. */
export function nameOf(email: string): string {
  const local = email.split("@")[0];
  if (isStaff(email))
    return local
      .split(/[._-]+/)
      .filter(Boolean)
      .map(capital)
      .join(" ");
  const words = local.toLowerCase().split(/[._-]/);
  if (words.length < 2 || !words.every((w) => /^\p{L}+$/u.test(w))) return "";
  return `${capital(words[0])} ${words.at(-1)![0].toUpperCase()}.`;
}

export const admit = (user: { id: string; email: string }): User => ({ ...user, name: nameOf(user.email) });

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

const digest = (key: string) => createHash("sha256").update(key).digest("base64url");

/** A pass naming the user to this API until `expires` (seconds), good only beside their Agents API `key`. */
export function pass(user: User, expires: number, key: string): string {
  const payload = Buffer.from(JSON.stringify({ ...user, expires, key: digest(key) })).toString("base64url");
  return `${payload}.${seal(payload).toString("base64url")}`;
}

/** The user whose pass the request carries, and their Agents API key, from `X-Agents-Key`. */
export function holder(request: Request): { user: User; key: string } {
  const [payload, signature] = (bearer(request) ?? "").split(".");
  const key = request.headers.get("x-agents-key");
  if (!payload || !signature || !key) throw new Refusal(401, "Sign in first.");
  const given = Buffer.from(signature, "base64url");
  const expected = seal(payload);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new Refusal(401, "Sign in again.");
  const { id, email, name, expires, key: sealed } = JSON.parse(Buffer.from(payload, "base64url").toString());
  if (expires < Date.now() / 1000) throw new Refusal(401, "Your sign-in expired: sign in again.");
  if (sealed !== digest(key)) throw new Refusal(401, "Sign in again.");
  return { user: { id, email, name }, key };
}

/** Keep owner-only model storage paths unguessable even when a model is published. */
export const privateScope = (owner: string) => seal(`brickyard-models:${owner}`).toString("hex");
