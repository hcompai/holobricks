import { buildRevision } from "../../src/buildRevision";
import { toLdraw } from "../../src/edits";
import type { Build, Message, Piece, Step } from "../../src/model";
import { Refusal } from "./http";

/** What one import may hold; the largest Holo builds are about 17,000 pieces and 3 MB. */
export const LIMITS = { pieces: 50_000, steps: 2_000, parts: 2_000, geometry: 30_000_000 };
const UNVERIFIED = "Imported from a file: the parts list was not verified against BrickLink.";
const PART = /^[\w.-]{1,64}$/;

const refuse = (why: string): never => {
  throw new Refusal(400, `This is not a HoloBricks model: ${why}.`);
};

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const whole = (value: unknown): value is number => Number.isSafeInteger(value);
const text = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");

function piece(value: unknown, i: number): Piece {
  const p = value as Partial<Piece> | null;
  const ok =
    p &&
    whole(p.id) &&
    typeof p.part === "string" &&
    PART.test(p.part) &&
    whole(p.color) &&
    whole(p.step) &&
    p.step >= 0 &&
    Array.isArray(p.pos) &&
    p.pos.length === 3 &&
    p.pos.every(finite) &&
    Array.isArray(p.rot) &&
    p.rot.length === 9 &&
    p.rot.every(finite);
  if (!ok) refuse(`piece ${i + 1} is malformed`);
  return { id: p!.id!, part: p!.part!, color: p!.color!, step: p!.step!, pos: p!.pos!, rot: p!.rot! };
}

function steps(value: unknown, pieces: Piece[]): Step[] {
  const given = Array.isArray(value) ? value.slice(0, LIMITS.steps) : [];
  const titles = new Map(given.map((s) => [s?.index, text(s?.title, 120)]));
  const used = [...new Set(pieces.map((p) => p.step))].sort((a, b) => a - b);
  return used.map((index) => ({ index, title: titles.get(index) || `Step ${index + 1}` }));
}

function parts(value: unknown, pieces: Piece[]): Record<string, string> {
  if (!value || typeof value !== "object") refuse("it has no part geometry; export it with brickyard-gallery");
  const given = value as Record<string, unknown>;
  const needed = [...new Set(pieces.map((p) => p.part))];
  if (needed.length > LIMITS.parts) refuse(`it uses more than ${LIMITS.parts} different parts`);
  let size = 0;
  const kept: Record<string, string> = {};
  for (const part of needed) {
    const packed = given[part];
    // The viewer only parses a complete pack: one MPD per part, with the part's own geometry inside.
    if (typeof packed !== "string" || !packed.startsWith("0 FILE ") || !/\n[134] /m.test(packed))
      refuse(`part ${part} has no geometry; export it with brickyard-gallery`);
    size += (packed as string).length;
    if (size > LIMITS.geometry) refuse("its part geometry is too large");
    kept[part] = packed as string;
  }
  return kept;
}

/** A model file (a `brickyard-gallery` export or a session's model.json), checked and made into a library build. */
export async function imported(input: unknown, id: string): Promise<Build> {
  const given = input as Record<string, unknown> | null;
  if (!given || typeof given !== "object" || !Array.isArray(given.pieces)) refuse("it has no pieces");
  const list = given!.pieces as unknown[];
  if (!list.length) refuse("it has no pieces");
  if (list.length > LIMITS.pieces) refuse(`it has more than ${LIMITS.pieces.toLocaleString("en")} pieces`);
  const pieces = list.map(piece);
  if (new Set(pieces.map((p) => p.id)).size !== pieces.length) refuse("two pieces share an id");
  const model = {
    id,
    name: text(given!.name, 120).trim() || "Imported build",
    builder: text(given!.builder, 40) || "import",
    width: whole(given!.width) ? (given!.width as number) : 0,
    depth: whole(given!.depth) ? (given!.depth as number) : 0,
    updated: Date.now() / 1000,
    pieces,
    steps: steps(given!.steps, pieces),
    parts: parts(given!.parts, pieces),
    messages: [] as Message[],
    status: "done" as const,
    open: false,
    bom: { error: UNVERIFIED },
    shopping: { error: UNVERIFIED },
  };
  return { ...model, revision: await buildRevision(pieces), ldr: toLdraw(model as Build, pieces) };
}
