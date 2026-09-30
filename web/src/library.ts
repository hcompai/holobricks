import { current, key } from "./account";
import { sessions } from "./agent";
import type { Edit } from "./edits";
import type { Build, BuildSummary, Status } from "./model";
import { status, unpack } from "./session";

const GALLERY = "/gallery";
const API = "/api/builds";
const STORE = "brickyard.library";

/** What the browser remembers of a session's model, since the platform keeps only its chat. */
interface Card {
  name: string;
  prompt: string;
  pieces: number;
  thumbnail?: string;
}

const cards = (): Record<string, Card> => {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? "{}");
  } catch {
    return {};
  }
};

const NEW_CARD: Card = { name: "Untitled build", prompt: "", pieces: 0 };

export const card = (id: string): Card | undefined => cards()[id];

export function remember(id: string, card: Partial<Card>) {
  const all = cards();
  all[id] = { ...NEW_CARD, ...all[id], ...card };
  try {
    localStorage.setItem(STORE, JSON.stringify(all));
  } catch (e) {
    console.error("Could not remember the build", e);
  }
}

interface ShowcaseSummary {
  id: string;
  name: string;
  prompt: string;
  status: Status;
  created: number;
  pieces: number;
  thumbnail: number | null;
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
    thumbnail: s.thumbnail == null ? null : `${GALLERY}/thumbnails/${s.id}.png?v=${s.thumbnail}`,
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

/** The library API's URL; signed-in users can change the library, so they skip the shared cache. */
function read(params: Record<string, string> = {}): string {
  const query = new URLSearchParams(params);
  if (current()) query.set("t", String(Date.now()));
  return query.size ? `${API}?${query}` : API;
}

/** Everyone's public builds, newest first. */
async function community(): Promise<BuildSummary[]> {
  const published = await api<Published[]>(read());
  return published.map((p) => ({
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
  }));
}

export async function publicBuild(id: string): Promise<Build> {
  const published = await api<Published>(read({ id }));
  const response = await fetch(published.build);
  if (!response.ok) throw new Error(`No public build ${id}`);
  return { ...(await unpack<Build>(await response.blob())), id, open: false };
}

const signed = () => ({ Authorization: `Bearer ${current()?.pass}`, "X-Agents-Key": key() });

/** Publish a build of the signed-in user as it is now, with this browser's hand edits and a thumbnail. */
export async function publish(id: string, thumbnail: string | null, edits: { revision: string; edits: Edit[] } | null) {
  return api<Published>(API, {
    method: "POST",
    headers: { ...signed(), "Content-Type": "application/json" },
    body: JSON.stringify({ id, thumbnail, edits }),
  });
}

export async function unpublish(id: string) {
  await api(`${API}?id=${encodeURIComponent(id)}`, { method: "DELETE", headers: signed() });
}

/** A part of the library that loads on its own. */
export type Shelf = "mine" | "public";

/** The signed-in user's builds, newest first, then everyone's public builds, then the showcases; with the shelves that failed to load. */
export async function library(): Promise<{ builds: BuildSummary[]; failed: Shelf[] }> {
  const [sessionsLoaded, sharedLoaded, shownLoaded] = await Promise.allSettled([
    current() ? sessions() : Promise.resolve([]),
    community(),
    showcases(),
  ]);
  const failed: Shelf[] = [];
  const value = <T>(result: PromiseSettledResult<T[]>, shelf: Shelf): T[] => {
    if (result.status === "fulfilled") return result.value;
    console.error(result.reason);
    if (!failed.includes(shelf)) failed.push(shelf);
    return [];
  };
  const mine = value(sessionsLoaded, "mine");
  const shared = value(sharedLoaded, "public");
  const shown = value(shownLoaded, "public");
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
  return { builds: [...builds.sort((a, b) => b.created - a.created), ...shared, ...shown], failed };
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
