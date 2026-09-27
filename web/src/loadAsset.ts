/** Bound the entire response, including a body that stalls after HTTP headers. */
export async function loadAsset(url: string, signal: AbortSignal, timeout = 12000): Promise<string> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(() => controller.abort(new Error(`Loading ${url} timed out`)), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-cache" });
    if (!response.ok) throw new Error(`Could not load ${url} (HTTP ${response.status})`);
    return await response.text();
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}

export async function pieceRevision(pieces: import("./api").Piece[]): Promise<string> {
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
