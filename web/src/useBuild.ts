import type { HaiAgents } from "hai-agents";
import { useCallback, useEffect, useRef, useState } from "react";
import { answer, client, download, fail } from "./agent";
import { EMPTY_MODEL, type Box, type Build, type Camera, type Message, type Model, type RenderRequest } from "./api";
import { remember, showcase, status as buildStatus } from "./library";
import { provideParts } from "./scene";
import { EMPTY_TRANSCRIPT, read, type Transcript } from "./session";

const WAIT_S = 20;
const RETRY_MS = 3000;
const FINISHED = new Set<HaiAgents.TrajectoryStatus>(["completed", "failed", "timed_out", "interrupted"]);

export interface BuildRef {
  id: string;
  showcase: boolean;
}

export interface LiveBuild {
  build: Build | null;
  loading: boolean;
  thinking: string;
  renderRequest: RenderRequest | null;
  error: string | null;
  /** A shown model can remain available, but must not be presented as confirmed live. */
  syncError: string | null;
  /** Hand the builder the render it asked for; true once it has it. */
  answer: (request: RenderRequest, png: Blob) => Promise<boolean>;
}

async function unpack(blob: Blob): Promise<Model> {
  const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  const gzipped = head[0] === 0x1f && head[1] === 0x8b;
  const stream = gzipped ? blob.stream().pipeThrough(new DecompressionStream("gzip")) : blob.stream();
  return JSON.parse(await new Response(stream).text());
}

const dataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

const numbers = (value: unknown, n: number): number[] | null =>
  Array.isArray(value) && value.length === n && value.every(Number.isFinite) ? value : null;

/** The view a `look` call asks for, or why it cannot be drawn. */
function view(args: Record<string, unknown> = {}): { camera: Camera | null; box: Box | null } | string {
  const { angle, elevation, zoom, at, box } = args;
  const b = box === undefined ? null : numbers(box, 6);
  const center = at === undefined ? null : numbers(at, 3);
  if (box !== undefined && !b) return "`box` is six numbers: [x0, y0, z0, x1, y1, z1].";
  if (at !== undefined && !center) return "`at` is three numbers: [x, y, z].";
  const framed = [angle, elevation, zoom, at].some((v) => v !== undefined);
  const camera: Camera = {
    angle: typeof angle === "number" ? angle : 40,
    elevation: Math.min(90, Math.max(0, typeof elevation === "number" ? elevation : 30)),
    zoom: Math.min(16, Math.max(1, typeof zoom === "number" ? zoom : 1)),
    at: center as Camera["at"],
  };
  const [x0, y0, z0, x1, y1, z1] = b ?? [];
  return {
    camera: framed ? camera : null,
    box: b
      ? {
          x0: Math.min(x0, x1),
          y0: Math.min(y0, y1),
          z0: Math.min(z0, z1),
          x1: Math.max(x0, x1),
          y1: Math.max(y0, y1),
          z1: Math.max(z0, z1),
        }
      : null,
  };
}

function caption(model: Model, { camera, box }: RenderRequest): string {
  let text = "The render: 3/4 front-right, 3/4 back-left, front, and top (back at the top).";
  if (camera) {
    const center = camera.at ? `, centered on x ${camera.at[0]}, y ${camera.at[1]}, z ${camera.at[2]}` : "";
    text = `The view from ${camera.angle} degrees, ${camera.elevation} up, zoom ${camera.zoom}${center}.`;
  }
  if (box)
    text = `Only the pieces in the box [${box.x0}, ${box.y0}, ${box.z0}, ${box.x1}, ${box.y1}, ${box.z1}]. ${text}`;
  return `Revision ${model.revision.slice(0, 8)}, ${model.pieces.length} pieces. ${text}`;
}

function ending(status: HaiAgents.TrajectoryStatus, error: string | null): Message | null {
  if (status === "interrupted") return { role: "system", text: "Stopped.", images: [] };
  if (status === "failed" || status === "timed_out")
    return { role: "system", text: `The build stopped: ${error ?? status.replace("_", " ")}.`, images: [] };
  return null;
}

