import { BlobNotFoundError, del, head, list, put } from "@vercel/blob";

/** A build in the public library; its files are public, under builds/<id>/. */
export interface Published {
  id: string;
  name: string;
  prompt: string;
  pieces: number;
  steps: number;
  author: string;
  /** The author's portal user id. */
  owner: string;
  /** In seconds. */
  published: number;
  thumbnail: string | null;
  build: string;
}

const PUBLIC = { access: "public", addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 } as const;
const PARALLEL = 16;
const entry = (id: string) => `library/${id}.json`;
const folder = (id: string) => `builds/${id}/`;

async function listed(prefix: string) {
  const blobs = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    blobs.push(...page.blobs);
    cursor = page.cursor;
  } while (cursor);
  return blobs;
}

/** Write one file of a build; returns its public URL. */
export async function save(id: string, name: string, data: Blob | Buffer, contentType: string): Promise<string> {
  return (await put(`${folder(id)}${name}`, data, { ...PUBLIC, contentType })).url;
}

export const files = async (id: string) => (await listed(folder(id))).map((b) => b.url);

/** Put the build in the library, then delete the files its previous publication used and this one does not. */
export async function enter(published: Published, before: string[], written: string[]) {
  await put(entry(published.id), JSON.stringify(published), { ...PUBLIC, contentType: "application/json" });
  const gone = before.filter((url) => !written.includes(url));
  if (gone.length) await del(gone);
}

const fetched = async (url: string, uploaded: Date): Promise<Published | null> => {
  const response = await fetch(`${url}?v=${uploaded.getTime()}`);
  return response.ok ? response.json() : null;
};

export async function find(id: string): Promise<Published | null> {
  try {
    const blob = await head(entry(id));
    return await fetched(blob.url, blob.uploadedAt);
  } catch (e) {
    if (e instanceof BlobNotFoundError) return null;
    throw e;
  }
}

/** Every public build, newest first. */
export async function library(): Promise<Published[]> {
  const blobs = await listed("library/");
  const found: (Published | null)[] = [];
  for (let i = 0; i < blobs.length; i += PARALLEL)
    found.push(...(await Promise.all(blobs.slice(i, i + PARALLEL).map((b) => fetched(b.url, b.uploadedAt)))));
  return found.filter((p): p is Published => p !== null).sort((a, b) => b.published - a.published);
}

/** Take a build out of the library, then delete its files. */
export async function unlist(id: string) {
  await del(entry(id));
  const urls = await files(id);
  if (urls.length) await del(urls);
}
