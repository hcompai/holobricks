import type { Build } from "./model";
import { palette } from "./palette";
import { zip } from "./zip";

/** A part's surface in millimeters, z up with its studs on top, as its LDraw library files draw it. */
export interface Mesh {
  vertices: number[];
  triangles: number[];
  lo: [number, number, number];
  hi: [number, number, number];
}

/** One piece on a print bed: its part's mesh moved to `x`, `y` (its low corner), in millimeters. */
export interface Placed {
  part: string;
  x: number;
  y: number;
}

/** One print bed of pieces, all in one color. */
export interface Plate {
  color: number;
  pieces: Placed[];
}

/** A plate a common printer takes: Prusa MK4, Bambu Lab X1, P1 and A1, Creality Ender 3. */
export const BED = 200;
/** Room between pieces, so the slicer keeps each one its own island. */
const GAP = 3;
/** An LDraw unit is 0.4 mm: a stud is 8 mm across, a plate 3.2 mm tall. */
const LDU = 0.4;

type Transform = [number, number, number, number, number, number, number, number, number, number, number, number];
const IDENTITY: Transform = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];

/** `parent` after `child`, both as LDraw's x y z a b c d e f g h i. */
function compose(parent: Transform, child: Transform): Transform {
  const [x, y, z, a, b, c, d, e, f, g, h, i] = parent;
  const [px, py, pz, pa, pb, pc, pd, pe, pf, pg, ph, pi] = child;
  return [
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
}

const determinant = ([, , , a, b, c, d, e, f, g, h, i]: Transform) =>
  a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);

/**
 * The part packed in `pack` as one welded triangle mesh, wound counterclockwise seen from outside where its
 * files are BFC certified; null without geometry. Edge lines and colors are dropped: a print is one color.
 */
export function partMesh(pack: string): Mesh | null {
  const files = new Map<string, string[]>();
  let lines: string[] = [];
  for (const line of pack.split("\n")) {
    const file = line.match(/^0 FILE (.+?)\s*$/);
    if (file) files.set(file[1].toLowerCase(), (lines = []));
    else lines.push(line);
  }
  const root = pack.match(/^0 FILE (.+?)\s*$/m)?.[1].toLowerCase();
  const vertices: number[] = [];
  const triangles: number[] = [];
  const index = new Map<string, number>();
  const lo: [number, number, number] = [Infinity, Infinity, Infinity];
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  const vertex = ([x, y, z, a, b, c, d, e, f, g, h, i]: Transform, vx: number, vy: number, vz: number) => {
    // LDraw's y points down: x, z, -y keeps the hand of the axes, so windings keep their sense.
    const p = [
      (a * vx + b * vy + c * vz + x) * LDU,
      (g * vx + h * vy + i * vz + z) * LDU,
      -(d * vx + e * vy + f * vz + y) * LDU,
    ].map((v) => Math.round(v * 1000) / 1000 || 0);
    const key = p.join(" ");
    let at = index.get(key);
    if (at === undefined) {
      at = vertices.length / 3;
      index.set(key, at);
      vertices.push(...p);
      for (const n of [0, 1, 2]) {
        lo[n] = Math.min(lo[n], p[n]);
        hi[n] = Math.max(hi[n], p[n]);
      }
    }
    return at;
  };
  const triangle = (t: number, u: number, v: number) => {
    if (t !== u && u !== v && v !== t) triangles.push(t, u, v);
  };

  const visit = (name: string, transform: Transform, inverted: boolean, depth: number) => {
    const body = files.get(name) ?? files.get(`parts/${name}`) ?? files.get(`p/${name}`);
    if (!body || depth > 32) return;
    // Uncertified files have no winding to keep; they are drawn as written and left to the slicer to orient.
    let certified = false;
    let clockwise = false;
    let invertNext = false;
    const flip = inverted !== determinant(transform) < 0;
    for (const line of body) {
      const fields = line.trim().split(/\s+/);
      if (fields[0] === "0" && fields[1] === "BFC") {
        const words = fields.slice(2);
        if (words.includes("CERTIFY")) certified = true;
        if (words.includes("NOCERTIFY")) certified = false;
        if (words.includes("CW")) clockwise = true;
        if (words.includes("CCW")) clockwise = false;
        if (words.includes("INVERTNEXT")) invertNext = true;
      } else if (fields[0] === "1" && fields.length >= 15) {
        const child = fields.slice(2, 14).map(Number) as Transform;
        const ref = fields.slice(14).join(" ").replaceAll("\\", "/").toLowerCase();
        visit(ref, compose(transform, child), inverted !== invertNext, depth + 1);
        invertNext = false;
      } else if (fields[0] === "3" || fields[0] === "4") {
        const v = fields.slice(2, 2 + 3 * +fields[0]).map(Number);
        const ids = [];
        for (let k = 0; k < v.length; k += 3) ids.push(vertex(transform, v[k], v[k + 1], v[k + 2]));
        if (certified && clockwise !== flip) ids.reverse();
        triangle(ids[0], ids[1], ids[2]);
        if (ids.length === 4) triangle(ids[0], ids[2], ids[3]);
      }
    }
  };
  if (root) visit(root, IDENTITY, false, 0);
  return triangles.length ? { vertices, triangles, lo, hi } : null;
}

/**
 * The pieces laid out on print beds of `bed` millimeters, one color a plate, biggest pieces first in rows.
 * A piece bigger than the bed gets a plate of its own. Pieces without a mesh are left out.
 */
