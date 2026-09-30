import { useEffect, useState } from "react";
import { publicBuild, showcase } from "./library";
import type { Build, RenderRequest, Source } from "./model";
import { provideParts } from "./scene";
import { useSession } from "./useSession";

export interface BuildRef {
  id: string;
  source: Source;
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

const noAnswer = async () => false;

/** A finished build that no builder works on: a showcase, or a public build. */
function useFinished(ref: BuildRef | null): LiveBuild {
  const [build, setBuild] = useState<Build | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = ref?.id ?? null;
  const source = ref?.source ?? null;

  useEffect(() => {
    setBuild(null);
    setError(null);
    if (!id) return;
    let current = true;
    (source === "public" ? publicBuild(id) : showcase(id)).then(
      (shown) => {
        if (!current) return;
        provideParts(shown.parts);
        setBuild(shown);
      },
      () => current && setError("Couldn't load this build"),
    );
    return () => {
      current = false;
    };
  }, [id, source]);

  const shown = build?.id === id ? build : null;
  return {
    build: shown,
    loading: id !== null && !shown && !error,
    thinking: "",
    renderRequest: null,
    error,
    syncError: null,
    answer: noAnswer,
  };
}

/** A showcase from the static gallery, a public build from the library, or a session read live from the Agents API. */
export function useBuild(ref: BuildRef | null): LiveBuild {
  const live = ref?.source === "session";
  const finished = useFinished(live ? null : ref);
  const session = useSession(ref && live ? ref.id : null);
  return live ? session : finished;
}
