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

/** What the builder reasoned and did before a message, step by step. */
export interface Work {
  /** In ms since the epoch. */
  start: number;
  end: number;
  steps: { reasoning: string; actions: string[] }[];
}

export interface Message {
  role: "user" | "assistant" | "system" | "tool";
  text: string;
  /** Image URLs; data and blob URLs show as they are, gallery paths have a small WebP beside them. */
  images: string[];
  work?: Work;
}

export type Status = "idle" | "building" | "done" | "error";

export interface Validation {
  status: "verified";
  valid_until: number;
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
  validation: Validation;
  lines: BomLine[];
}

export interface ShoppingPackage {
  version: 3;
  validation: Validation;
  id: string;
  name: string;
  revision: string;
  pieces: number;
  lots: number;
  xml: string;
}

export type Verified<T> = T | { error: string };

/** One revision of the model, as `bricks run` writes it to model.json.gz. */
export interface Model {
  name: string;
  /** Who made it: "holo" for Holo's builds. */
  builder: string;
  width: number;
  depth: number;
  /** When the pieces last changed, in seconds; 0 when unknown. */
  updated: number;
  revision: string;
  pieces: Piece[];
  steps: Step[];
  /** Every part the pieces use, packed as one LDraw MPD each. */
  parts: Record<string, string>;
  ldr: string;
  bom: Verified<Bom>;
  shopping: Verified<ShoppingPackage>;
}

export interface Build extends Model {
  id: string;
  status: Status;
  messages: Message[];
  /** Whether the builder takes a new message. */
  open: boolean;
}

/** Where a build is read from: a session of the signed-in user, the public library, or the showcases. */
export type Source = "session" | "public" | "showcase";

export interface BuildSummary {
  id: string;
  name: string;
  prompt: string;
  status: Status;
  /** In seconds. */
  created: number;
  pieces: number | null;
  thumbnail: string | null;
  source: Source;
  /** Who published it, for public builds. */
  author: string | null;
  /** The author's user id, for public builds. */
  owner: string | null;
  /** Listed to its owner only: a library build they made private. */
  private?: boolean;
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
  /** Only a viewer showing this revision may answer. */
  revision: string;
}

export const EMPTY_MODEL: Model = {
  name: "Untitled build",
  builder: "holo",
  width: 0,
  depth: 0,
  updated: 0,
  revision: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  pieces: [],
  steps: [],
  parts: {},
  ldr: "",
  bom: { error: "Nothing is built yet." },
  shopping: { error: "Nothing is built yet." },
};

export const verified = <T extends object>(value: Verified<T>): T | null => ("error" in value ? null : value);
