import { applyPalette, GIFEncoder, quantize } from "gifenc";

export type EncodeRequest =
  { type: "frame"; rgba: ArrayBuffer; width: number; height: number; delay: number } | { type: "finish" };
export type EncodeReply = { type: "ready" } | { type: "done"; bytes: ArrayBuffer } | { type: "error"; message: string };

/** X's GIF upload limit. */
const MAX_MB = 15;
const gif = GIFEncoder();
self.onmessage = ({ data }: MessageEvent<EncodeRequest>) => {
  try {
    if (data.type === "frame") {
      const rgba = new Uint8Array(data.rgba);
      const palette = quantize(rgba, 256);
      gif.writeFrame(applyPalette(rgba, palette), data.width, data.height, {
        palette,
        delay: data.delay,
        repeat: 0,
        dispose: 1,
      });
      if (gif.bytesView().byteLength > MAX_MB * 1024 * 1024) {
        throw new Error(`GIF exceeds ${MAX_MB} MB. Try a shorter replay.`);
      }
      self.postMessage({ type: "ready" } satisfies EncodeReply);
    } else {
      gif.finish();
      const bytes = gif.bytesView().slice().buffer;
      self.postMessage({ type: "done", bytes } satisfies EncodeReply, { transfer: [bytes] });
    }
  } catch (error) {
    self.postMessage({ type: "error", message: error instanceof Error ? error.message : "GIF encoding failed." });
  }
};
