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
