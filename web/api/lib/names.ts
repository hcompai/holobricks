import { BlobNotFoundError, del, head, list, put } from "@vercel/blob";
import { privateScope } from "./account";

export interface ProjectName {
  id: string;
  name: string;
  updated: number;
}

const prefix = (owner: string) => `names/${privateScope(owner)}/`;
const path = (owner: string, id: string) => `${prefix(owner)}${id}.json`;

export async function projectName(owner: string, id: string): Promise<ProjectName | null> {
  try {
    const blob = await head(path(owner, id));
    const response = await fetch(blob.url);
    if (!response.ok) throw new Error("Name unavailable");
    return response.json();
  } catch (e) {
    if (e instanceof BlobNotFoundError) return null;
    throw e;
  }
}

export async function projectNames(owner: string): Promise<ProjectName[]> {
  const found: ProjectName[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: prefix(owner), cursor, limit: 1000 });
    for (let i = 0; i < page.blobs.length; i += 16)
      found.push(
        ...(await Promise.all(
          page.blobs.slice(i, i + 16).map(async (blob) => {
            const response = await fetch(blob.url);
            if (!response.ok) throw new Error("Names unavailable");
            return response.json() as Promise<ProjectName>;
          }),
        )),
      );
    cursor = page.cursor;
  } while (cursor);
  return found;
}

export async function saveProjectName(owner: string, id: string, name: string): Promise<ProjectName> {
  const entry = { id, name, updated: Date.now() };
  await put(path(owner, id), JSON.stringify(entry), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    contentType: "application/json",
  });
  return entry;
}

export const deleteProjectName = (owner: string, id: string) => del(path(owner, id));
