import { BlobNotFoundError, del, head, put } from "@vercel/blob";
import { isStaff, nameOf, privateScope, type User } from "./account";
import { Refusal } from "./http";
import { reauthor } from "./store";

const path = (owner: string) => `profiles/${privateScope(owner)}.json`;
const NAME = /^[\p{L}\p{M}\d .'_-]{2,32}$/u;

async function storedName(owner: string): Promise<string | null> {
  try {
    const blob = await head(path(owner));
    const response = await fetch(`${blob.url}?v=${blob.uploadedAt.getTime()}`);
    if (!response.ok) throw new Error("Profile unavailable");
    return ((await response.json()) as { name: string }).name;
  } catch (e) {
    if (e instanceof BlobNotFoundError) return null;
    throw e;
  }
}

/** The name the user's public builds carry: the one they chose, else the default from their email. */
export async function authorOf(user: User): Promise<string> {
  try {
    return (await storedName(user.id)) ?? nameOf(user.email);
  } catch (e) {
    console.warn("Display name unavailable, using the default", e);
    return nameOf(user.email);
  }
}

/** A display name as given, tidied and checked; "" resets to the default. */
export function checkedName(given: unknown, user: User): string {
  if (typeof given !== "string") throw new Refusal(400, "Send a name.");
  const name = given.trim().replace(/\s+/g, " ");
  if (!name) return "";
  if (/@|:\/\/|www\./i.test(name)) throw new Refusal(400, "A display name cannot hold an email address or a link.");
  if (!NAME.test(name)) throw new Refusal(400, "Use 2 to 32 letters, digits, spaces, or . _ - ' in your name.");
  if (!isStaff(user.email) && /h[\s._-]*company|holo/i.test(name))
    throw new Refusal(400, "That name is reserved: choose another.");
  return name;
}

/** Save the user's display name, or reset it with "", and sign their library builds with the result. */
export async function setDisplayName(user: User, name: string): Promise<string> {
  if (name)
    await put(path(user.id), JSON.stringify({ name }), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60,
      contentType: "application/json",
    });
  else await del(path(user.id));
  const author = name || nameOf(user.email);
  await reauthor(user.id, author);
  return author;
}
