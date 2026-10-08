import { BlobNotFoundError, del, head, list, put } from "@vercel/blob";
import { gzipSync } from "node:zlib";
import { readSeed, type ForkSeed, type ForkSummary, type SavedFork } from "../../src/forkModel";
import { privateScope } from "./account";
import { Refusal } from "./http";

export const isFork = (id: string) => /^fork-[a-f0-9-]{36}$/.test(id);
/** The run a copy's session carries on from, named by its group: `<copy>+<ended run>`; a fresh copy's run is in `<copy>`. */
export function carriedFrom(id: string, group: string | null | undefined): string | null | undefined {
  if (group === id) return null;
  return group?.startsWith(`${id}+`) ? group.slice(id.length + 1) : undefined;
}

const options = { access: "public", addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 } as const;
const prefix = (owner: string) => `models/${privateScope(owner)}/`;
const path = (owner: string, id: string) => `${prefix(owner)}${id}.json`;
const sessionPath = (owner: string, id: string) => `${prefix(owner)}${id}.session.json`;

type Link = { sessionId: string; runs: string[] };

/** Kept apart from the metadata record: a cached pre-start record cannot hide an accepted session. */
async function sessionLink(owner: string, id: string): Promise<Link | null> {
  try {
    const blob = await head(sessionPath(owner, id));
    const response = await fetch(`${blob.url}?v=${blob.uploadedAt.getTime()}`);
    if (!response.ok) throw new Error("Session link unavailable");
    const link = await response.json();
    return { sessionId: link.sessionId, runs: link.runs ?? [] };
  } catch (e) {
    if (e instanceof BlobNotFoundError) return null;
    throw e;
  }
}

async function linked(owner: string, info: ForkSummary): Promise<ForkSummary> {
  const link = await sessionLink(owner, info.id);
  return link ? { ...info, ...link } : info;
}

async function entry(owner: string, id: string): Promise<ForkSummary | null> {
  try {
    const blob = await head(path(owner, id));
    const response = await fetch(`${blob.url}?v=${blob.uploadedAt.getTime()}`);
    if (!response.ok) throw new Error("Copy unavailable");
    return linked(owner, await response.json());
  } catch (e) {
    if (e instanceof BlobNotFoundError) return null;
    throw e;
  }
}

export async function readFork(owner: string, id: string): Promise<SavedFork | null> {
  const info = await entry(owner, id);
  if (!info) return null;
  const blob = await head(`${prefix(owner)}${id}.gz`);
  const response = await fetch(`${blob.url}?v=${blob.uploadedAt.getTime()}`);
  if (!response.ok) throw new Error("Copy unavailable");
  return { ...info, seed: await readSeed(await response.blob()) };
}

export async function forkList(owner: string): Promise<ForkSummary[]> {
  const found: ForkSummary[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: prefix(owner), cursor, limit: 1000 });
    const entries = page.blobs.filter((b) => b.pathname.endsWith(".json") && !b.pathname.endsWith(".session.json"));
    for (let i = 0; i < entries.length; i += 16)
      found.push(
        ...(await Promise.all(
          entries.slice(i, i + 16).map(async (blob) => {
            const response = await fetch(`${blob.url}?v=${blob.uploadedAt.getTime()}`);
            if (!response.ok) throw new Error("Copies unavailable");
            return linked(owner, await response.json());
          }),
        )),
      );
    cursor = page.cursor;
  } while (cursor);
  return found;
}

/** The client supplies one operation id, making a lost copy response safe to retry. */
export async function saveFork(owner: string, id: string, seed: ForkSeed): Promise<ForkSummary> {
  const existing = await entry(owner, id);
  if (existing) return existing;
  const info: ForkSummary = {
    id,
    name: seed.model.name,
    pieces: seed.model.pieces.length,
    created: Date.now() / 1000,
    sessionId: null,
  };
  await put(`${prefix(owner)}${id}.gz`, gzipSync(JSON.stringify(seed)), {
    ...options,
    contentType: "application/gzip",
  });
  await put(path(owner, id), JSON.stringify(info), { ...options, contentType: "application/json" });
  return info;
}

/** Bind the copy to `sessionId`; a copy whose run `after` ended moves on to the run carrying it on. */
export async function linkFork(owner: string, id: string, sessionId: string, after?: string | null): Promise<void> {
  const info = await entry(owner, id);
  if (!info) throw new Error("Copy unavailable");
  if (info.sessionId === sessionId) return;
  if (info.sessionId && info.sessionId !== after) throw new Refusal(409, "Copy already has a session.");
  const link: Link = { sessionId, runs: [...(info.runs ?? []), ...(info.sessionId ? [info.sessionId] : [])] };
  try {
    await put(sessionPath(owner, id), JSON.stringify(link), {
      ...options,
      allowOverwrite: !!info.sessionId,
      contentType: "application/json",
    });
  } catch (e) {
    // A lost response or simultaneous retry may have saved the same link already.
    const saved = await sessionLink(owner, id);
    if (saved?.sessionId === sessionId) return;
    if (saved) throw new Refusal(409, "Copy already has a session.");
    throw e;
  }
}

/** Delete a copy's model, metadata and session link; returns the session it had, if any. */
export async function deleteFork(owner: string, id: string): Promise<string | null> {
  const info = await entry(owner, id);
  if (!info) return null;
  await del([`${prefix(owner)}${id}.gz`, path(owner, id), sessionPath(owner, id)]);
  return info.sessionId;
}
