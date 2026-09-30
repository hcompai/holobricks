import { isTerminalSessionStatus, type HaiAgents } from "hai-agents";
import { answer, client, download, fail } from "./agent";
import { card, remember, thumbnail } from "./library";
import { caption, dataUrl, view } from "./look";
import { EMPTY_MODEL, type Build, type Message, type Model } from "./model";
import { BrickScene, provideParts } from "./scene";
import {
  type Activity,
  activity,
  EMPTY_TRANSCRIPT,
  ending,
  read,
  status as buildStatus,
  type Transcript,
  unpack,
} from "./session";

const WAIT_S = 20;
const RETRY_MS = 3000;
const RENDER_TRIES = 3;

/** A session as the Agents API last told it. */
export interface Followed {
  build: Build | null;
  /** What the builder is doing, while it builds. */
  activity: Activity | null;
  error: string | null;
  /** A shown model can remain available, but must not be presented as confirmed live. */
  syncError: string | null;
}

type Listener = (state: Followed) => void;

const named = (model: Model) => model.name !== EMPTY_MODEL.name;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const status = (e: unknown) => (e instanceof Error && "statusCode" in e ? e.statusCode : null);

let eye: BrickScene | null = null;
let rendering: Promise<unknown> = Promise.resolve();

/** `model` drawn off screen by `draw`, one render at a time, whatever the user is looking at. */
function render(model: Model, draw: (scene: BrickScene) => Promise<Blob | null>): Promise<Blob | null> {
  const next = rendering.then(async () => {
    try {
      eye ??= new BrickScene(document.createElement("div"), { interactive: false });
      if (!(await eye.setPieces(model.pieces))) return null;
      return await draw(eye);
    } catch (e) {
      eye?.dispose();
      eye = null;
      throw e;
    }
  });
  rendering = next.catch(() => undefined);
  return next;
}

