import { del, get, list, put } from "@vercel/blob";
import { Refusal } from "./http";

/** A separate private Blob store; never fall back to the public store token. */
export function privateToken(): string {
  const token = process.env.BRICKYARD_PRIVATE_BLOB_TOKEN;
  if (!token || token === process.env.BLOB_READ_WRITE_TOKEN)
    throw new Refusal(503, "Private storage is not configured on this server.");
  return token;
}

export const privatePrefix = (owner: string) => `private/${encodeURIComponent(owner)}/`;
export const privateEntry = (owner: string, id: string) => `${privatePrefix(owner)}${id}.json`;
export const privateFolder = (owner: string, id: string) => `${privatePrefix(owner)}${id}/`;
export const privateUrl = (id: string, file: string) => `/api/builds?${new URLSearchParams({ id, file })}`;

export async function privateFiles(prefix: string) {
  const blobs = [];
  let cursor: string | undefined;
  do {
    const page = await list({ token: privateToken(), prefix, cursor, limit: 1000 });
    blobs.push(...page.blobs);
    cursor = page.cursor;
  } while (cursor);
  return blobs;
}

export async function privateRead(path: string): Promise<Response | null> {
  const result = await get(path, {
    token: privateToken(),
    access: "private",
    useCache: false,
    abortSignal: AbortSignal.timeout(60_000),
  });
  return result?.statusCode === 200
    ? new Response(result.stream, { headers: { "Content-Type": result.blob.contentType } })
    : null;
}

export async function privateWrite(path: string, data: string | Buffer, contentType: string) {
  await put(path, data, {
    token: privateToken(),
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType,
    cacheControlMaxAge: 60,
  });
}

export async function privateDelete(paths: string[]) {
  if (paths.length) await del(paths, { token: privateToken() });
}
