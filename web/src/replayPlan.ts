import type { Build, Piece } from "./api";

export const REPLAY_FORMATS = {
  square: { label: "Square · 1:1", width: 640, height: 640 },
  portrait: { label: "Portrait · 4:5", width: 640, height: 800 },
  landscape: { label: "Landscape · 16:9", width: 800, height: 450 },
};
export type ReplayFormat = keyof typeof REPLAY_FORMATS;
export const REPLAY_SECONDS = [8, 12, 20];
export const HOLO_MODEL = "HOLO4";
/** Turntable frames in the finale; browser tests lower it so software-rendered encodes stay short. */
export const replaySpin = { frames: 30 };

const MAX_FRAMES = 121;
/** GIF delays are whole hundredths of a second. */
const TICK_MS = 10;
const MIN_FRAME_MS = 100;
const START_HOLD_MS = 300;
const SPIN_MS = 3000;
const FRONT_HOLD_MS = 1000;

export interface ReplayFrame {
  pieces: number;
  delay: number;
  /** Fraction of a full orbit from the front; absent during assembly. */
  turn?: number;
}

/** Only Holo builds may credit HOLO4 / H Company. */
export const brandable = (build: Build) => build.builder === "holo";

/** Bounded assembly, then a three-second orbit and a one-second front hold, within the requested duration. */
export function planReplay(pieces: number, seconds: number, stepEnds: readonly number[] = [pieces]): ReplayFrame[] {
  if (!Number.isSafeInteger(pieces) || pieces < 1 || !REPLAY_SECONDS.includes(seconds)) {
    throw new Error("Choose a nonempty model and an 8, 12 or 20 second replay.");
  }
  const spinFrames = replaySpin.frames;
  const assemblyMs = seconds * 1000 - START_HOLD_MS - SPIN_MS - FRONT_HOLD_MS;
  const ticks = assemblyMs / TICK_MS;
  const count = Math.min(pieces, MAX_FRAMES - spinFrames - 2, Math.ceil(assemblyMs / MIN_FRAME_MS));
  const frames: ReplayFrame[] = [{ pieces: 0, delay: START_HOLD_MS }];
  for (let i = 1; i <= count; i++) {
    const delay = (Math.round((i * ticks) / count) - Math.round(((i - 1) * ticks) / count)) * TICK_MS;
    // Give each saved step equal screen time: a tiled base must not consume the whole clip.
    const position = i * stepEnds.length;
    const step = Math.min(Math.floor(position / count), stepEnds.length - 1);
    const start = stepEnds[step - 1] ?? 0;
    const visible =
      i === count ? pieces : Math.ceil((start * count + (position - step * count) * (stepEnds[step] - start)) / count);
    if (frames.at(-1)!.pieces === visible) frames.at(-1)!.delay += delay;
    else frames.push({ pieces: visible, delay });
  }
  for (let i = 0; i < spinFrames; i++) frames.push({ pieces, delay: SPIN_MS / spinFrames, turn: i / spinFrames });
  frames.push({ pieces, delay: FRONT_HOLD_MS, turn: 0 });
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
  const author = branded ? `${HOLO_MODEL} by H Company` : "Brickyard";
  const state = build.status === "building" ? " · work in progress" : "";
  const tags = branded ? `#${HOLO_MODEL} #Brickyard #LEGO` : "#Brickyard #LEGO";
  return `${build.name}: ${build.pieces.length.toLocaleString()} LEGO pieces, built with ${author}${state}. Assembly replay. ${tags}`;
}
