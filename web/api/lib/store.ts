import { BlobNotFoundError, del, head, list, put } from "@vercel/blob";
import { gunzipSync, gzipSync } from "node:zlib";
import { clearHearts } from "./hearts";
import { Refusal } from "./http";
import {
  privateDelete,
  privateConfigured,
  privateEntry,
  privateFiles,
  privateFolder,
  privatePrefix,
  privateRead,
  privateToken,
  privateUrl,
  privateWrite,
} from "./privateStore";

/** Library metadata: public files use Blob URLs; private files use owner-authenticated API URLs. */
export interface Published {
  id: string;
  name: string;
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

export const ID = /^[\w-]{1,100}$/;
const PUBLIC = { access: "public", addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 } as const;
const PARALLEL = 16;
const entry = (id: string) => `library/${id}.json`;
/** Private entries sit apart, per owner, so listing the public library can never include them. */
const hidden = (owner: string, id: string) => `private/${encodeURIComponent(owner)}/${id}.json`;
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
  // Publishing again takes the place of a private entry left by a moderator, so it is never both.
  await del(hidden(published.owner, published.id)).catch(() => undefined);
  if (privateConfigured()) await removePrivate(published.owner, published.id);
  const gone = before.filter((url) => !written.includes(url));
  if (gone.length) await del(gone);
}

const fetched = async (url: string, uploaded: Date): Promise<Published | null> => {
  const response = await fetch(`${url}?v=${uploaded.getTime()}`);
  return response.ok ? response.json() : null;
};

async function read(path: string): Promise<Published | null> {
  try {
    const blob = await head(path);
    return await fetched(blob.url, blob.uploadedAt);
  } catch (e) {
    if (e instanceof BlobNotFoundError) return null;
    throw e;
  }
}

/** A public build. */
export const find = (id: string) => read(entry(id));

/** Read private metadata only from the authenticated store. Legacy entries migrate on owner access. */
async function ownPrivate(owner: string, id: string, migrateLegacy = true): Promise<Published | null> {
  if (privateConfigured()) {
    const response = await privateRead(privateEntry(owner, id));
    if (response) {
      const found: Published & { pending?: boolean } = await response.json();
      if (found.owner !== owner || found.id !== id) throw new Error("Invalid private build owner");
      if (found.pending) {
        await setPrivate(found, true);
        return ownPrivate(owner, id);
      }
      return found;
    }
  }
  if (!migrateLegacy) return null;
  const legacy = await read(hidden(owner, id));
  if (!legacy) return null;
  if (legacy.owner !== owner || legacy.id !== id) throw new Error("Invalid legacy build owner");
  await setPrivate(legacy, true);
  return ownPrivate(owner, id);
}

/** A build of `owner`'s, public or private. */
export const findOwn = async (owner: string, id: string) => (await ownPrivate(owner, id)) ?? (await find(id));

/** The private builds of `owner`, newest first, with owner-authenticated file URLs. */
export async function privateOf(owner: string): Promise<Published[]> {
  const legacy = await listed(privatePrefix(owner));
  for (const blob of legacy) {
    const published = await fetched(blob.url, blob.uploadedAt);
    if (published?.owner === owner) await setPrivate(published, true);
  }
  if (!privateConfigured()) return [];
  const entries = (await privateFiles(privatePrefix(owner))).filter(
    (b) => b.pathname.endsWith(".json") && !b.pathname.slice(privatePrefix(owner).length).includes("/"),
  );
  const found: Published[] = [];
  for (const entry of entries) {
    const id = entry.pathname.slice(privatePrefix(owner).length, -5);
    const published = await ownPrivate(owner, id);
    if (!published) continue;
    found.push(published);
  }
  return found.sort((a, b) => b.published - a.published);
}

const bare = (url: string) => url.split("?")[0];
/** Rewrite stored image references, never fetch URLs supplied inside a model. */
function rewritten(data: Buffer, urls: Map<string, string>): Buffer {
  const model = JSON.parse(gunzipSync(data, { maxOutputLength: 100 * 1024 * 1024 }).toString());
  for (const message of model.messages ?? [])
    message.images = (message.images ?? []).map((url: string) => urls.get(url) ?? urls.get(bare(url)) ?? url);
  return gzipSync(JSON.stringify(model));
}

