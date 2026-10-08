import { BlobNotFoundError, del, head, list, put } from "@vercel/blob";
import { gzipSync } from "node:zlib";
import { readSeed, type ForkSeed, type ForkSummary, type SavedFork } from "../../src/forkModel";
import { privateScope } from "./account";
import { Refusal } from "./http";

export const isFork = (id: string) => /^fork-[a-f0-9-]{36}$/.test(id);
/** A continuation's sessions sit in groups of their own, one per session they carry on from. */
export const inGroupOf = (id: string, group: string | null | undefined) =>
  group === id || !!group?.startsWith(`${id}+`);

const options = { access: "public", addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 } as const;
const prefix = (owner: string) => `models/${privateScope(owner)}/`;
const path = (owner: string, id: string) => `${prefix(owner)}${id}.json`;
const sessionPath = (owner: string, id: string) => `${prefix(owner)}${id}.session.json`;

/** Written once: a cached pre-start metadata record cannot hide an accepted session. */
async function sessionLink(owner: string, id: string): Promise<string | null> {
  try {
    const blob = await head(sessionPath(owner, id));
    const response = await fetch(blob.url);
    if (!response.ok) throw new Error("Session link unavailable");
    return (await response.json()).sessionId;
  } catch (e) {
    if (e instanceof BlobNotFoundError) return null;
    throw e;
  }
}

async function linked(owner: string, info: ForkSummary): Promise<ForkSummary> {
  return { ...info, sessionId: (await sessionLink(owner, info.id)) ?? info.sessionId };
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

export async function linkFork(owner: string, id: string, sessionId: string): Promise<void> {
  const info = await entry(owner, id);
  if (!info) throw new Error("Copy unavailable");
  if (info.sessionId) {
    if (info.sessionId !== sessionId) throw new Refusal(409, "Copy already has a session.");
    return;
  }
  try {
    await put(sessionPath(owner, id), JSON.stringify({ sessionId }), {
      ...options,
      allowOverwrite: false,
      contentType: "application/json",
    });
  } catch (e) {
    // A lost response or simultaneous retry may have saved the same link already.
    const saved = await sessionLink(owner, id);
    if (saved === sessionId) return;
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
