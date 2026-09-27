import { useEffect, useState } from "react";
import { api, GALLERY, HttpError, type Build, type BuildEvent, type RenderRequest } from "./api";

const THINKING_CHARS = 1500;
const SYNC_MS = 5000;
const REQUEST_MS = 8000;

export interface LiveBuild {
  build: Build | null;
  loading: boolean;
  thinking: string;
  renderRequest: RenderRequest | null;
  error: string | null;
  /** A saved model can remain available, but must not be presented as confirmed live. */
  syncError: string | null;
}

const failure = (e: unknown) =>
  e instanceof HttpError && e.status === 404 ? "Build not found" : "Couldn't load this build";

/** Events are hints to fetch one authoritative snapshot, never deltas to replay over it.
 * Polling repairs missed events, half-open streams, and changes made while a tab was hidden.
 */
export function useBuild(id: string | null): LiveBuild {
  const [build, setBuild] = useState<Build | null>(null);
  const [thinking, setThinking] = useState("");
  const [renderRequest, setRenderRequest] = useState<RenderRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    setBuild(null);
    setThinking("");
    setRenderRequest(null);
    setError(null);
    setSyncError(null);
    if (!id) return;
    let active = true;
    let current: Build | null = null;
    if (GALLERY) {
      api.build(id).then(
        (fetched) => active && setBuild(fetched),
        (e) => active && setError(failure(e)),
      );
      return () => {
        active = false;
      };
    }
    let token = "";
    let source: EventSource | null = null;
    let controller: AbortController | null = null;
    let queued = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const dedicated = new URLSearchParams(location.search).get("renderer") === "1";
    const foreground = () => dedicated || document.visibilityState === "visible";
    const closeStream = () => {
      source?.close();
      source = null;
    };
    const stream = () => {
      // Finished and background tabs release HTTP/1 connection slots. The managed
      // headless renderer remains eligible even when its document is hidden.
      if (!foreground() || current?.status !== "building") {
        closeStream();
        return;
      }
      if (source) return;
      source = api.events(id);
      source.onmessage = (message) => {
        if (!active) return;
        try {
          const event = JSON.parse(message.data) as BuildEvent;
          if (event.type === "thinking") {
            setThinking((t) => (event.reset ? "" : t + event.text).slice(-THINKING_CHARS));
          } else {
            // Coalesce a whole synchronous commit (rewind + steps) into one read.
            schedule(50);
          }
        } catch {
          schedule(0);
        }
      };
      source.onerror = () => {
        closeStream();
        schedule(0);
      };
    };
    const schedule = (delay: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => void resync(), delay);
    };
    const resync = async () => {
      if (!active) return;
      if (controller) {
        queued = true;
        return;
      }
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), REQUEST_MS);
      try {
        const state = await api.state(id, token, controller.signal);
        if (!active) return;
        token = state.token;
        if (state.build) {
          if (state.build.status !== current?.status) setThinking("");
          // Keep the geometry identity when only chat/status changed. This avoids
          // reloading the same GPU scene on every text update.
          if (current?.revision && current.revision === state.build.revision) state.build.pieces = current.pieces;
          current = state.build;
          setBuild(current);
        }
        setError(null);
        setSyncError(null);
        setRenderRequest((previous) => {
          const next = state.renders[0] ?? null;
          return previous?.request === next?.request ? previous : next;
        });
        stream();
      } catch (e) {
        if (!active) return;
        closeStream();
        if (!current) setError(failure(e));
        else setSyncError("Connection lost — the latest model cannot be confirmed. Reconnecting…");
      } finally {
        clearTimeout(timeout);
        controller = null;
        if (active) {
          schedule(queued ? 0 : foreground() ? SYNC_MS : SYNC_MS * 4);
          queued = false;
        }
      }
    };
    const wake = () => {
      if (!foreground()) closeStream();
      else schedule(0);
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    window.addEventListener("focus", wake);
    void resync();
    return () => {
      active = false;
      clearTimeout(timer);
      controller?.abort();
      closeStream();
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      window.removeEventListener("focus", wake);
    };
  }, [id]);

  const current = build?.id === id ? build : null;
  return { build: current, loading: id !== null && !current && !error, thinking, renderRequest, error, syncError };
}