async function removePrivate(owner: string, id: string) {
  const blobs = await privateFiles(privateFolder(owner, id));
  await privateDelete([privateEntry(owner, id), ...blobs.map((b) => b.pathname)]);
}

/** Copy before deleting: an unsuccessful move keeps the source, and a retry finishes cleanup. */
export async function setPrivate(published: Published, value: boolean) {
  privateToken();
  const owner = published.owner,
    id = published.id;
  if (value) {
    const saved = await privateRead(privateEntry(owner, id));
    if (!saved) {
      const blobs = await listed(folder(id));
      const urls = new Map(blobs.map((b) => [b.url, privateUrl(id, b.pathname.slice(folder(id).length))]));
      const model = blobs.find((b) => b.pathname === `${folder(id)}build.json.gz`);
      if (!model) throw new Error("Published model unavailable");
      for (const blob of blobs) {
        const response = await fetch(`${blob.url}?v=${blob.uploadedAt.getTime()}`, {
          redirect: "error",
          signal: AbortSignal.timeout(60_000),
        });
        if (!response.ok) throw new Error("Published file unavailable");
        const data = Buffer.from(await response.arrayBuffer());
        const name = blob.pathname.slice(folder(id).length);
        await privateWrite(
          privateFolder(owner, id) + name,
          name === "build.json.gz" ? rewritten(data, urls) : data,
          response.headers.get("content-type") ?? "application/octet-stream",
        );
      }
      await privateWrite(
        privateEntry(owner, id),
        JSON.stringify({
          ...published,
          pending: true,
          build: privateUrl(id, "build.json.gz"),
          thumbnail: published.thumbnail ? (urls.get(bare(published.thumbnail)) ?? null) : null,
        }),
        "application/json",
      );
    }
    const copied: Published & { pending?: boolean } = saved
      ? await saved.json()
      : await (await privateRead(privateEntry(owner, id)))!.json();
    if (copied.owner !== owner || copied.id !== id) throw new Error("Invalid private build owner");
    // Only acknowledge privacy after every old public object has been removed.
    const publicFiles = await files(id);
    if (publicFiles.length) await del(publicFiles);
    await del([entry(id), hidden(owner, id)]);
    delete copied.pending;
    await privateWrite(privateEntry(owner, id), JSON.stringify(copied), "application/json");
  } else {
    const response = await privateRead(privateEntry(owner, id));
    if (!response) {
      if (await find(id)) return; // Retry after a completed move.
      throw new Refusal(404, "No such private build.");
    }
    const stored: Published = await response.json();
    if (stored.owner !== owner || stored.id !== id) throw new Error("Invalid private build owner");
    const blobs = await privateFiles(privateFolder(owner, id));
    const urls = new Map<string, string>();
    for (const blob of blobs.filter((b) => !b.pathname.endsWith("/build.json.gz"))) {
      const name = blob.pathname.slice(privateFolder(owner, id).length);
      const file = await privateRead(blob.pathname);
      if (!file) throw new Error("Private file unavailable");
      urls.set(
        privateUrl(id, name),
        await save(
          id,
          name,
          Buffer.from(await file.arrayBuffer()),
          file.headers.get("content-type") ?? "application/octet-stream",
        ),
      );
    }
    const model = await privateRead(privateFolder(owner, id) + "build.json.gz");
    if (!model) throw new Error("Private model unavailable");
    const build = await save(
      id,
      "build.json.gz",
      rewritten(Buffer.from(await model.arrayBuffer()), urls),
      "application/gzip",
    );
    await put(
      entry(id),
      JSON.stringify({ ...stored, build, thumbnail: stored.thumbnail ? (urls.get(stored.thumbnail) ?? null) : null }),
      { ...PUBLIC, contentType: "application/json" },
    );
    await removePrivate(owner, id);
  }
}

