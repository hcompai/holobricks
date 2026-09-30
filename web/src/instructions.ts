import * as THREE from "three";
import type { jsPDF } from "jspdf";
import type { Build, Piece } from "./model";
import { BrickScene } from "./scene";

/** A page never adds less than this many pieces while the next layer of its step is within one brick's height. */
const MIN_PIECES = 12;
/** Plates a page may span when it gathers small layers: one brick. */
const SPAN = 3;
const PLATE = 8;
const IDENTITY: Piece["rot"] = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** One page of instructions: the pieces a builder step adds at one height, bottom first. */
export interface Page {
  step: number;
  pieces: Piece[];
}

/** One part in one color, as a callout or the parts list counts it. */
interface Kind {
  key: string;
  piece: Piece;
  count: number;
}

export interface Progress {
  done: number;
  total: number;
  label: string;
}

/** The pages of `build`: each builder step split by height, bottom up, small neighbouring layers gathered. */
export function planPages(build: Build): Page[] {
  const pages: Page[] = [];
  const steps = [...new Set(build.pieces.map((p) => p.step))].sort((a, b) => a - b);
  for (const step of steps) {
    const layers = new Map<number, Piece[]>();
    for (const p of build.pieces) {
      if (p.step !== step) continue;
      const level = Math.round(p.pos[1] / PLATE);
      layers.set(level, [...(layers.get(level) ?? []), p]);
    }
    // LDraw's y points down, so the bottom layer has the largest level.
    let open: { bottom: number; page: Page } | null = null;
    for (const level of [...layers.keys()].sort((a, b) => b - a)) {
      const pieces = layers.get(level)!;
      if (open && open.page.pieces.length < MIN_PIECES && open.bottom - level < SPAN) open.page.pieces.push(...pieces);
      else pages.push((open = { bottom: level, page: { step, pieces: [...pieces] } }).page);
    }
  }
  return pages;
}

