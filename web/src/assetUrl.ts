import { H } from "./hosts";

/** Only the configured Agents origin may receive the user's API key. */
export function platformAsset(src: string): boolean {
  try {
    const url = new URL(src);
    return url.protocol === "https:" && !url.username && !url.password && url.origin === new URL(H.agents).origin;
  } catch {
    return false;
  }
}

/** External photos stay links; the server never fetches arbitrary image destinations. */
export function externalImage(src: string): boolean {
  try {
    const url = new URL(src);
    return url.protocol === "https:" && !url.username && !url.password && !platformAsset(src);
  } catch {
    return false;
  }
}

/** Stop oversized attachments while reading, including responses without Content-Length. */
export async function assetBlob(response: Response): Promise<Blob> {
  const limit = 10 * 1024 * 1024;
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    throw new Error("The attachment is too large");
  }
  const reader = response.body?.getReader();
  if (!reader) return new Blob();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error("The attachment is too large");
      chunks.push(new Uint8Array(value));
    }
    return new Blob(chunks, { type: response.headers.get("content-type") ?? "" });
  } finally {
    await reader.cancel();
  }
}
