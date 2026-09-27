import type { Build } from "./api";
import type { EncodeReply, EncodeRequest } from "./gif.worker";
import { planReplay, REPLAY_FORMATS, replayPieces, type ReplayFormat } from "./replayPlan";
import { BrickScene, type View } from "./scene";

const FONT = '"Plus Jakarta Sans Variable", system-ui, sans-serif';

/** A private renderer: no live viewer, inference, camera or build mutations. */
export class ReplayRenderer {
  private host = document.createElement("div");
  private scene: BrickScene;
  private ordered;
  private viewHeight: number;
  private header: number;
  private ctx: CanvasRenderingContext2D;
  private size;

  constructor(
    canvas: HTMLCanvasElement,
    private build: Build,
    format: ReplayFormat,
    private view: View,
    private signal: AbortSignal,
  ) {
    this.size = REPLAY_FORMATS[format];
    const { width, height } = this.size;
    canvas.width = width;
    canvas.height = height;
    this.header = height === 450 ? 100 : 130;
    this.viewHeight = height - this.header - 90;
    this.ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    this.ordered = replayPieces(build.pieces);
    Object.assign(this.host.style, {
      position: "fixed",
      left: "-10000px",
      top: "0",
      width: `${width - 48}px`,
      height: `${this.viewHeight}px`,
      pointerEvents: "none",
    });
    this.host.setAttribute("aria-hidden", "true");
    document.body.appendChild(this.host);
    try {
      this.scene = new BrickScene(this.host, { replay: true, signal });
    } catch (error) {
      this.host.remove();
      throw error;
    }
  }

  async prepare() {
    await Promise.all([this.scene.setPieces(this.ordered.rendered), document.fonts.load(`600 24px ${FONT}`)]);
    this.signal.throwIfAborted();
    this.scene.frameView(this.view, this.build.width, this.build.depth);
  }

  draw(count: number, branded: boolean) {
    this.signal.throwIfAborted();
    const { width, height } = this.size;
    const ctx = this.ctx;
    const margin = 32;
    ctx.fillStyle = "#f6f6f9";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#f76808";
    ctx.fillRect(margin, 24, 26, 5);
    const holo = branded && this.build.builder === "holo";
    ctx.fillStyle = "#1c1c26";
    ctx.font = `800 26px ${FONT}`;
    ctx.fillText(holo ? "HOLO4" : "Brickyard", margin, 61);
    ctx.textAlign = "right";
    ctx.font = `600 12px ${FONT}`;
    ctx.fillStyle = "#636371";
    ctx.fillText(holo ? "H COMPANY / BRICKYARD" : "ASSEMBLY REPLAY", width - margin, 56);
    ctx.textAlign = "left";
    ctx.fillStyle = "#1c1c26";
    ctx.font = `600 ${height === 450 ? 18 : 23}px ${FONT}`;
    this.text(this.build.name, margin, height === 450 ? 90 : 102, width - margin * 2);
    ctx.drawImage(this.scene.replayFrame(count - 1), 24, this.header, width - 48, this.viewHeight);
    const piece = this.ordered.ordered[count - 1];
    const step = piece ? this.build.steps.findIndex((s) => s.index === piece.step) : -1;
    const label = count === 0 ? "The first brick…" : (this.build.steps[step]?.title ?? "Assembling");
    ctx.font = `600 15px ${FONT}`;
    ctx.fillStyle = "#1c1c26";
    this.text(label, margin, height - 62, width - margin * 2 - 150);
    ctx.textAlign = "right";
    ctx.font = `500 13px ${FONT}`;
    ctx.fillText(
      `${count.toLocaleString()} / ${this.build.pieces.length.toLocaleString()} pieces`,
      width - margin,
      height - 62,
    );
    ctx.textAlign = "left";
    ctx.fillStyle = "#e2e2e9";
    ctx.fillRect(margin, height - 47, width - margin * 2, 4);
    ctx.fillStyle = "#f76808";
    ctx.fillRect(margin, height - 47, ((width - margin * 2) * count) / this.build.pieces.length, 4);
    ctx.font = `500 11px ${FONT}`;
    ctx.fillStyle = "#636371";
    ctx.fillText("ASSEMBLY REPLAY", margin, height - 22);
    ctx.textAlign = "right";
    ctx.fillText(
      this.build.status === "building" ? "WORK IN PROGRESS" : `SNAPSHOT · ${this.build.steps.length} STEPS`,
      width - margin,
      height - 22,
    );
    ctx.textAlign = "left";
  }

  private text(value: string, x: number, y: number, width: number) {
    let label = value;
    while (label.length && this.ctx.measureText(label).width > width) label = label.slice(0, -1);
    if (label !== value) label = `${label.slice(0, -1)}…`;
    this.ctx.fillText(label, x, y);
  }

  async encode(
    seconds: number,
    branded: boolean,
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
        const timeout = setTimeout(
          () => fail(new Error("GIF encoder timed out. Try again with a shorter replay.")),
          60000,
        );
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
      const frames = planReplay(this.build.pieces.length, seconds, this.ordered.stepEnds);
      for (const [i, frame] of frames.entries()) {
        signal.throwIfAborted();
        this.draw(frame.pieces, branded);
        const { width, height } = this.size;
        const rgba = this.ctx.getImageData(0, 0, width, height).data.buffer;
        await send({ type: "frame", rgba, width, height, delay: frame.delay }, [rgba]);
        progress((i + 1) / frames.length);
      }
      const reply = await send({ type: "finish" });
      if (reply.type !== "done") throw new Error("The GIF encoder did not return a file.");
      return new Blob([reply.bytes], { type: "image/gif" });
    } finally {
      worker.terminate();
    }
  }

  dispose() {
    this.scene.dispose();
    this.host.remove();
  }
}
