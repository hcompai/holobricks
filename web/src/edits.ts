import { useCallback, useEffect, useMemo, useState } from "react";
import { buildRevision } from "./buildRevision";
import type { Build, Matrix, Piece } from "./model";

/**
 * One change made by hand in the viewer to one or more pieces, undone as one, in LDraw units:
 * x right, y down, z away from the front. A turn is a quarter about the vertical line through `about` (x, z).
 */
export type Edit =
  | { kind: "delete"; ids: number[] }
  | { kind: "move"; ids: number[]; by: [number, number, number] }
  | { kind: "rotate"; ids: number[]; turns: 1 | -1; about: [number, number] }
  | { kind: "color"; ids: number[]; color: number };

export const STUD = 20;
export const PLATE = 8;
/** Pivots snap to half a stud, so a quarter turn keeps pieces on the grid they were on. */
const HALF_STUD = STUD / 2;

const STORE = "brickyard.edits";
const EDITED =
  "Edited in this browser: the verified parts list is for the builder's revision. Reset your edits to shop it.";

/** A build's edits, bound to the revision they were made on. */
interface Saved {
  revision: string;
  edits: Edit[];
}

const saved = (): Record<string, Saved> => {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? "{}");
  } catch {
    return {};
  }
};

function save(id: string, value: Saved | null) {
  const all = saved();
  if (value?.edits.length) all[id] = value;
  else delete all[id];
  try {
    localStorage.setItem(STORE, JSON.stringify(all));
  } catch (e) {
    console.error("Could not save the edits", e);
  }
}

// `|| 0` keeps -0 out of turned pieces, so they print like any other.
const clean = <T extends number[]>(values: T) => values.map((v) => v || 0) as T;

/** A quarter turn of `piece` about the vertical line through `about`; clockwise seen from above for 1. */
function turn(piece: Piece, turns: 1 | -1, [cx, cz]: [number, number]): Piece {
  const [a, b, c, d, e, f, g, h, i] = piece.rot;
  const [x, y, z] = piece.pos;
  const s = turns;
  return {
    ...piece,
    pos: clean([cx + s * (z - cz), y, cz - s * (x - cx)]),
    rot: clean<Matrix>([s * g, s * h, s * i, d, e, f, -s * a, -s * b, -s * c]),
  };
}

/** Where a group turns: the middle of its pieces' positions, on the half-stud grid. */
export function pivot(pieces: Piece[]): [number, number] {
  const middle = (k: 0 | 2) => {
    const values = pieces.map((p) => p.pos[k]);
    return Math.round((Math.min(...values) + Math.max(...values)) / 2 / HALF_STUD) * HALF_STUD;
  };
  return [middle(0), middle(2)];
}

/** The pieces with `edits` applied in order; pieces an edit names that are already deleted are skipped. */
export function applyEdits(pieces: Piece[], edits: Edit[]): Piece[] {
  const byId = new Map(pieces.map((p) => [p.id, p]));
  for (const edit of edits)
    for (const id of edit.ids) {
      const piece = byId.get(id);
      if (!piece) continue;
      if (edit.kind === "delete") byId.delete(id);
      else if (edit.kind === "move")
        byId.set(id, { ...piece, pos: [0, 1, 2].map((k) => piece.pos[k] + edit.by[k]) as Piece["pos"] });
      else if (edit.kind === "color") byId.set(id, { ...piece, color: edit.color });
      else byId.set(id, turn(piece, edit.turns, edit.about));
    }
  return pieces.filter((p) => byId.has(p.id)).map((p) => byId.get(p.id)!);
}

/** The model as an LDraw file, one STEP per build step, like the toolkit writes it. */
export function toLdraw(build: Build, pieces: Piece[]): string {
  const lines = [`0 ${build.name}`, `0 Name: ${build.id}.ldr`, "0 Author: Brickyard, edited in the browser", ""];
  for (const step of build.steps) {
    for (const p of pieces.filter((p) => p.step === step.index))
      lines.push(`1 ${p.color} ${p.pos.map(String).join(" ")} ${p.rot.map(String).join(" ")} ${p.part}`);
    lines.push(`0 STEP ${step.title}`.trimEnd());
  }
  return lines.join("\n") + "\n";
}

export interface Edits {
  /** The build as edited, or the build itself when it has no edits that apply. */
  build: Build | null;
  edits: Edit[];
  /** Whether the edits can change now: not while the builder works, and only on the revision they were made on. */
  editable: boolean;
  /** Edits made on a revision the builder has since replaced, kept until discarded. */
  stale: number;
  /** Edits hidden while the builder works, so its renders show its own model. */
  hidden: number;
  push: (edit: Edit) => void;
  undo: () => void;
  redo: () => void;
  canRedo: boolean;
  reset: () => void;
}

/** The hand edits of the open build, saved in this browser per build and revision. */
export function useEdits(build: Build | null): Edits {
  const id = build?.id ?? null;
  const [state, setState] = useState<Saved | null>(null);
  const [undone, setUndone] = useState<Edit[]>([]);
  const [edited, setEdited] = useState<Build | null>(null);

  useEffect(() => {
    const kept = id ? saved()[id] : undefined;
    // Edits saved before they named groups of pieces have no `ids`; they were only ever drafts.
    setState(kept ? { ...kept, edits: kept.edits.filter((e) => Array.isArray(e.ids)) } : null);
    setUndone([]);
  }, [id]);

  const building = build?.status === "building";
  const matches = !!build && (!state || state.revision === build.revision);
  const edits = matches ? (state?.edits ?? []) : [];
  const applies = !building && edits.length > 0;

  const pieces = useMemo(
    () => (build && applies ? applyEdits(build.pieces, edits) : null),
    [build?.pieces, applies, state],
  );

  useEffect(() => {
    if (!build || !pieces) return setEdited(null);
    let current = true;
    buildRevision(pieces).then((revision) => {
      if (!current) return;
      setEdited({
        ...build,
        pieces,
        revision,
        ldr: toLdraw(build, pieces),
        bom: { error: EDITED },
        shopping: { error: EDITED },
      });
    });
    return () => {
      current = false;
    };
  }, [build, pieces]);

  const update = useCallback(
    (next: Edit[]) => {
      if (!build) return;
      const value = next.length ? { revision: build.revision, edits: next } : null;
      setState(value);
      save(build.id, value);
    },
    [build?.id, build?.revision],
  );

  const editable = !!build && !building && matches;
  return {
    // Until the edited revision is hashed, keep the last one drawn rather than clearing the viewer.
    build: applies && edited?.id === id ? edited : build,
    edits,
    editable,
    stale: !matches && state ? state.edits.length : 0,
    hidden: building ? edits.length : 0,
    push: (edit) => {
      if (!editable) return;
      update([...edits, edit]);
      setUndone([]);
    },
    undo: () => {
      if (!editable || !edits.length) return;
      setUndone([...undone, edits[edits.length - 1]]);
      update(edits.slice(0, -1));
    },
    redo: () => {
      if (!editable || !undone.length) return;
      update([...edits, undone[undone.length - 1]]);
      setUndone(undone.slice(0, -1));
    },
    canRedo: editable && undone.length > 0,
    reset: () => {
      update([]);
      setUndone([]);
    },
  };
}
