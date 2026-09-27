import type { Build, Piece } from "./api";

export const REPLAY_FORMATS = {
  square: { label: "Square · 1:1", width: 640, height: 640 },
  portrait: { label: "Portrait · 4:5", width: 640, height: 800 },
  landscape: { label: "Landscape · 16:9", width: 800, height: 450 },
};
export type ReplayFormat = keyof typeof REPLAY_FORMATS;
export interface ReplayFrame {
  pieces: number;
  delay: number;
  /** Fraction of a full orbit from the front; absent during assembly. */
  turn?: number;
}

/** Bounded assembly, then a three-second orbit and a one-second front hold, within the requested duration. */
export function planReplay(pieces: number, seconds: number, stepEnds: readonly number[] = [pieces]): ReplayFrame[] {
  if (!Number.isSafeInteger(pieces) || pieces < 1 || ![8, 12, 20].includes(seconds)) {
    throw new Error("Choose a nonempty model and an 8, 12 or 20 second replay.");
  }
  const spinFrames = 30;
  const ticks = seconds * 100 - 430; // GIF timing is in hundredths of a second.
  const count = Math.min(pieces, 120 - spinFrames - 1, Math.ceil(ticks / 10));
  const frames: ReplayFrame[] = [{ pieces: 0, delay: 300 }];
  for (let i = 1; i <= count; i++) {
    const delay = (Math.round((i * ticks) / count) - Math.round(((i - 1) * ticks) / count)) * 10;
    // Give each saved step equal screen time: a tiled base must not consume the whole clip.
    const position = i * stepEnds.length;
    const step = Math.min(Math.floor(position / count), stepEnds.length - 1);
    const start = stepEnds[step - 1] ?? 0;
    const visible =
      i === count ? pieces : Math.ceil((start * count + (position - step * count) * (stepEnds[step] - start)) / count);
    if (frames.at(-1)!.pieces === visible) frames.at(-1)!.delay += delay;
    else frames.push({ pieces: visible, delay });
  }
  for (let i = 0; i < spinFrames; i++) frames.push({ pieces, delay: 100, turn: i / spinFrames });
  frames.push({ pieces, delay: 1000, turn: 0 });
  return frames;
}

/** Copy and order without changing the live build. Each piece gets a private replay step. */
export function replayPieces(pieces: Piece[]): { ordered: Piece[]; rendered: Piece[]; stepEnds: number[] } {
  const ordered = [...pieces].sort((a, b) => a.step - b.step || a.id - b.id);
  const stepEnds = ordered.flatMap((piece, index) => (piece.step !== ordered[index + 1]?.step ? [index + 1] : []));
  return { ordered, rendered: ordered.map((piece, step) => ({ ...piece, step })), stepEnds };
}

export function replayFilename(name: string): string {
  const safe = name
    .replace(/[\x00-\x1f<>:"/\\|?*]/g, "-")
    .replace(/[. ]+$/g, "")
    .slice(0, 100)
    .trim();
  return `${safe || "brickyard"}-assembly.gif`;
}

export function replayCaption(build: Build, branded: boolean): string {
  const author = branded && build.builder === "holo" ? "HOLO4 by H Company" : "Brickyard";
  const state = build.status === "building" ? " · work in progress" : "";
  return `${build.name} — ${build.pieces.length.toLocaleString()} LEGO pieces, built with ${author}${state}. Assembly replay. ${branded && build.builder === "holo" ? "#HOLO4 " : ""}#Brickyard #LEGO`;
}