/** Owner-only file route. No arbitrary path, URL, or owner can be supplied by the caller. */
export async function privateFile(owner: string, id: string, name: string): Promise<Response> {
  if (!/^(?:build\.json\.gz|thumbnail[\w.-]*\.(?:png|jpeg|webp)|images\/\d+\.(?:png|jpg|webp))$/.test(name))
    throw new Refusal(404, "No such file.");
  if (!(await ownPrivate(owner, id, false))) throw new Refusal(404, "No such private build.");
  const response = await privateRead(privateFolder(owner, id) + name);
  if (!response) throw new Refusal(404, "No such file.");
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

/** Operator migration: existing hidden entries move through the same retryable privacy operation. */
export async function migratePrivate(): Promise<number> {
  privateToken();
  let count = 0;
  for (const blob of await listed("private/")) {
    const published = await fetched(blob.url, blob.uploadedAt);
    if (!published || !ID.test(published.id) || blob.pathname !== hidden(published.owner, published.id))
      throw new Error("Invalid legacy private entry");
    await setPrivate(published, true);
    count++;
  }
  return count;
}

const download = async (blob: { url: string; uploadedAt: Date }) => {
  const response = await fetch(`${blob.url}?v=${blob.uploadedAt.getTime()}`, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error("Published file unavailable");
  return Buffer.from(await response.arrayBuffer());
};

/** Operator migration: public builds keep no chat. Each changed build's original files go to `backup` first. */
export async function stripPublicChats(apply: boolean, backup: (path: string, data: Buffer) => Promise<void>) {
  const counts = { builds: 0, chats: 0, prompts: 0, images: 0 };
  for (const blob of await listed("library/")) {
    const original = await download(blob);
    const published: Published & { prompt?: string } = JSON.parse(original.toString());
    const id = published.id;
    if (!ID.test(id) || blob.pathname !== entry(id)) throw new Error("Invalid library entry");
    const kept = await listed(folder(id));
    const model = kept.find((b) => b.pathname === `${folder(id)}build.json.gz`);
    const images = kept.filter((b) => b.pathname.startsWith(`${folder(id)}images/`));
    const data = model ? await download(model) : null;
    const build = data ? JSON.parse(gunzipSync(data, { maxOutputLength: 100 * 1024 * 1024 }).toString()) : null;
    const chat = !!build?.messages?.length;
    const prompt = "prompt" in published;
    if (!chat && !prompt && !images.length) continue;
    counts.builds++;
    counts.chats += Number(chat);
    counts.prompts += Number(prompt);
    counts.images += images.length;
    if (!apply) continue;
    await backup(`${id}/entry.json`, original);
    if (data) await backup(`${id}/build.json.gz`, data);
    for (const image of images) await backup(`${id}/${image.pathname.slice(folder(id).length)}`, await download(image));
    if (chat) await save(id, "build.json.gz", gzipSync(JSON.stringify({ ...build, messages: [] })), "application/gzip");
    if (prompt) {
      delete published.prompt;
      await put(entry(id), JSON.stringify(published), { ...PUBLIC, contentType: "application/json" });
    }
    if (images.length) await del(images.map((b) => b.url));
  }
  return counts;
}

/** Sign every library build of `owner`'s, public or private, with `author`. */
export async function reauthor(owner: string, author: string) {
  for (const published of await library())
    if (published.owner === owner && published.author !== author)
      await put(entry(published.id), JSON.stringify({ ...published, author }), {
        ...PUBLIC,
        contentType: "application/json",
      });
  for (const published of await privateOf(owner))
    if (published.author !== author)
      await privateWrite(
        privateEntry(owner, published.id),
        JSON.stringify({ ...published, author }),
        "application/json",
      );
}

/** Every public build, newest first. */
export async function library(): Promise<Published[]> {
  const blobs = await listed("library/");
  const found: (Published | null)[] = [];
  for (let i = 0; i < blobs.length; i += PARALLEL)
    found.push(...(await Promise.all(blobs.slice(i, i + PARALLEL).map((b) => fetched(b.url, b.uploadedAt)))));
  return found.filter((p): p is Published => p !== null).sort((a, b) => b.published - a.published);
}

/** Take a build out of the library, public or private, then delete its files. */
export async function unlist(id: string, owner?: string) {
  await del(owner ? [entry(id), hidden(owner, id)] : entry(id));
  if (owner && privateConfigured()) await removePrivate(owner, id);
  const urls = await files(id);
  if (urls.length) await del(urls);
  await clearHearts(id);
}

/** Renaming a published/imported project keeps its files, visibility and URL. */
export async function renamePublished(owner: string, id: string, name: string) {
  const own = await ownPrivate(owner, id);
  if (own) {
    await privateWrite(privateEntry(owner, id), JSON.stringify({ ...own, name }), "application/json");
    return;
  }
  const published = await find(id);
  if (published?.owner === owner)
    await put(entry(id), JSON.stringify({ ...published, name }), { ...PUBLIC, contentType: "application/json" });
}
