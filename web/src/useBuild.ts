import { useEffect, useState } from "react";
import { showcase } from "./library";
import type { Build, RenderRequest } from "./model";
import { provideParts } from "./scene";
import { useSession } from "./useSession";

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

const noAnswer = async () => false;

function useShowcase(id: string | null): LiveBuild {
  const [build, setBuild] = useState<Build | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBuild(null);
    setError(null);
    if (!id) return;
    let current = true;
    showcase(id).then(
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
  }, [id]);

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

/** A showcase from the static gallery, or a session read live from the Agents API. */
export function useBuild(ref: BuildRef | null): LiveBuild {
  const shown = useShowcase(ref?.showcase ? ref.id : null);
  const live = useSession(ref && !ref.showcase ? ref.id : null);
  return ref?.showcase ? shown : live;
}
