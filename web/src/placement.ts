import type { Piece } from "./model";

export const SETTLE_SECONDS = 0.09;

export interface PlacementPlan {
  pieces: Piece[];
  starts: Map<number, number>;
  duration: number;
}

const same = (a: Piece, b: Piece) =>
  a.part === b.part &&
  a.color === b.color &&
  a.pos.every((v, i) => v === b.pos[i]) &&
  a.rot.every((v, i) => v === b.rot[i]);

/** Each changed piece gets its own start time, step then bottom-up layer, in LDraw's downward Y axis. */
export function planPlacement(pieces: Piece[], previous: Piece[]): PlacementPlan {
  const old = new Map(previous.map((p) => [p.id, p]));
  const changed = pieces
    .filter((p) => !old.has(p.id) || !same(p, old.get(p.id)!))
    .sort(
      (a, b) => a.step - b.step || b.pos[1] - a.pos[1] || a.pos[2] - b.pos[2] || a.pos[0] - b.pos[0] || a.id - b.id,
    );
  const starts = new Map<number, number>();
  let duration = 0;
  for (let first = 0; first < changed.length;) {
    let end = first + 1;
    while (end < changed.length && changed[end].step === changed[first].step) end++;
    const count = end - first;
    const seconds = Math.min(2.2, Math.max(0.38, Math.sqrt(count) * 0.035));
    for (let i = first; i < end; i++) starts.set(changed[i].id, duration + ((i - first) / count) * seconds);
    duration += seconds + SETTLE_SECONDS;
    first = end;
  }
  return { pieces: changed, starts, duration };
}

export function placedCount(plan: PlacementPlan, seconds: number): number {
  let lo = 0,
    hi = plan.pieces.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (plan.starts.get(plan.pieces[mid].id)! <= seconds) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
