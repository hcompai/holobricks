import { current, key } from "./account";
import { sessions } from "./agent";
import type { Edit } from "./edits";
import type { Build, BuildSummary, Model, Status } from "./model";
import { BrickScene, provideParts } from "./scene";
import { status, unpack } from "./session";

const GALLERY = "/gallery";
const API = "/api/builds";
const IMPORTS = "/api/imports";
import type { ForkSeed, ForkSummary, SavedFork } from "./forkModel";

const STORE = "brickyard.library";

/** What the browser remembers of a session's model, since the platform keeps only its chat. */
interface Card {
  name: string;
  prompt: string;
  pieces: number;
  thumbnail?: string;
  recoveredFrom?: string;
  recoveryAttempt?: string;
  forkStarting?: boolean;
  /** The revision the thumbnail shows. */
  revision?: string;
}

let parsed: { raw: string | null; all: Record<string, Card> } = { raw: null, all: {} };

/** Parsed again only when the store changes: thumbnails make it large. */
const cards = (): Record<string, Card> => {
  const raw = localStorage.getItem(STORE);
  if (raw === parsed.raw) return parsed.all;
  try {
    parsed = { raw, all: JSON.parse(raw ?? "{}") };
  } catch {
    parsed = { raw, all: {} };
  }
  return parsed.all;
};

const NEW_CARD: Card = { name: "Untitled build", prompt: "", pieces: 0 };

export const card = (id: string): Card | undefined => cards()[id];

const listeners = new Set<(id: string) => void>();

/** Call `listener` with each build id this browser remembers something new about; returns the unsubscribe. */
export function onRemember(listener: (id: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function remember(id: string, card: Partial<Card>) {
  const all = cards();
  try {
    localStorage.setItem(STORE, JSON.stringify({ ...all, [id]: { ...NEW_CARD, ...all[id], ...card } }));
  } catch (e) {
    console.error("Could not remember the build", e);
    return;
  }
  for (const listener of listeners) listener(id);
}

interface ShowcaseSummary {
  id: string;
  name: string;
  prompt: string;
  status: Status;
  created: number;
  pieces: number;
  /** When scripts/thumbnails.mjs drew its tile, in milliseconds. */
  thumbnail?: number;
}

/** A build in the public library, as the API lists it. */
interface Published {
  id: string;
  name: string;
  prompt: string;
  pieces: number;
  author: string;
  owner: string;
  published: number;
  thumbnail: string | null;
  build: string;
}

async function showcases(): Promise<BuildSummary[]> {
  const response = await fetch(`${GALLERY}/builds.json`);
  if (!response.ok || !response.headers.get("content-type")?.includes("json")) return [];
  const summaries: ShowcaseSummary[] = await response.json();
  return summaries.map((s) => ({
    ...s,
    thumbnail: s.thumbnail == null ? null : `${GALLERY}/thumbnails/${s.id}.webp?v=${s.thumbnail}`,
    source: "showcase",
    author: null,
    owner: null,
  }));
}

export async function showcase(id: string): Promise<Build> {
  const response = await fetch(`${GALLERY}/builds/${encodeURIComponent(id)}.json`);
  if (!response.ok) throw new Error(`No showcase ${id}`);
  return { ...(await response.json()), id, open: false };
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, init);
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error ?? `The library is unavailable (HTTP ${response.status}).`);
  return body as T;
}

/** Read the library API as the signed-in user. */
function read<T>(params: Record<string, string> = {}): Promise<T> {
  const query = new URLSearchParams(params);
  return api<T>(query.size ? `${API}?${query}` : API, { headers: signed() });
}

/** What this browser published: the library's Blob reads can lag a publication by a minute. */
const fresh = new Map<string, Published>();

const newest = (p: Published) => {
  const mine = fresh.get(p.id);
  return mine && mine.published > p.published ? mine : p;
};

/** Everyone's public builds, newest first. */
async function community(): Promise<BuildSummary[]> {
  return (await read<Published[]>()).map(newest).map(summary);
}

/** The signed-in user's private library builds, newest first. */
async function hidden(): Promise<BuildSummary[]> {
  return (await read<Published[]>({ mine: "1" })).map((p) => ({
    ...summary(p),
    private: true,
  }));
}

