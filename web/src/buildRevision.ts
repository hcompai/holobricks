import type { Piece } from "./model";

/** Matches Build.revision on the server, including same-count color and position changes. */
export async function buildRevision(pieces: Piece[]): Promise<string> {
  const rows = pieces.map((p) => [
    p.id,
    p.part,
    p.color,
    p.step,
    ...[...p.pos, ...p.rot].map((v) => Math.round(v * 1_000_000)),
  ]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(rows)));
  return Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, "0")).join("");
}