function kinds(pieces: Piece[]): Kind[] {
  const found = new Map<string, Kind>();
  for (const p of pieces) {
    const key = `${p.part}:${p.color}`;
    const kind = found.get(key);
    if (kind) kind.count++;
    else found.set(key, { key, piece: p, count: 1 });
  }
  return [...found.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

// A4 landscape, in millimetres.
const PAGE = { width: 297, height: 210 };
const RENDER = { side: 190, x: 297 - 190 - 8, y: 10, pixels: 1200 };
const CALLOUT = { x: 12, y: 40, cell: 24, columns: 3, rows: 6 };
const INVENTORY = { columns: 7, rows: 5, cell: { width: 39, height: 34 } };
const INK = "#1c1c26";
const MUTED = "#7a7a8a";

/** The standard PDF fonts only encode Latin-1. */
const latin1 = (text: string) => text.replace(/[^\u0000-ÿ]/g, "-");
const jpeg = (canvas: HTMLCanvasElement, quality = 0.8) => canvas.toDataURL("image/jpeg", quality);

function checkAborted(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("The instructions were cancelled", "AbortError");
}

/** A moment for the page to repaint the progress and take a cancel. */
const breathe = () => new Promise((resolve) => setTimeout(resolve));

/**
 * The building instructions of `build` as a PDF: a cover, one page per layer with the parts to add outlined and
 * pictured, then the whole parts list. `describe` names a part in its color.
 */
export async function instructionsPdf(
  build: Build,
  describe: (piece: Piece) => string,
  signal: AbortSignal,
  onProgress: (progress: Progress) => void,
): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const pages = planPages(build);
  const all = kinds(build.pieces);
  const total = all.length + pages.length + 1;
  let done = 0;
  const report = async (label: string) => {
    onProgress({ done: ++done, total, label });
    await breathe();
    checkAborted(signal);
  };

  const scene = new BrickScene(document.createElement("div"), { interactive: false, signal, marks: "outline" });
  try {
    const pictures = new Map<string, string>();
    for (const kind of all) {
      await scene.setPieces([{ ...kind.piece, id: 0, pos: [0, 0, 0], rot: IDENTITY, step: 0 }]);
      pictures.set(kind.key, jpeg(scene.page(160, scene.modelBox()), 0.85));
      await report(`Drawing the parts: ${done + 1} of ${all.length}`);
    }

    if (!(await scene.setPieces(pages.flatMap((page, i) => page.pieces.map((p) => ({ ...p, step: i })))))) {
      throw new Error("The model could not be drawn.");
    }
    const built = scene.stepBoxes().reduce<THREE.Box3[]>((sofar, box, i) => {
      sofar.push((sofar[i - 1]?.clone() ?? new THREE.Box3()).union(box ?? new THREE.Box3()));
      return sofar;
    }, []);

    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
    doc.setProperties({ title: latin1(`${build.name}: building instructions`), creator: "Brickyard" });
    cover(doc, build, pages.length, jpeg(scene.page(RENDER.pixels, scene.modelBox()), 0.85));
    await report("Drawing the cover");

    for (const [i, page] of pages.entries()) {
      scene.setVisibleStep(i);
      scene.setHighlight(
        null,
        page.pieces.map((p) => p.id),
      );
      doc.addPage();
      step(doc, build, page, i, pages.length, jpeg(scene.page(RENDER.pixels, built[i])), pictures);
      await report(`Drawing page ${i + 1} of ${pages.length}`);
    }

    inventory(doc, all, pictures, describe);
    return doc.output("blob");
  } finally {
    scene.dispose();
  }
}

function cover(doc: jsPDF, build: Build, pages: number, render: string) {
  doc.setTextColor(INK).setFont("helvetica", "bold").setFontSize(26);
  doc.text(latin1(build.name), 14, 22, { maxWidth: PAGE.width - 28 });
  doc.setFont("helvetica", "normal").setFontSize(12).setTextColor(MUTED);
  const pieces = build.pieces.length.toLocaleString("en");
  doc.text(`${pieces} pieces · ${build.steps.length} steps · ${pages} pages`, 14, 31);
  const side = 165;
  doc.addImage(render, "JPEG", (PAGE.width - side) / 2, 38, side, side);
  doc.setFontSize(9).text("Building instructions made with Brickyard", 14, PAGE.height - 8);
}

function step(
  doc: jsPDF,
  build: Build,
  page: Page,
  index: number,
  pages: number,
  render: string,
  pictures: Map<string, string>,
) {
  doc
    .setTextColor(INK)
    .setFont("helvetica", "bold")
    .setFontSize(30)
    .text(String(index + 1), 12, 24);
  const title = build.steps.find((s) => s.index === page.step)?.title ?? "";
  const heading = `Step ${page.step + 1} of ${build.steps.length}${title ? `: ${title}` : ""}`;
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(MUTED);
  doc.text(doc.splitTextToSize(latin1(heading), 76).slice(0, 2), 12, 31);

  const { x, y, cell, columns, rows } = CALLOUT;
  const parts = kinds(page.pieces);
  const room = columns * rows;
  const shown = parts.length > room ? parts.slice(0, room - 1) : parts;
  const cells = shown.length + (parts.length > shown.length ? 1 : 0);
  doc.setFillColor("#eaf1fb").roundedRect(x, y, columns * cell + 2, Math.ceil(cells / columns) * cell + 2, 2, 2, "F");
  shown.forEach((kind, k) => {
    const cx = x + 1 + (k % columns) * cell;
    const cy = y + 1 + Math.floor(k / columns) * cell;
    doc.addImage(pictures.get(kind.key)!, "JPEG", cx + 2.5, cy + 1, cell - 5, cell - 5);
    doc
      .setTextColor(INK)
      .setFont("helvetica", "bold")
      .setFontSize(9)
      .text(`${kind.count}x`, cx + 2.5, cy + cell - 1.5);
  });
  if (cells > shown.length) {
    const k = shown.length;
    const more = parts.slice(shown.length).reduce((n, kind) => n + kind.count, 0);
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(MUTED);
    doc.text(
      [`+${parts.length - shown.length} more`, `(${more} pcs)`],
      x + 1 + (k % columns) * cell + 3,
      y + 1 + Math.floor(k / columns) * cell + cell / 2,
    );
  }

  doc.addImage(render, "JPEG", RENDER.x, RENDER.y, RENDER.side, RENDER.side);
  doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(MUTED);
  doc.text(`${page.pieces.length} pieces`, 12, PAGE.height - 8);
  doc.text(latin1(`${build.name} · ${index + 1} / ${pages}`), PAGE.width - 8, PAGE.height - 6, { align: "right" });
}

function inventory(doc: jsPDF, all: Kind[], pictures: Map<string, string>, describe: (piece: Piece) => string) {
  const { columns, rows, cell } = INVENTORY;
  const perPage = columns * rows;
  for (let first = 0; first < all.length; first += perPage) {
    doc.addPage();
    doc.setTextColor(INK).setFont("helvetica", "bold").setFontSize(18).text("Parts list", 12, 18);
    all.slice(first, first + perPage).forEach((kind, k) => {
      const cx = 12 + (k % columns) * cell.width;
      const cy = 26 + Math.floor(k / columns) * cell.height;
      doc.addImage(pictures.get(kind.key)!, "JPEG", cx, cy, 18, 18);
      doc
        .setTextColor(INK)
        .setFont("helvetica", "bold")
        .setFontSize(10)
        .text(`${kind.count}x`, cx + 20, cy + 6);
      doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(MUTED);
      doc.text(doc.splitTextToSize(latin1(describe(kind.piece)), cell.width - 3).slice(0, 3), cx, cy + 22);
    });
  }
}
