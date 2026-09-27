import { GIFEncoder, quantize } from "gifenc";

export type EncodeRequest =
  | { type: "palette"; rgba: ArrayBuffer }
  | { type: "frame"; rgba: ArrayBuffer; width: number; height: number; delay: number }
  | { type: "finish" };
export type EncodeReply = { type: "ready" } | { type: "done"; bytes: ArrayBuffer } | { type: "error"; message: string };

/** X's GIF upload limit. */
const MAX_MB = 15;
/** Pixels unchanged since the last frame use this index, which the palette leaves free. */
const CLEAR = 255;
const BITS = 6;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16 - 0.5);
/** The ordered dither's amplitude, about one palette step. */
const SPREAD = 10;

const gif = GIFEncoder();
let palette: number[][] = [];
let nearest: Uint8Array = new Uint8Array(0);
let previous: Uint8Array | null = null;

/** The nearest palette color of every color at BITS bits per channel. */
function lookup(colors: number[][]): Uint8Array {
  const levels = 1 << BITS;
  const table = new Uint8Array(levels ** 3);
  const step = 255 / (levels - 1);
  for (let r = 0; r < levels; r++)
    for (let g = 0; g < levels; g++)
      for (let b = 0; b < levels; b++) {
        let best = 0;
        let distance = Infinity;
        colors.forEach(([pr, pg, pb], i) => {
          const d = (r * step - pr) ** 2 + (g * step - pg) ** 2 + (b * step - pb) ** 2;
          if (d < distance) [best, distance] = [i, d];
        });
        table[(r << (2 * BITS)) | (g << BITS) | b] = best;
      }
  return table;
}

/** Ordered dithering against the film's single palette keeps flat backdrops stable from frame to frame. */
function indices(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  const shift = 8 - BITS;
  const level = (v: number) => Math.min(255, Math.max(0, Math.round(v))) >> shift;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      const t = BAYER[((y & 3) << 2) | (x & 3)] * SPREAD;
      const r = level(rgba[p * 4] + t);
      const g = level(rgba[p * 4 + 1] + t);
      const b = level(rgba[p * 4 + 2] + t);
      out[p] = nearest[(r << (2 * BITS)) | (g << BITS) | b];
    }
  return out;
}

self.onmessage = ({ data }: MessageEvent<EncodeRequest>) => {
  try {
    if (data.type === "palette") {
      palette = quantize(new Uint8Array(data.rgba), CLEAR);
      nearest = lookup(palette);
      while (palette.length <= CLEAR) palette.push([0, 0, 0]);
    } else if (data.type === "frame") {
      const frame = indices(new Uint8Array(data.rgba), data.width, data.height);
      const first = previous === null;
      const shown = frame.slice();
      if (previous) for (let p = 0; p < frame.length; p++) if (frame[p] === previous[p]) shown[p] = CLEAR;
      previous = frame;
      gif.writeFrame(shown, data.width, data.height, {
        palette: first ? palette : undefined,
        delay: data.delay,
        repeat: 0,
        dispose: 1,
        transparent: !first,
        transparentIndex: CLEAR,
      });
      if (gif.bytesView().byteLength > MAX_MB * 1024 * 1024) {
        throw new Error(`GIF exceeds ${MAX_MB} MB. Try a shorter film.`);
      }
    } else {
      gif.finish();
      const bytes = gif.bytesView().slice().buffer;
      self.postMessage({ type: "done", bytes } satisfies EncodeReply, { transfer: [bytes] });
      return;
    }
    self.postMessage({ type: "ready" } satisfies EncodeReply);
  } catch (error) {
    self.postMessage({ type: "error", message: error instanceof Error ? error.message : "GIF encoding failed." });
  }
};
