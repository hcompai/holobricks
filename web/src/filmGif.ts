import type { FilmRenderer } from "./film";
import type { EncodeReply, EncodeRequest } from "./gif.worker";

/** Frames sampled, as shares of the film, for the palette every frame shares. */
const PALETTE_FRAMES = [0.3, 0.55, 0.75, 1];
/** Every Nth pixel of those frames feeds the palette. */
const PALETTE_STRIDE = 3;

/** Encode the configured film as a looping GIF in this browser, one frame at a time. */
export async function encodeGif(
  film: FilmRenderer,
  fps: number,
  signal: AbortSignal,
  progress: (value: number) => void,
): Promise<Blob> {
  signal.throwIfAborted();
  const worker = new Worker(new URL("./gif.worker.ts", import.meta.url), { type: "module" });
  const send = (message: EncodeRequest, transfer: Transferable[] = []) =>
    new Promise<EncodeReply>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
        worker.onmessage = worker.onerror = worker.onmessageerror = null;
      };
      const fail = (error: unknown) => {
        cleanup();
        reject(error);
      };
      const abort = () => fail(new DOMException("Export cancelled", "AbortError"));
      const timeout = setTimeout(() => fail(new Error("GIF encoder timed out. Try again with a shorter film.")), 60000);
      signal.addEventListener("abort", abort, { once: true });
      worker.onerror = () => fail(new Error("The GIF encoder could not start. Please retry."));
      worker.onmessageerror = () => fail(new Error("Could not read the encoded GIF."));
      worker.onmessage = ({ data }: MessageEvent<EncodeReply>) => {
        cleanup();
        if (data.type === "error") reject(new Error(data.message));
        else resolve(data);
      };
      if (signal.aborted) abort();
      else worker.postMessage(message, transfer);
    });
  try {
    const { frames } = film;
    const samples = PALETTE_FRAMES.map((share) => {
      const { data } = film.pixels(Math.round(share * (frames - 1)));
      return data.filter((_, i) => Math.floor(i / 4) % PALETTE_STRIDE === 0);
    });
    const pooled = new Uint8Array(samples.reduce((n, s) => n + s.length, 0));
    samples.reduce((offset, s) => (pooled.set(s, offset), offset + s.length), 0);
    await send({ type: "palette", rgba: pooled.buffer }, [pooled.buffer]);
    for (let i = 0; i < frames; i++) {
      signal.throwIfAborted();
      const { data, width, height } = film.pixels(i);
      await send({ type: "frame", rgba: data.buffer, width, height, delay: 1000 / fps }, [data.buffer]);
      progress((i + 1) / frames);
    }
    const reply = await send({ type: "finish" });
    if (reply.type !== "done") throw new Error("The GIF encoder did not return a file.");
    return new Blob([reply.bytes], { type: "image/gif" });
  } finally {
    worker.terminate();
  }
}
