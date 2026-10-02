import { list, put } from "@vercel/blob";
import { privateScope } from "./account";

/** Projects the owner removed from their library, such as sessions, which the Agents API cannot delete. */
const prefix = (owner: string) => `removed/${privateScope(owner)}/`;

export async function removedIds(owner: string): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: prefix(owner), cursor, limit: 1000 });
    ids.push(...page.blobs.map((b) => b.pathname.slice(prefix(owner).length).replace(/\.json$/, "")));
    cursor = page.cursor;
  } while (cursor);
  return ids;
}

export async function markRemoved(owner: string, ids: string[]) {
  await Promise.all(
    ids.map((id) =>
      put(`${prefix(owner)}${id}.json`, JSON.stringify({ id, removed: Date.now() }), {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/json",
      }),
    ),
  );
}