/** A showcase from the static gallery, or a session read live from the Agents API. */
export function useBuild(ref: BuildRef | null): LiveBuild {
  const [build, setBuild] = useState<Build | null>(null);
  const [thinking, setThinking] = useState("");
  const [renderRequest, setRenderRequest] = useState<RenderRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const calls = useRef(new Map<string, { session: string; call: HaiAgents.ToolRequest; model: Model }>());
  const id = ref?.id ?? null;
  const isShowcase = ref?.showcase ?? false;

  useEffect(() => {
    setBuild(null);
    setThinking("");
    setRenderRequest(null);
    setError(null);
    setSyncError(null);
    calls.current.clear();
    if (!id) return;
    const controller = new AbortController();
    const { signal } = controller;
    if (isShowcase) {
      showcase(id).then(
        (shown) => {
          if (signal.aborted) return;
          provideParts(shown.parts);
          setBuild(shown);
        },
        () => !signal.aborted && setError("Couldn't load this build"),
      );
      return () => controller.abort();
    }

    let transcript: Transcript = EMPTY_TRANSCRIPT;
    let status: HaiAgents.TrajectoryStatus = "pending";
    let failure: string | null = null;
    let model = EMPTY_MODEL;
    let loaded = 0;
    const failed = new Set<string>();
    const pictures = new Map<string, string | null>();

    const shown = (messages: Message[]) =>
      messages.map((m) => ({
        ...m,
        images: m.images.flatMap((src) => (src.startsWith("data:") ? [src] : (pictures.get(src) ?? []))),
      }));

    const fetchPictures = () => {
      for (const m of transcript.messages)
        for (const src of m.images) {
          if (src.startsWith("data:") || pictures.has(src)) continue;
          pictures.set(src, null);
          download(src, signal).then(
            (blob) => {
              pictures.set(src, URL.createObjectURL(blob));
              publish();
            },
            () => undefined,
          );
        }
    };

    const publish = () => {
      if (signal.aborted) return;
      const busy = buildStatus(status) === "building";
      const end = ending(status, failure ?? transcript.error);
      setBuild({
        ...model,
        id,
        status: buildStatus(status),
        messages: shown(end ? [...transcript.messages, end] : transcript.messages),
        open: status === "idle",
      });
      setThinking(busy ? transcript.thinking : "");
      const look =
        transcript.state === "awaiting_tool_results" ? transcript.looks.find((l) => l.shared <= loaded) : undefined;
      if (!look || !look.call.id) return setRenderRequest(null);
      const wanted = view(look.call.args);
      if (typeof wanted === "string" || look.shared === 0) {
        const reason = typeof wanted === "string" ? wanted : "Nothing is shared yet: share model.json.gz, then look.";
        if (!failed.has(look.call.id)) {
          failed.add(look.call.id);
          void fail(id, look.call, reason).catch(() => failed.delete(look.call.id!));
        }
        return setRenderRequest(null);
      }
      calls.current.set(look.call.id, { session: id, call: look.call, model });
      setRenderRequest((previous) =>
        previous?.request === look.call.id ? previous : { request: look.call.id!, ...wanted, revision: model.revision },
      );
    };

    const loadModel = async () => {
      const latest = transcript.model;
      if (!latest || latest.shared === loaded) return;
      const next = await unpack(await download(latest.url, signal));
      provideParts(next.parts);
      if (next.revision === model.revision) next.pieces = model.pieces;
      model = next;
      loaded = latest.shared;
      remember(id, { name: model.name, pieces: model.pieces.length });
    };

    const poll = async () => {
      while (!signal.aborted) {
        try {
          const changes = await client.sessions.getSessionChanges(
            { id, fromIndex: transcript.events, includeEvents: true, waitForSeconds: WAIT_S },
            { abortSignal: signal, timeoutInSeconds: WAIT_S + 20, maxRetries: 0 },
          );
          if (changes) {
            transcript = read(transcript, changes.newEvents ?? []);
            status = changes.status;
            failure = changes.error ?? null;
          } else {
            const current = await client.sessions.getSessionStatus({ id }, { abortSignal: signal });
            status = current.status;
            failure = current.error ?? null;
          }
          await loadModel();
          fetchPictures();
          publish();
          setSyncError(null);
          if (!changes && FINISHED.has(status)) return;
        } catch (e) {
          if (signal.aborted) return;
          console.error(e);
          if (!transcript.events) setError("Couldn't load this build");
          else setSyncError("Connection lost: the latest model cannot be confirmed. Reconnecting…");
          await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
        }
      }
    };
    void poll();
    return () => {
      controller.abort();
      for (const url of pictures.values()) if (url) URL.revokeObjectURL(url);
    };
  }, [id, isShowcase]);

  const answerRender = useCallback(async (request: RenderRequest, png: Blob) => {
    const pending = calls.current.get(request.request);
    if (!pending || pending.model.revision !== request.revision) return false;
    try {
      await answer(pending.session, pending.call, [caption(pending.model, request), await dataUrl(png)]);
    } catch (e) {
      if (!(e instanceof Error && "statusCode" in e && e.statusCode === 409)) throw e;
    }
    calls.current.delete(request.request);
    return true;
  }, []);

  const current = build?.id === id ? build : null;
  return {
    build: current,
    loading: id !== null && !current && !error,
    thinking,
    renderRequest,
    error,
    syncError,
    answer: answerRender,
  };
}
