import { isTerminalSessionStatus, type HaiAgents } from "hai-agents";
import { answer, client, download, fail } from "./agent";
import { card, remember, thumbnail } from "./library";
import { H } from "./hosts";
import { cachedSeed, readSeed, requestedSeed, type ForkSeed } from "./fork";
import { caption, dataUrl, view } from "./look";
import { EMPTY_MODEL, type Build, type Message, type Model, type RenderRequest } from "./model";
import { BrickScene, provideParts } from "./scene";
import {
  type Activity,
  activity,
  EMPTY_TRANSCRIPT,
  ending,
  read,
  status as buildStatus,
  type Transcript,
  type ModelAttachment,
  unpack,
} from "./session";

const WAIT_S = 20;
const RETRY_MS = 3000;
const RENDER_TRIES = 3;
const LOAD_TRIES = 3;

/** A session as the Agents API last told it. */
export interface Followed {
  /** The completed inspection of the currently loaded revision. */
  inspection: RenderRequest | null;
  models: ModelAttachment[];
  seed: ForkSeed | null;
  build: Build | null;
  /** What the builder is doing, while it builds. */
  activity: Activity | null;
  /** Why the build cannot be read at all; its follower has stopped. */
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
  let state: Followed = {
    build: null,
    activity: null,
    error: null,
    syncError: null,
    models: [],
    seed: null,
    inspection: null,
  };
  const set = (next: Partial<Followed>) => {
    if (signal.aborted) return;
    state = { ...state, ...next };
    notify(state);
  };
  let transcript: Transcript = EMPTY_TRANSCRIPT;
  let session: HaiAgents.TrajectoryStatus = "pending";
  let failure: string | null = null;
  let seed = cachedSeed(id);
  let checkedSeed = !!seed;
  let model = seed?.model ?? EMPTY_MODEL;
  let loaded = 0;
  /** The latest shared model while it fails to load: how many times, and why. */
  let unloaded: { shared: number; tries: number; reason: string } | null = null;
  /** Whether the model changed since this follower last saw the session settle. */
  let changed = false;
  const seen = new Set<string>();
  const pictures = new Map<string, string | null>();

  const shown = (messages: Message[]) =>
    messages.map((m) => ({
      ...m,
      images: m.images.flatMap((src) => (!src.startsWith(`${H.agents}/`) ? [src] : (pictures.get(src) ?? []))),
    }));

  const fetchPictures = () => {
    if (!displayed()) return;
    const sources = [...transcript.messages.flatMap((m) => m.images), ...transcript.references.map((r) => r.src)];
    for (const src of sources) {
      if (src.startsWith("data:") || !src.startsWith(`${H.agents}/`) || pictures.has(src)) continue;
      pictures.set(src, null);
      download(src, signal).then(
        (blob) => {
          if (signal.aborted) return;
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
        await answer(id, call, [caption(shot, request), await dataUrl(png)]);
        if (!signal.aborted && model.revision === shot.revision) {
          transcript = { ...transcript, inspection: request };
          publish();
        }
        return;
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
      inspection:
        transcript.inspection && model.revision.startsWith(transcript.inspection.revision)
          ? { ...transcript.inspection, revision: model.revision }
          : null,
      models: transcript.models,
      seed,
      build: {
        ...model,
        name: seed?.model.name ?? (named(model) ? model.name : (card(id)?.name ?? model.name)),
        id,
        status: buildStatus(session),
        messages: shown(end ? [...transcript.messages, end] : transcript.messages),
        open: session === "idle",
        failure: failure ?? transcript.error,
      },
      activity:
        buildStatus(session) === "building"
          ? {
              ...activity(transcript),
              references: transcript.references.flatMap((r) => {
                const src = r.src.startsWith(`${H.agents}/`) ? pictures.get(r.src) : r.src;
                return src ? [{ ...r, src }] : [];
              }),
            }
          : null,
    });
    if (transcript.state !== "awaiting_tool_results") return;
    const lost = unloaded && unloaded.tries >= LOAD_TRIES ? unloaded : null;
    const look = transcript.looks.find((l) => l.shared <= loaded || lost);
    const call = look?.call;
    if (!look || !call?.id || seen.has(call.id)) return;
    seen.add(call.id);
    const answered =
      look.shared <= loaded
        ? see(call, look.shared)
        : fail(id, call, `The model you shared could not be loaded (${lost!.reason}). Share it again, then look.`);
    answered.catch((e) => {
      if (status(e) !== 409) seen.delete(call.id!);
    });
  };

  const loadModel = async () => {
    if (!seed && transcript.fork) {
      seed = await readSeed(await download(transcript.fork, signal));
      checkedSeed = true;
      provideParts(seed.model.parts);
      if (!loaded) model = seed.model;
    }
    // Queued or failed setup may not have emitted attachment events yet.
    if (!checkedSeed && !transcript.model) {
      seed = await requestedSeed(id, signal);
      checkedSeed = true;
      if (seed) {
        provideParts(seed.model.parts);
        model = seed.model;
      }
    }
    const latest = transcript.model;
    if (!latest || latest.shared === loaded) return;
    try {
      const next = await unpack<Model>(await download(latest.url, signal));
      provideParts(next.parts);
      if (next.revision === model.revision) next.pieces = model.pieces;
      else changed = true;
      model = next;
      loaded = latest.shared;
      unloaded = null;
      remember(id, { pieces: model.pieces.length, ...(named(model) && { name: seed?.model.name ?? model.name }) });
    } catch (e) {
      if (signal.aborted) throw e;
      console.error("Could not load the latest model", e);
      const tries = unloaded?.shared === latest.shared ? unloaded.tries + 1 : 1;
      unloaded = { shared: latest.shared, tries, reason: e instanceof Error ? e.message : String(e) };
    }
  };

  const poll = async () => {
    while (!signal.aborted) {
      try {
        const changed = (waitForSeconds: number) =>
          client.sessions.getSessionChanges(
            { id, fromIndex: transcript.events, includeEvents: true, waitForSeconds },
            { abortSignal: signal, timeoutInSeconds: waitForSeconds + 20, maxRetries: 0 },
          );
        let changes = await changed(WAIT_S);
        if (!changes) {
          const current = await client.sessions.getSessionStatus({ id }, { abortSignal: signal });
          /** Events can land between the long poll and the status: fetch them so the status never outruns the transcript. */
          if (current.status !== session) changes = await changed(0);
          if (!changes) {
            session = current.status;
            failure = current.error ?? null;
          }
        }
        if (changes) {
          transcript = read(transcript, changes.newEvents ?? []);
          session = changes.status;
          failure = changes.error ?? null;
        }
        await loadModel();
        fetchPictures();
        publish();
        set({ error: null, syncError: unloaded && "Couldn't load the latest model." });
        if (!changes && isTerminalSessionStatus(session)) {
          if (!unloaded || unloaded.tries >= LOAD_TRIES) return;
          await sleep(RETRY_MS);
        }
      } catch (e) {
        if (signal.aborted) return;
        console.error(e);
        const code = status(e);
        if (code === 403 || code === 404) return set({ error: "Couldn't load this build" });
        set({ syncError: "Connection lost: the latest model cannot be confirmed. Reconnecting…" });
        await sleep(RETRY_MS);
      }
    }
  };
  if (seed) {
    provideParts(seed.model.parts);
    publish();
  }
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
