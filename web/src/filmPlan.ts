import { CAMERA_MOVE_SECONDS } from "./buildTiming";
import type { Build, Piece } from "./model";
import { HOLO } from "./holo";

/** Only Holo builds may credit HOLO4 / H Company. */
export const brandable = (build: Pick<Build, "builder">) => build.builder === "holo";

export const FILM_ASPECTS = {
  "16:9": { label: "Landscape · 16:9", width: 1920, height: 1080 },
  "1:1": { label: "Square · 1:1", width: 1080, height: 1080 },
  "9:16": { label: "Portrait · 9:16", width: 1080, height: 1920 },
};
export type FilmAspect = keyof typeof FILM_ASPECTS;
export const FILM_SECONDS = [8, 12, 20, 30];
export const MIN_SECONDS = 6;
export const MAX_SECONDS = 60;

export type FilmCamera = "follow" | "orbit" | "fixed";

export interface FilmOptions {
  camera?: FilmCamera;
  width: number;
  height: number;
  seconds: number;
  fps: number;
  /** Jittered renders averaged into each frame, for antialiasing and soft shadows. */
  samples: number;
  /** The H Company mark in the corner. */
  branded: boolean;
  /** A tilt-shift blur above and below the model. */
  dof?: boolean;
}

/** How far above its slot a piece starts falling, in LDraw units: six plates. */
export const DROP = 48;
const PLATE = 8;
const INTRO_S = 0.4;
const HOLD_S = 1;
const FLIGHT_S = 0.6;
/** How many courses the diagonal sweep across a step spans, so a step rises as a wave. */
const WAVE_COURSES = 3;
/** Overshoot of the landing ease: about 5% of the drop. */
const OVERSHOOT = 1.2;

export interface FilmStep {
  index: number;
  title: string;
  /** Its 1-based position among the steps that have pieces. */
  number: number;
  /** When its first and last pieces start falling, in seconds. */
  start: number;
  end: number;
}

export interface FilmPlan {
  seconds: number;
  /** Every piece in the order it falls; a piece's index is its rank. */
  order: Piece[];
  /** When each ranked piece starts falling, in seconds, never decreasing. */
  starts: Float64Array;
  /** How long every fall lasts, in seconds. */
  flight: number;
  steps: FilmStep[];
  /** When the last piece has landed and the turntable starts. */
  assembled: number;
  /** When the turntable ends and the final hold starts. */
  hold: number;
}

export const frameCount = (options: Pick<FilmOptions, "seconds" | "fps">) => Math.round(options.seconds * options.fps);

/** Bottom-up in courses, sweeping diagonally across the step, so each step reads as a rising wave. */
function wave(pieces: Piece[]): Piece[] {
  const sweep = (p: Piece) => p.pos[0] + p.pos[2];
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of pieces) {
    lo = Math.min(lo, sweep(p));
    hi = Math.max(hi, sweep(p));
  }
  const key = (p: Piece) => -p.pos[1] / PLATE + (WAVE_COURSES * (sweep(p) - lo)) / (hi - lo || 1);
  return pieces
    .map((p) => ({ p, k: key(p) }))
    .sort((a, b) => a.k - b.k || a.p.id - b.p.id)
    .map(({ p }) => p);
}

/** The pieces of each nonempty step, in step order, each in the order its pieces fall. */
export function filmSteps(pieces: Piece[]): Piece[][] {
  const groups = new Map<number, Piece[]>();
  for (const p of [...pieces].sort((a, b) => a.step - b.step || a.id - b.id)) {
    const group = groups.get(p.step);
    if (group) group.push(p);
    else groups.set(p.step, [p]);
  }
  return [...groups.values()].map(wave);
}

/**
 * Steps get assembly time by the square root of their size, so a huge step compresses into fast waves and a
 * single brick still gets a beat. Pieces within a step start evenly spaced; the last lands as the turntable starts.
 */
export function planFilm(build: Pick<Build, "pieces" | "steps">, seconds: number): FilmPlan {
  if (!build.pieces.length) throw new Error("Nothing to film: the model has no pieces.");
  if (!(seconds >= MIN_SECONDS && seconds <= MAX_SECONDS)) {
    throw new Error(`Films last ${MIN_SECONDS} to ${MAX_SECONDS} seconds.`);
  }
  const turntable = Math.min(Math.max(seconds * 0.25, 2.5), 6);
  const hold = seconds - HOLD_S;
  const assembled = hold - turntable;
  const groups = filmSteps(build.pieces);
  const available = assembled - INTRO_S;
  const move = Math.min(CAMERA_MOVE_SECONDS, (available * 0.15) / Math.max(groups.length - 1, 1));
  const flight = Math.min(FLIGHT_S, (available - move * (groups.length - 1)) / (groups.length * 4));
  const span = available - move * (groups.length - 1) - flight * groups.length;
  const titles = new Map(build.steps.map((s) => [s.index, s.title]));
  const weights = groups.map((g) => Math.sqrt(g.length));
  const total = weights.reduce((a, b) => a + b, 0);
  const order: Piece[] = [];
  const starts = new Float64Array(build.pieces.length);
  const steps: FilmStep[] = [];
  let time = INTRO_S;
  groups.forEach((pieces, i) => {
    const window = (span * weights[i]) / total;
    for (const [k, p] of pieces.entries()) {
      starts[order.length] = time + (window * k) / pieces.length;
      order.push(p);
    }
    const title = titles.get(pieces[0].step) ?? `Step ${i + 1}`;
    steps.push({ index: pieces[0].step, title, number: i + 1, start: time, end: time + window });
    time += window + flight + (i < groups.length - 1 ? move : 0);
  });
  return { seconds, order, starts, flight, steps, assembled, hold };
}

/** How many ranked pieces have started falling by `time`. */
export function started(plan: FilmPlan, time: number): number {
  let lo = 0;
  let hi = plan.starts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (plan.starts[mid] <= time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** How many ranked pieces have landed by `time`. */
export const landed = (plan: FilmPlan, time: number) => started(plan, time - plan.flight);

/** A fall at `progress` from 0 (leaving) to 1 (landed): its lift above the slot, and the share of its tilt left. */
export function fall(progress: number): { lift: number; tilt: number } {
  const u = Math.min(Math.max(progress, 0), 1) - 1;
  const eased = 1 + (OVERSHOOT + 1) * u ** 3 + OVERSHOOT * u ** 2;
  return { lift: DROP * (1 - eased), tilt: 1 - eased };
}

export function filmFilename(name: string, extension: string): string {
  const safe = name
    .replace(/[\x00-\x1f<>:"/\\|?*]/g, "-")
    .replace(/[. ]+$/g, "")
    .slice(0, 100)
    .trim();
  return `${safe || "holobricks"}-build.${extension}`;
}

export function filmCaption(build: Build, branded: boolean): string {
  const author = branded && brandable(build) ? `${HOLO.name} by H Company` : "HoloBricks";
  const state = build.status === "building" ? " · work in progress" : "";
  const tags = branded && brandable(build) ? "#Holo4 #HCompany #HoloBricks #LEGO" : "#HoloBricks #LEGO";
  return `${build.name}: ${build.pieces.length.toLocaleString()} LEGO pieces, built with ${author}${state}. ${tags}`;
}