export function layOut(pieces: { part: string; color: number }[], meshes: Map<string, Mesh>, bed = BED): Plate[] {
  const byColor = new Map<number, string[]>();
  for (const p of pieces) {
    if (!meshes.has(p.part)) continue;
    const parts = byColor.get(p.color);
    if (parts) parts.push(p.part);
    else byColor.set(p.color, [p.part]);
  }
  const plates: Plate[] = [];
  const size = (part: string) => {
    const { lo, hi } = meshes.get(part)!;
    return [hi[0] - lo[0], hi[1] - lo[1]];
  };
  for (const [color, parts] of [...byColor].sort((a, b) => b[1].length - a[1].length)) {
    parts.sort((a, b) => size(b)[1] - size(a)[1] || size(b)[0] - size(a)[0] || a.localeCompare(b));
    let plate: Plate | null = null;
    let [x, y, row] = [0, 0, 0];
    for (const part of parts) {
      const [w, d] = size(part);
      if (plate && x + w > bed) [x, y, row] = [0, y + row + GAP, 0];
      if (!plate || y + d > bed) {
        plates.push((plate = { color, pieces: [] }));
        [x, y, row] = [0, 0, 0];
      }
      plate.pieces.push({ part, x, y });
      x += w + GAP;
      row = Math.max(row, d);
    }
  }
  return plates;
}

const escape = (text: string) =>
  text.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);

/** The 3MF's model: a mesh object per part and color, a plate object per bed, plates side by side. */
function model(name: string, plates: Plate[], meshes: Map<string, Mesh>, colors: Map<number, [string, string]>) {
  const used = [...new Set(plates.map((p) => p.color))];
  const material = new Map(used.map((c, i) => [c, i]));
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">',
    `<metadata name="Title">${escape(name)}</metadata>`,
    '<metadata name="Application">HoloBricks</metadata>',
    "<resources>",
    '<basematerials id="1">',
    ...used.map((c) => {
      const [label, hex] = colors.get(c) ?? [`Color ${c}`, "#A0A5A9"];
      return `<base name="${escape(label)}" displaycolor="${hex.toUpperCase()}FF"/>`;
    }),
    "</basematerials>",
  ];
  let next = 2;
  const objects = new Map<string, number>();
  for (const plate of plates)
    for (const { part } of plate.pieces) {
      const key = `${part}:${plate.color}`;
      if (objects.has(key)) continue;
      objects.set(key, next);
      const { vertices: v, triangles: t } = meshes.get(part)!;
      out.push(
        `<object id="${next++}" type="model" name="${escape(part.replace(/\.dat$/i, ""))}" pid="1" pindex="${material.get(plate.color)}">`,
        "<mesh><vertices>",
      );
      for (let k = 0; k < v.length; k += 3) out.push(`<vertex x="${v[k]}" y="${v[k + 1]}" z="${v[k + 2]}"/>`);
      out.push("</vertices><triangles>");
      for (let k = 0; k < t.length; k += 3) out.push(`<triangle v1="${t[k]}" v2="${t[k + 1]}" v3="${t[k + 2]}"/>`);
      out.push("</triangles></mesh></object>");
    }
  const ids: number[] = [];
  plates.forEach((plate, i) => {
    const label = colors.get(plate.color)?.[0] ?? `Color ${plate.color}`;
    ids.push(next);
    out.push(`<object id="${next++}" type="model" name="Plate ${i + 1} · ${escape(label)}"><components>`);
    for (const { part, x, y } of plate.pieces) {
      const { lo } = meshes.get(part)!;
      const at = [x - lo[0], y - lo[1], -lo[2]].map((n) => Math.round(n * 1000) / 1000 || 0);
      out.push(
        `<component objectid="${objects.get(`${part}:${plate.color}`)}" transform="1 0 0 0 1 0 0 0 1 ${at.join(" ")}"/>`,
      );
    }
    out.push("</components></object>");
  });
  out.push("</resources>", "<build>");
  // Plates in a square grid a bed apart, so slicers that read one build see each plate on its own.
  const columns = Math.ceil(Math.sqrt(plates.length));
  ids.forEach((id, i) => {
    const [x, y] = [(i % columns) * (BED + 20), -Math.floor(i / columns) * (BED + 20)];
    out.push(`<item objectid="${id}" transform="1 0 0 0 1 0 0 0 1 ${x} ${y} 0"/>`);
  });
  out.push("</build>", "</model>");
  return out.join("\n");
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

export interface PrintPlates {
  file: Blob;
  plates: number;
  /** Pieces left out because their part has no geometry. */
  skipped: number;
}

/** The build's pieces as a 3MF of print plates, at real size from the LDraw library geometry it was built with. */
export async function printPlates(build: Build): Promise<PrintPlates> {
  const meshes = new Map<string, Mesh>();
  for (const part of new Set(build.pieces.map((p) => p.part))) {
    const pack = build.parts[part];
    const mesh = pack ? partMesh(pack) : null;
    if (mesh) meshes.set(part, mesh);
  }
  const plates = layOut(build.pieces, meshes);
  if (!plates.length) throw new Error("None of these parts has geometry to print.");
  const colors = new Map((await palette().catch(() => [])).map((c) => [c.code, [c.name, c.hex] as [string, string]]));
  const encode = (text: string) => new TextEncoder().encode(text);
  const file = await zip([
    { name: "[Content_Types].xml", data: encode(CONTENT_TYPES) },
    { name: "_rels/.rels", data: encode(RELS) },
    { name: "3D/3dmodel.model", data: encode(model(build.name, plates, meshes, colors)) },
  ]);
  const skipped = build.pieces.filter((p) => !meshes.has(p.part)).length;
  return { file: new Blob([file], { type: "model/3mf" }), plates: plates.length, skipped };
}
