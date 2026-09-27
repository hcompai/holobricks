export type Matrix = [number, number, number, number, number, number, number, number, number];

export interface Piece {
  id: number;
  part: string;
  color: number;
  pos: [number, number, number];
  rot: Matrix;
  step: number;
}

export interface Step {
  index: number;
  title: string;
}

export interface Message {
  role: "user" | "assistant" | "system" | "tool";
  text: string;
  images: string[];
  at: number;
}

export type Status = "idle" | "building" | "done" | "error";

export interface BuildSummary {
  id: string;
  name: string;
  prompt: string;
  builder: string;
  status: Status;
  created: number;
  /** When the pieces last changed, in seconds; 0 when unknown. */
  updated: number;
  pieces: number;
  steps: number;
  width: number;
  depth: number;
  /** When the thumbnail was saved, in milliseconds; null when there is none. */
  thumbnail?: number | null;
}

export interface Build extends Omit<BuildSummary, "pieces" | "steps" | "thumbnail"> {
  /** Geometry fingerprint; optional for older static gallery exports. */
  revision?: string;
  pieces: Piece[];
  steps: Step[];
  messages: Message[];
}

export interface BomLine {
  part: string;
  title: string;
  color: number;
  colorName: string;
  hex: string;
  count: number;
  bricklinkPart: string;
  bricklinkColor: number;
}

export interface Bom {
  revision: string;
  pieces: number;
  validation: { status: "verified"; valid_until: number };
  lines: BomLine[];
  error?: string;
}

/** One view the builder asks for: seen from compass `angle` (0 front, 90 right), `elevation` degrees up, `zoom` times closer, centered on `at` (studs, studs, plates). */
export interface Camera {
  angle: number;
  elevation: number;
  zoom: number;
  at: [number, number, number] | null;
}

/** Studs x0 to x1 and y0 to y1, plates z0 to z1, all included. */
export interface Box {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
}

/** A render the builder is waiting for: the four standard views, or one `camera` view, of the model or only of `box`. */
export interface RenderRequest {
  request: string;
  camera: Camera | null;
  box: Box | null;
  /** How many pieces the model had when asked; only a viewer showing that many may answer. */
  pieces: number;
  revision: string;
}

export type BuildEvent =
  | { type: "hello"; build: BuildSummary }
  | { type: "build"; build: BuildSummary }
  | { type: "message"; message: Message }
  | { type: "step"; step: Step; pieces: Piece[]; width: number; depth: number }
  | { type: "rewind"; steps: number; width: number; depth: number }
  | { type: "thinking"; text: string; reset: boolean }
  | ({ type: "render" } & RenderRequest);

/** A static, read-only export of chosen builds (`vite build --mode gallery`), served without the Python server. */
export const GALLERY = import.meta.env.MODE === "gallery";

const LIVE_URLS = {
  builds: "/api/builds",
  build: (id: string) => `/api/builds/${id}`,
  bom: (id: string) => `/api/builds/${id}/bom`,
  thumbnail: (id: string) => `/api/builds/${id}/thumbnail.png`,
  download: (id: string) => `/api/builds/${id}/download.ldr`,
  part: (part: string) => `/api/parts/${encodeURIComponent(part)}`,
  ldconfig: "/api/ldconfig",
};

const GALLERY_URLS: typeof LIVE_URLS = {
  builds: "/gallery/builds.json",
  build: (id) => `/gallery/builds/${id}.json`,
  bom: (id) => `/gallery/builds/${id}.bom.json`,
  thumbnail: (id) => `/gallery/thumbnails/${id}.png`,
  download: (id) => `/gallery/builds/${id}.ldr`,
  part: (part) => `/gallery/parts/${encodeURIComponent(part)}`,
  ldconfig: "/gallery/LDConfig.ldr",
};

const urls = GALLERY ? GALLERY_URLS : LIVE_URLS;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    detail: string,
  ) {
    super(`${status}: ${detail}`);
  }
}

async function json<T>(response: Promise<Response>): Promise<T> {
  const r = await response;
  if (!r.ok) {
    const body = await r.text();
    let detail = body;
    try {
      const parsed = JSON.parse(body).detail;
      if (parsed) detail = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
    } catch {}
    throw new HttpError(r.status, detail);
  }
  return r.json() as Promise<T>;
}

const post = (url: string, body: unknown) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const api = {
  builds: () => json<BuildSummary[]>(fetch(urls.builds)),
  build: (id: string) => json<Build>(fetch(urls.build(id))),
  state: (id: string, after: string, signal: AbortSignal) =>
    json<{ token: string; build: Build | null; renders: RenderRequest[] }>(
      fetch(`/api/builds/${id}/state?after=${encodeURIComponent(after)}`, { signal, cache: "no-store" }),
    ),
  bom: (id: string) => json<Bom>(fetch(urls.bom(id), { cache: "no-store" })),
  thumbnailUrl: (id: string, version: number) => `${urls.thumbnail(id)}?v=${version}`,
  /** A chat image as WebP with its short side at most 240 pixels. */
  smallImageUrl: (url: string) => url.replace(/[^/]+$/, "small/$&.webp"),
  downloadUrl: urls.download,
  partUrl: urls.part,
  ldconfigUrl: urls.ldconfig,
  create: (prompt: string, images: string[] = []) =>
    json<BuildSummary>(post("/api/builds", { prompt, images, builder: "holo" })),
  say: (id: string, text: string, images: string[] = []) =>
    json<BuildSummary>(post(`/api/builds/${id}/messages`, { text, images })),
  stop: (id: string) => post(`/api/builds/${id}/stop`, {}),
  events: (id: string) => new EventSource(`/api/builds/${id}/events`),
  putRender: (id: string, request: string, png: Blob, pieces: number, revision: string) =>
    fetch(`/api/builds/${id}/renders/${request}`, {
      method: "PUT",
      body: png,
      headers: { "X-Pieces": String(pieces), "X-Revision": revision },
      signal: AbortSignal.timeout(8000),
    }),
  putThumbnail: (id: string, png: Blob) => fetch(`/api/builds/${id}/thumbnail.png`, { method: "PUT", body: png }),
};
