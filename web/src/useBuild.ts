import { useEffect, useState } from "react";
import { api, GALLERY, HttpError, type Build, type BuildEvent, type RenderRequest } from "./api";

const THINKING_CHARS = 1500;

function apply(build: Build, event: BuildEvent): Build {
  switch (event.type) {
    case "hello":
    case "build": {
      const { name, prompt, builder, status, created, updated, width, depth } = event.build;
      return { ...build, name, prompt, builder, status, created, updated, width, depth };
    }
    case "message":
      if (build.messages.some((m) => m.at === event.message.at && m.text === event.message.text)) return build;
      return { ...build, messages: [...build.messages, event.message] };
    case "step":
      if (event.step.index < build.steps.length) return build;
      return {
        ...build,
        steps: [...build.steps, event.step],
        pieces: [...build.pieces, ...event.pieces],
        width: event.width,
        depth: event.depth,
      };
    case "rewind":
      return {
        ...build,
        steps: build.steps.slice(0, event.steps),
        pieces: build.pieces.filter((p) => p.step < event.steps),
        width: event.width,
        depth: event.depth,
      };
    case "thinking":
    case "render":
      return build;
  }
}

export interface LiveBuild {
  build: Build | null;
  /** A build is open but its snapshot has not arrived yet. */
  loading: boolean;
  /** The tail of the builder's current reasoning, streamed live. */
  thinking: string;
  /** The latest render the builder asked a viewer for. */
  renderRequest: RenderRequest | null;
  /** Why the build could not be opened; null while it loads or once it has. */
  error: string | null;
}

const failure = (e: unknown) =>
  e instanceof HttpError && e.status === 404 ? "Build not found" : "Couldn't load this build";

/** The open build, kept live by its event stream; every (re)connect resyncs from a snapshot and replays what arrived meanwhile. */
export function useBuild(id: string | null): LiveBuild {
  const [build, setBuild] = useState<Build | null>(null);
  const [thinking, setThinking] = useState("");
  const [renderRequest, setRenderRequest] = useState<RenderRequest | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBuild(null);
    setThinking("");
    setRenderRequest(null);
    setError(null);
    if (!id) return;
    let active = true;
    let current: Build | null = null;
    const failed = (e: unknown) => {
      console.error(e);
      if (active && !current) setError(failure(e));
    };
    if (GALLERY) {
      api.build(id).then((fetched) => active && setBuild((current = fetched)), failed);
      return () => {
        active = false;
      };
    }
    let pending: BuildEvent[] | null = null;
    let sync = 0;
    const resync = () => {
      const mine = ++sync;
      pending = [];
      api.build(id).then(
        (fetched) => {
          if (!active || mine !== sync) return;
          current = (pending ?? []).reduce(apply, fetched);
          pending = null;
          setBuild(current);
        },
        (e) => {
          if (mine === sync) pending = null;
          failed(e);
        },
      );
    };
    let connected = false;
    const source = api.events(id);
    source.onmessage = (e) => {
      if (!active) return;
      const event = JSON.parse(e.data) as BuildEvent;
      if (event.type === "hello") {
        if (connected || event.build.status === "building") resync();
        connected = true;
        return;
      }
      if (event.type === "build" && event.build.status === "building") setThinking("");
      if (event.type === "thinking") {
        setThinking((t) => (event.reset ? "" : t + event.text).slice(-THINKING_CHARS));
        return;
      }
      if (event.type === "render") {
        setRenderRequest({ request: event.request, camera: event.camera, box: event.box, pieces: event.pieces });
        return;
      }
      if (pending) pending.push(event);
      else if (current) setBuild((current = apply(current, event)));
    };
    resync();
    return () => {
      active = false;
      source.close();
    };
  }, [id]);

  const current = build?.id === id ? build : null;
  return { build: current, loading: id !== null && !current && !error, thinking, renderRequest, error };
}
