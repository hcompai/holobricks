import { del, list, put } from "@vercel/blob";
import { privateScope } from "./account";

/** Who hearted what: one empty file per (build, user), so a heart is idempotent and counting is a listing. */
const PREFIX = "hearts/";
const file = (id: string, user: string) => `${PREFIX}${id}/${privateScope(user).slice(0, 32)}.json`;
const buildFolder = (id: string) => `${PREFIX}${id}/`;

export interface Hearts {
  /** Hearts per public build id; builds without hearts are absent. */
  counts: Record<string, number>;
  /** The ids the asking user hearted; empty when signed out. */
  mine: string[];
}

async function paths(prefix: string): Promise<string[]> {
  const found: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    found.push(...page.blobs.map((b) => b.pathname));
    cursor = page.cursor;
  } while (cursor);
  return found;
}

export async function hearts(user: string | null): Promise<Hearts> {
  const own = user ? privateScope(user).slice(0, 32) : null;
  const counts: Record<string, number> = {};
  const mine: string[] = [];
  for (const path of await paths(PREFIX)) {
    const [id, who] = path.slice(PREFIX.length).split("/");
    if (!id || !who) continue;
    counts[id] = (counts[id] ?? 0) + 1;
    if (who === `${own}.json`) mine.push(id);
  }
  return { counts, mine };
}

export async function heart(id: string, user: string) {
  await put(file(id, user), "{}", {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}

export async function unheart(id: string, user: string) {
  await del(file(id, user));
}

/** Forget every heart of a build that leaves the library. */
export async function clearHearts(id: string) {
  const found = await paths(buildFolder(id));
  if (found.length) await del(found);
}
