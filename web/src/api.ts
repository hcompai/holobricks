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
  role: "user" | "assistant" | "system";
  text: string;
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
  pieces: number;
  steps: number;
  width: number;
  depth: number;
  thumbnail?: boolean;
}

export interface Build extends Omit<BuildSummary, "pieces" | "steps" | "thumbnail"> {
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
}

export type BuildEvent =
  | { type: "hello"; build: BuildSummary }
  | { type: "build"; build: BuildSummary }
  | { type: "message"; message: Message }
  | { type: "step"; step: Step; pieces: Piece[] };

async function json<T>(response: Promise<Response>): Promise<T> {
  const r = await response;
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

const post = (url: string, body: unknown) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const api = {
  builds: () => json<BuildSummary[]>(fetch("/api/builds")),
  build: (id: string) => json<Build>(fetch(`/api/builds/${id}`)),
  bom: (id: string) => json<BomLine[]>(fetch(`/api/builds/${id}/bom`)),
  create: (prompt: string) => json<BuildSummary>(post("/api/builds", { prompt })),
  say: (id: string, text: string) => json<BuildSummary>(post(`/api/builds/${id}/messages`, { text })),
  events: (id: string) => new EventSource(`/api/builds/${id}/events`),
  putThumbnail: (id: string, png: Blob) => fetch(`/api/builds/${id}/thumbnail.png`, { method: "PUT", body: png }),
  thumbnailUrl: (id: string) => `/api/builds/${id}/thumbnail.png`,
  downloadUrl: (id: string) => `/api/builds/${id}/download.ldr`,
  partUrl: (part: string, color: number) => `/api/parts/${encodeURIComponent(part)}?color=${color}`,
};
