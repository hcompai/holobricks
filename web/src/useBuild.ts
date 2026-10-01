import { useEffect, useState } from "react";
import { publicBuild, showcase, savedFork } from "./library";
import type { Build, Source } from "./model";
import type { Activity } from "./session";
import { provideParts } from "./scene";
import { useSession } from "./useSession";
import type { ForkSeed } from "./fork";
import type { SavedFork } from "./forkModel";
import type { ModelAttachment } from "./session";

export interface BuildRef {
  id: string;
  source: Source;
}

export interface LiveBuild {
  models: ModelAttachment[];
  seed: ForkSeed | null;
  build: Build | null;
  loading: boolean;
  activity: Activity | null;
  error: string | null;
  /** A shown model can remain available, but must not be presented as confirmed live. */
  syncError: string | null;
}

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
    activity: null,
    error,
    syncError: null,
    models: [],
    seed: null,
  };
}

/** A showcase from the static gallery, a public build from the library, or a session read live from the Agents API. */
export function useBuild(ref: BuildRef | null): LiveBuild & {
  runId: string | null;
  attachSession: (id: string) => void;
} {
  const copyId = ref?.source === "fork" ? ref.id : null;
  const [copy, setCopy] = useState<SavedFork | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  useEffect(() => {
    setCopy(null);
    setCopyError(null);
    if (!copyId) return;
    let current = true;
    savedFork(copyId).then(
      (copy) => {
        if (current) {
          provideParts(copy.seed.model.parts);
          setCopy(copy);
        }
      },
      () => {
        if (current) setCopyError("Couldn't load this build");
      },
    );
    return () => {
      current = false;
    };
  }, [copyId]);
  const saved = copy?.id === copyId ? copy : null;
  const runId = ref?.source === "session" ? ref.id : (saved?.sessionId ?? null);
  const finished = useFinished(ref && (ref.source === "public" || ref.source === "showcase") ? ref : null);
  const session = useSession(runId);
  const attachSession = (id: string) => setCopy((copy) => (copy?.id === copyId ? { ...copy, sessionId: id } : copy));
  if (!copyId) return { ...(runId ? session : finished), runId, attachSession };
  if (saved?.sessionId)
    return {
      ...session,
      runId,
      attachSession,
      build: session.build ? { ...session.build, id: copyId } : null,
    };
  return {
    build: saved ? { ...saved.seed.model, id: copyId, status: "done", open: true, messages: [] } : null,
    seed: saved?.seed ?? null,
    models: [],
    loading: !saved && !copyError,
    activity: null,
    error: copyError,
    syncError: null,
    runId: null,
    attachSession,
  };
}
