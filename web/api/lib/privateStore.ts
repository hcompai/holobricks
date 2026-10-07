import { BlobNotFoundError, del, get, head, list, put } from "@vercel/blob";
import { Refusal } from "./http";

const configuredToken = () =>
  process.env.BRICKYARD_PRIVATE_BLOB_TOKEN ?? process.env.BRICKYARD_PRIVATE_BLOB_READ_WRITE_TOKEN;
export const privateConfigured = () => Boolean(configuredToken());

/** A separate private Blob store; never fall back to the public store token. */
export function privateToken(): string {
  const token = configuredToken();
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
  const token = privateToken();
  let url: string;
  try {
    // Read the canonical URL: older SDKs cannot infer a store id from Vercel's v2 tokens.
    url = (await head(path, { token })).url;
  } catch (error) {
    if (error instanceof BlobNotFoundError) return null;
    throw error;
  }
  const result = await get(url, {
    token,
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
