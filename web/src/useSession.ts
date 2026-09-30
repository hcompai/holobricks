import { isTerminalSessionStatus, type HaiAgents } from "hai-agents";
import { useCallback, useEffect, useRef, useState } from "react";
import { answer, client, download, fail } from "./agent";
import { card, remember } from "./library";
import { caption, dataUrl, view } from "./look";
import { EMPTY_MODEL, type Build, type Message, type Model, type RenderRequest } from "./model";
import { provideParts } from "./scene";
import { EMPTY_TRANSCRIPT, ending, read, status as buildStatus, type Transcript, unpack } from "./session";
import type { LiveBuild } from "./useBuild";

const WAIT_S = 20;
const RETRY_MS = 3000;

const named = (model: Model) => model.name !== EMPTY_MODEL.name;

/** A session read live from the Agents API, with the `look` calls it waits on. */
export function useSession(id: string | null): LiveBuild {
  const [build, setBuild] = useState<Build | null>(null);
  const [thinking, setThinking] = useState("");
  const [renderRequest, setRenderRequest] = useState<RenderRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const calls = useRef(new Map<string, { session: string; call: HaiAgents.ToolRequest; model: Model }>());

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
        name: named(model) ? model.name : (card(id)?.name ?? model.name),
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
      const next = await unpack<Model>(await download(latest.url, signal));
      provideParts(next.parts);
      if (next.revision === model.revision) next.pieces = model.pieces;
      model = next;
      loaded = latest.shared;
      remember(id, { pieces: model.pieces.length, ...(named(model) && { name: model.name }) });
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
          if (!changes && isTerminalSessionStatus(status)) return;
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
  }, [id]);

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
