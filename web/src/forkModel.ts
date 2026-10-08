import { buildRevision } from "./buildRevision";
import type { Build, Model, Source } from "./model";
import { unpack } from "./session";

export interface ForkOrigin {
  id: string;
  source: Source;
  name: string;
  version: number | null;
  revision: string;
}
export interface ForkSeed {
  format: 1;
  origin: ForkOrigin;
  model: Model;
}

/** Explicit fields keep chat, private work and attachment URLs out of the fork. */
export function forkSeed(build: Build, origin: ForkOrigin, name: string): ForkSeed {
  const { builder, width, depth, updated, revision, pieces, steps, parts, ldr, bom, shopping } = build;
  return structuredClone({
    format: 1,
    origin,
    model: { name, builder, width, depth, updated, revision, pieces, steps, parts, ldr, bom, shopping },
  });
}

export async function readSeed(blob: Blob): Promise<ForkSeed> {
  const seed = await unpack<ForkSeed>(blob);
  if (
    seed?.format !== 1 ||
    !seed.origin ||
    !["session", "public", "showcase", "fork"].includes(seed.origin.source) ||
    typeof seed.origin.id !== "string" ||
    typeof seed.model?.name !== "string" ||
    !Array.isArray(seed.model.steps) ||
    !seed.model.parts ||
    (await buildRevision(seed.model.pieces)) !== seed.model.revision
  )
    throw new Error("The fork's starting model is unavailable.");
  return seed;
}

export interface SavedFork {
  id: string;
  name: string;
  pieces: number;
  created: number;
  sessionId: string | null;
  /** Ended sessions it carried on from, oldest first. */
  runs?: string[];
  seed: ForkSeed;
}
export type ForkSummary = Omit<SavedFork, "seed">;