/** Poll session `id` until it ends or `signal` aborts, answering every `look` it waits on. */
function follow(id: string, signal: AbortSignal, notify: Listener, displayed: () => boolean) {
  let state: Followed = { build: null, activity: null, error: null, syncError: null };
  const set = (next: Partial<Followed>) => {
    if (signal.aborted) return;
    state = { ...state, ...next };
    notify(state);
  };
  let transcript: Transcript = EMPTY_TRANSCRIPT;
  let session: HaiAgents.TrajectoryStatus = "pending";
  let failure: string | null = null;
  let model = EMPTY_MODEL;
  let loaded = 0;
  /** Whether the model changed since this follower last saw the session settle. */
  let changed = false;
  const seen = new Set<string>();
  const pictures = new Map<string, string | null>();

  const shown = (messages: Message[]) =>
    messages.map((m) => ({
      ...m,
      images: m.images.flatMap((src) => (src.startsWith("data:") ? [src] : (pictures.get(src) ?? []))),
    }));

  const fetchPictures = () => {
    if (!displayed()) return;
    for (const m of transcript.messages)
      for (const src of m.images) {
        if (src.startsWith("data:") || pictures.has(src)) continue;
        pictures.set(src, null);
        download(src, signal).then(
          (blob) => {
            pictures.set(src, URL.createObjectURL(blob));
            publish();
          },
          () => pictures.delete(src),
        );
      }
  };

  const see = async (call: HaiAgents.ToolRequest, shared: number) => {
    const wanted = view(call.args);
    if (typeof wanted === "string" || shared === 0)
      return fail(
        id,
        call,
        typeof wanted === "string" ? wanted : "Nothing is shared yet: share model.json.gz, then look.",
      );
    const shot = model;
    for (let tries = 1; ; tries++) {
      try {
        const png = await render(shot, (scene) =>
          scene.renderBuild(shot.pieces, shot.revision, wanted.camera, wanted.box),
        );
        if (!png) throw new Error("the render came back empty");
        const request = { request: call.id!, ...wanted, revision: shot.revision };
        return await answer(id, call, [caption(shot, request), await dataUrl(png)]);
      } catch (e) {
        if (signal.aborted || status(e) === 409) return;
        console.error("Could not answer a look", e);
        if (tries >= RENDER_TRIES) {
          const reason = e instanceof Error ? e.message : String(e);
          return fail(id, call, `The render failed (${reason}). Carry on from the run's output, and look again later.`);
        }
        await sleep(RETRY_MS);
      }
    }
  };

  /** The library tile of a build that finished off screen; the viewer makes the one of a build on screen. */
  const keepThumbnail = () => {
    const shot = model;
    if (!shot.pieces.length || card(id)?.revision === shot.revision) return;
    render(shot, (scene) => scene.renderThumbnail(shot.pieces))
      .then(async (png) => png && remember(id, { thumbnail: await thumbnail(png), revision: shot.revision }))
      .catch((e) => console.error("Could not make the thumbnail", e));
  };

  const publish = () => {
    if (changed && buildStatus(session) === "done") {
      changed = false;
      if (!displayed()) keepThumbnail();
    }
    const end = ending(session, failure ?? transcript.error);
    set({
      build: {
        ...model,
        name: named(model) ? model.name : (card(id)?.name ?? model.name),
        id,
        status: buildStatus(session),
        messages: shown(end ? [...transcript.messages, end] : transcript.messages),
        open: session === "idle",
        failure: failure ?? transcript.error,
      },
      activity: buildStatus(session) === "building" ? activity(transcript) : null,
    });
    if (transcript.state !== "awaiting_tool_results") return;
    const look = transcript.looks.find((l) => l.shared <= loaded);
    const call = look?.call;
    if (!look || !call?.id || seen.has(call.id)) return;
    seen.add(call.id);
    see(call, look.shared).catch((e) => {
      if (status(e) !== 409) seen.delete(call.id!);
    });
  };

  const loadModel = async () => {
    const latest = transcript.model;
    if (!latest || latest.shared === loaded) return;
    const next = await unpack<Model>(await download(latest.url, signal));
    provideParts(next.parts);
    if (next.revision === model.revision) next.pieces = model.pieces;
    else changed = true;
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
          session = changes.status;
          failure = changes.error ?? null;
        } else {
          const current = await client.sessions.getSessionStatus({ id }, { abortSignal: signal });
          session = current.status;
          failure = current.error ?? null;
        }
        await loadModel();
        fetchPictures();
        publish();
        set({ error: null, syncError: null });
        if (!changes && isTerminalSessionStatus(session)) return;
      } catch (e) {
        if (signal.aborted) return;
        console.error(e);
        const code = status(e);
        if (code === 403 || code === 404) return set({ error: "Couldn't load this build" });
        if (!transcript.events) set({ error: "Couldn't load this build" });
        else set({ syncError: "Connection lost: the latest model cannot be confirmed. Reconnecting…" });
        await sleep(RETRY_MS);
      }
    }
  };
  void poll();
  return {
    refresh: () => {
      fetchPictures();
      if (state.build) publish();
    },
    release: () => {
      for (const url of pictures.values()) if (url) URL.revokeObjectURL(url);
    },
  };
}

interface Watched {
  controller: AbortController;
  listeners: Map<Listener, boolean>;
  state: Followed | null;
  follower: ReturnType<typeof follow>;
}

const watched = new Map<string, Watched>();

/** Follow session `id` for `listener` until the returned function is called; one follower serves every listener. */
export function watch(id: string, listener: Listener, { display = false } = {}): () => void {
  let entry = watched.get(id);
  if (!entry) {
    const controller = new AbortController();
    const listeners = new Map<Listener, boolean>();
    const created: Watched = { controller, listeners, state: null, follower: null! };
    created.follower = follow(
      id,
      controller.signal,
      (state) => {
        created.state = state;
        for (const l of listeners.keys()) l(state);
      },
      () => [...listeners.values()].some(Boolean),
    );
    watched.set(id, (entry = created));
  }
  const current = entry;
  current.listeners.set(listener, display);
  if (current.state) listener(current.state);
  if (display) current.follower.refresh();
  return () => {
    if (!current.listeners.delete(listener) || current.listeners.size) return;
    current.controller.abort();
    current.follower.release();
    watched.delete(id);
  };
}
