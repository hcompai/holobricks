import { useEffect, useState } from "react";
import { loadAsset } from "./loadAsset";
import type { Piece } from "./model";

/** A part the editor can put in a piece's place, as `scripts/pack-toolkit.py` lists it. */
export interface CatalogPart {
  part: string;
  title: string;
  /** W x D at rotation 0. */
  studs: [number, number];
  plates: number;
}

/** The parts Holo builds with, each packed as one LDraw MPD like a model's own parts. */
export interface PartCatalog {
  parts: CatalogPart[];
  packs: Record<string, string>;
}

const CATALOG = "/parts.json";

let catalog: Promise<PartCatalog | null> | null = null;

/** The deployed catalog, read once; null when the app was built without one. */
export function partCatalog(): Promise<PartCatalog | null> {
  // A static host answers a missing file with the app's page, so a catalog that does not parse is no catalog.
  catalog ??= loadAsset(CATALOG, undefined, 30000)
    .then((text) => {
      const parsed: PartCatalog = JSON.parse(text);
      return Array.isArray(parsed.parts) && parsed.packs ? parsed : null;
    })
    .catch(() => null);
  void catalog.then((c) => c ?? (catalog = null));
  return catalog;
}

/** The catalog once loaded: undefined while loading, null without one. */
export function usePartCatalog(enabled: boolean): PartCatalog | null | undefined {
  const [loaded, setLoaded] = useState<PartCatalog | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    void partCatalog().then((c) => current && setLoaded(c));
    return () => {
      current = false;
    };
  }, [enabled]);
  return loaded;
}

/** Sizes written "2x4" or "2 x 4" read alike. */
const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/(\d)\s*x\s*(\d)/g, "$1x$2")
    .split(/[\s,]+/)
    .filter(Boolean);

/** Parts whose number or title has every word of `query`, title words matched by their start; a part number match first. */
export function searchParts<T extends { part: string; title: string }>(parts: T[], query: string): T[] {
  const wanted = words(query);
  if (!wanted.length) return parts;
  const number = (p: T) => p.part.replace(/\.dat$/, "");
  const hits = parts.filter((p) => {
    const terms = [number(p), ...words(p.title)];
    return wanted.every((w) => terms.some((t) => t.startsWith(w)));
  });
  return hits.sort((a, b) => +(number(b) === wanted[0]) - +(number(a) === wanted[0]));
}

type Point = [number, number, number];
type Transform = [number, number, number, number, number, number, number, number, number, number, number, number];

/** A part's bounds in its own LDraw coordinates (y down), from its triangles and quads; null without geometry. */
export function extent(pack: string): { lo: Point; hi: Point } | null {
  const files = new Map<string, string[]>();
  let lines: string[] = [];
  for (const line of pack.split("\n")) {
    const file = line.match(/^0 FILE (.+?)\s*$/);
    if (file) files.set(file[1].toLowerCase(), (lines = []));
    else lines.push(line);
  }
  const root = pack.match(/^0 FILE (.+?)\s*$/m)?.[1].toLowerCase();
  const lo: Point = [Infinity, Infinity, Infinity];
  const hi: Point = [-Infinity, -Infinity, -Infinity];
  const visit = (name: string, [x, y, z, a, b, c, d, e, f, g, h, i]: Transform, depth: number) => {
    const body = files.get(name) ?? files.get(`parts/${name}`) ?? files.get(`p/${name}`);
    if (!body || depth > 32) return;
    for (const line of body) {
      const fields = line.trim().split(/\s+/);
      if (fields[0] === "3" || fields[0] === "4") {
        const v = fields.slice(2, 2 + 3 * +fields[0]).map(Number);
        for (let k = 0; k < v.length; k += 3) {
          const p = [
            a * v[k] + b * v[k + 1] + c * v[k + 2] + x,
            d * v[k] + e * v[k + 1] + f * v[k + 2] + y,
            g * v[k] + h * v[k + 1] + i * v[k + 2] + z,
          ];
          for (const n of [0, 1, 2]) {
            lo[n] = Math.min(lo[n], p[n]);
            hi[n] = Math.max(hi[n], p[n]);
          }
        }
      } else if (fields[0] === "1" && fields.length >= 15) {
        const [px, py, pz, pa, pb, pc, pd, pe, pf, pg, ph, pi] = fields.slice(2, 14).map(Number);
        // This file's transform after the child's own.
        const child: Transform = [
          a * px + b * py + c * pz + x,
          d * px + e * py + f * pz + y,
          g * px + h * py + i * pz + z,
          a * pa + b * pd + c * pg,
          a * pb + b * pe + c * ph,
          a * pc + b * pf + c * pi,
          d * pa + e * pd + f * pg,
          d * pb + e * pe + f * ph,
          d * pc + e * pf + f * pi,
          g * pa + h * pd + i * pg,
          g * pb + h * pe + i * ph,
          g * pc + h * pf + i * pi,
        ];
        visit(fields.slice(14).join(" ").replaceAll("\\", "/").toLowerCase(), child, depth + 1);
      }
    }
  };
  if (root) visit(root, [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1], 0);
  return lo[0] <= hi[0] ? { lo, hi } : null;
}

const HALF_STUD = 10;

/**
 * How far to move `piece` when its part becomes the one packed in `next`, in the model's LDraw units:
 * the new part keeps the old one's bottom and its first stud's corner, turned the way the piece is.
 */
export function replacementOffset(piece: Piece, previous: string, next: string): [number, number, number] {
  const before = extent(previous);
  const after = extent(next);
  if (!before || !after) return [0, 0, 0];
  const local = [
    Math.round((before.lo[0] - after.lo[0]) / HALF_STUD) * HALF_STUD,
    Math.round(before.hi[1] - after.hi[1]),
    Math.round((before.lo[2] - after.lo[2]) / HALF_STUD) * HALF_STUD,
  ];
  const r = piece.rot;
  return [0, 1, 2].map(
    (row) =>
      Math.round((r[row * 3] * local[0] + r[row * 3 + 1] * local[1] + r[row * 3 + 2] * local[2]) * 1000) / 1000 || 0,
  ) as [number, number, number];
}

/** A packed part's LDraw description: the line after the pack's first embedded file. */
export const packTitle = (pack: string | undefined) =>
  pack
    ?.match(/\n0 FILE [^\n]+\n0 (?!BFC\b|!|Name:|Author:)([^\n]*)/)?.[1]
    .replace(/^~/, "")
    .trim() || null;
