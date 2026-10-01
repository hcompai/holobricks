import { BlobNotFoundError, head, list, put } from "@vercel/blob";
import { gzipSync } from "node:zlib";
import { readSeed, type ForkSeed, type ForkSummary, type SavedFork } from "../../src/forkModel";
import { privateScope } from "./account";

const options = { access: "public", addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 } as const;
const prefix = (owner: string) => `models/${privateScope(owner)}/`;
const path = (owner: string, id: string) => `${prefix(owner)}${id}.json`;

async function entry(owner: string, id: string): Promise<ForkSummary | null> {
  try {
    const blob = await head(path(owner, id));
    const response = await fetch(`${blob.url}?v=${blob.uploadedAt.getTime()}`);
    if (!response.ok) throw new Error("Copy unavailable");
    return response.json();
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
    for (const blob of page.blobs.filter((b) => b.pathname.endsWith(".json"))) {
      const response = await fetch(`${blob.url}?v=${blob.uploadedAt.getTime()}`);
      if (!response.ok) throw new Error("Copies unavailable");
      found.push(await response.json());
    }
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
  if (info.sessionId && info.sessionId !== sessionId) throw new Error("Copy already has a session");
  await put(path(owner, id), JSON.stringify({ ...info, sessionId }), { ...options, contentType: "application/json" });
}
