import { useEffect, useState } from "react";
import { api, type Build, type BuildEvent } from "./api";

function apply(build: Build, event: BuildEvent): Build {
  switch (event.type) {
    case "hello":
    case "build": {
      const { name, prompt, builder, status, created, width, depth } = event.build;
      return { ...build, name, prompt, builder, status, created, width, depth };
    }
    case "message":
      if (build.messages.some((m) => m.at === event.message.at && m.text === event.message.text)) return build;
      return { ...build, messages: [...build.messages, event.message] };
    case "step":
      if (event.step.index < build.steps.length) return build;
      return { ...build, steps: [...build.steps, event.step], pieces: [...build.pieces, ...event.pieces] };
  }
}

/** The open build, kept live by its event stream; events that arrive before the first fetch are replayed on it. */
export function useBuild(id: string | null): Build | null {
  const [build, setBuild] = useState<Build | null>(null);

  useEffect(() => {
    setBuild(null);
    if (!id) return;
    let pending: BuildEvent[] | null = [];
    let current: Build | null = null;
    const source = api.events(id);
    source.onmessage = (e) => {
      const event = JSON.parse(e.data) as BuildEvent;
      if (pending) pending.push(event);
      else if (current) setBuild((current = apply(current, event)));
    };
    api.build(id).then((fetched) => {
      current = (pending ?? []).reduce(apply, fetched);
      pending = null;
      setBuild(current);
    });
    return () => source.close();
  }, [id]);

  return build;
}