const summary = (p: Published): BuildSummary => ({
  id: p.id,
  name: p.name,
  prompt: p.prompt,
  status: "done",
  created: p.published,
  pieces: p.pieces,
  thumbnail: p.thumbnail,
  source: "public",
  author: p.author,
  owner: p.owner,
});

export async function publicBuild(id: string): Promise<Build> {
  const published = newest(await read<Published>({ id }));
  const response = await fetch(published.build);
  if (!response.ok) throw new Error(`No public build ${id}`);
  return { ...(await unpack<Build>(await response.blob())), id, open: false };
}

const signed = () => ({ Authorization: `Bearer ${current()?.pass}`, "X-Agents-Key": key() });

/** Publish a build of the signed-in user as it is now, with this browser's hand edits and a thumbnail. */
export async function publish(id: string, thumbnail: string | null, edits: { revision: string; edits: Edit[] } | null) {
  const published = await api<Published>(API, {
    method: "POST",
    headers: { ...signed(), "Content-Type": "application/json" },
    body: JSON.stringify({ id, thumbnail, edits }),
  });
  fresh.set(id, published);
  return published;
}

/** A HoloBricks model file as the browser reads it, before the library checks it. */
export type ModelFile = Pick<Model, "name" | "pieces" | "parts"> & Partial<Build>;

/** Read a model file (a `brickyard-gallery` export or a session's model.json, gzipped or not), or say why not. */
export async function readModel(file: Blob): Promise<ModelFile> {
  const model = await unpack<Partial<ModelFile>>(file).catch(() => null);
  if (!Array.isArray(model?.pieces) || !model.pieces.length)
    throw new Error("This file is not a HoloBricks model: choose a model's .json or .json.gz.");
  if (!model.parts || typeof model.parts !== "object")
    throw new Error("This model has no part geometry: export it with brickyard-gallery, then import that file.");
  return { ...model, name: model.name || "Imported build" } as ModelFile;
}

/** A thumbnail of the model, drawn offscreen, or null if its parts do not draw. */
async function cover(model: ModelFile): Promise<string | null> {
  provideParts(model.parts);
  const scene = new BrickScene(document.createElement("div"), { interactive: false });
  try {
    if (!(await scene.setPieces(model.pieces))) return null;
    const png = await scene.thumbnail();
    return png ? await thumbnail(png) : null;
  } catch (e) {
    console.error("Could not draw the imported model", e);
    return null;
  } finally {
    scene.dispose();
  }
}

/** Import a model into the public library as the signed-in user's build; returns its new id. */
export async function importModel(model: ModelFile): Promise<string> {
  const json = new Blob([JSON.stringify({ model, thumbnail: await cover(model) })]);
  const body = await new Response(json.stream().pipeThrough(new CompressionStream("gzip"))).blob();
  const published = await api<Published>(IMPORTS, {
    method: "POST",
    headers: { ...signed(), "Content-Type": "application/gzip" },
    body,
  });
  return published.id;
}

/** Make one of the user's library builds private, or public again; it keeps its link. */
export async function setPrivate(id: string, value: boolean) {
  await api(API, {
    method: "PATCH",
    headers: { ...signed(), "Content-Type": "application/json" },
    body: JSON.stringify({ id, private: value }),
  });
}

/** Take a build out of the library and delete its files; for an imported build, that deletes it. */
export async function unpublish(id: string) {
  await api(`${API}?id=${encodeURIComponent(id)}`, { method: "DELETE", headers: signed() });
  fresh.delete(id);
}

/** A section of the library page. */
export type Shelf = "mine" | "public";

/** Where the library lists a build from, in the order it lists them; each loads, or fails, on its own. */
export const LISTINGS = ["session", "fork", "public", "private", "showcase"] as const;
export type Listing = (typeof LISTINGS)[number];

export const listing = (b: BuildSummary): Listing => (b.source === "fork" ? "fork" : b.private ? "private" : b.source);

export const SHELF: Record<Listing, Shelf> = {
  session: "mine",
  fork: "mine",
  private: "mine",
  public: "public",
  showcase: "public",
};

/** The signed-in user's builds, newest first, then everyone's public builds, then the showcases; with the listings that failed to load. */
export async function library(): Promise<{ builds: BuildSummary[]; failed: Listing[] }> {
  const [sessionsLoaded, sharedLoaded, hiddenLoaded, shownLoaded, forksLoaded] = await Promise.allSettled([
    sessions(),
    community(),
    hidden(),
    showcases(),
    current() ? api<ForkSummary[]>("/api/forks", { headers: signed() }) : Promise.resolve([]),
  ]);
  const failed: Listing[] = [];
  const value = <T>(result: PromiseSettledResult<T[]>, from: Listing): T[] => {
    if (result.status === "fulfilled") return result.value;
    console.error(result.reason);
    failed.push(from);
    return [];
  };
  const mine = value(sessionsLoaded, "session");
  const shared = value(sharedLoaded, "public");
  const own = value(hiddenLoaded, "private");
  const shown = value(shownLoaded, "showcase");
  const forks = value(forksLoaded, "fork");
  const known = cards();
  const listed = new Map(shared.map((p) => [p.id, p]));
  const builds = mine.map((s): BuildSummary => {
    const saved = known[s.id];
    const published = listed.get(s.id);
    const prompt = saved?.prompt || s.firstMessage?.message || published?.prompt || "";
    return {
      id: s.id,
      name: [saved?.name, published?.name, prompt.slice(0, 60)].find((n) => n && n !== NEW_CARD.name) ?? NEW_CARD.name,
      prompt,
      status: status(s.status),
      created: s.createdAt.getTime() / 1000,
      pieces: saved?.pieces ?? published?.pieces ?? null,
      thumbnail: saved?.thumbnail ?? published?.thumbnail ?? null,
      source: "session",
      author: null,
      owner: null,
    };
  });
  // A build is public or private, never both: the public listing wins if a stale private entry lingers.
  const privately = own.filter((p) => !listed.has(p.id));
  const forkRuns = new Set(forks.flatMap((f) => (f.sessionId ? [f.sessionId] : [])));
  const copies: BuildSummary[] = forks.map((f) => {
    const run = builds.find((b) => b.id === f.sessionId);
    const saved = known[f.id];
    const rendered = f.sessionId ? known[f.sessionId] : null;
    return {
      ...f,
      name: f.name,
      prompt: run?.prompt ?? "",
      pieces: run?.pieces ?? f.pieces,
      status: run?.status ?? "done",
      thumbnail:
        rendered?.thumbnail && rendered.revision !== saved?.revision
          ? rendered.thumbnail
          : (saved?.thumbnail ?? run?.thumbnail ?? null),
      source: "fork",
      author: null,
      owner: current()?.user.id ?? null,
      private: !listed.has(f.id),
    };
  });
  return {
    builds: [...builds.filter((b) => !forkRuns.has(b.id)), ...copies, ...shared, ...privately, ...shown],
    failed,
  };
}

const THUMBNAIL_SIDE = 320;

/** A render as a small WebP data URL, to keep beside the build. */
export async function thumbnail(png: Blob): Promise<string> {
  const bitmap = await createImageBitmap(png);
  const scale = Math.min(1, THUMBNAIL_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/webp", 0.8);
}

export const savedFork = (id: string) =>
  api<SavedFork>(`/api/forks?id=${encodeURIComponent(id)}`, { headers: signed() });

export async function copyModel(id: string, seed: ForkSeed): Promise<string> {
  const json = new Blob([JSON.stringify({ id, seed })]);
  const body = await new Response(json.stream().pipeThrough(new CompressionStream("gzip"))).blob();
  await api<ForkSummary>("/api/forks", {
    method: "POST",
    headers: { ...signed(), "Content-Type": "application/gzip" },
    body,
  });
  remember(id, { name: seed.model.name, pieces: seed.model.pieces.length });
  return id;
}

export async function linkFork(id: string, sessionId: string) {
  await api("/api/forks", {
    method: "PATCH",
    headers: { ...signed(), "Content-Type": "application/json" },
    body: JSON.stringify({ id, sessionId }),
  });
}
