import { useEffect, useRef, useState } from "react";
import { type Followed, watch } from "./follow";
import type { LiveBuild } from "./useBuild";

const NOTHING: Followed = { build: null, activity: null, error: null, syncError: null };

/** A session read live from the Agents API. */
export function useSession(id: string | null): LiveBuild {
  const [followed, setFollowed] = useState<Followed & { id: string | null }>({ ...NOTHING, id: null });

  useEffect(() => {
    setFollowed({ ...NOTHING, id });
    if (!id) return;
    return watch(id, (state) => setFollowed({ ...state, id }), { display: true });
  }, [id]);

  const current = followed.id === id ? followed : { ...NOTHING, id };
  const build = current.build?.id === id ? current.build : null;
  return {
    build,
    loading: id !== null && !build && !current.error,
    activity: current.activity,
    error: current.error,
    syncError: current.syncError,
  };
}

/** Keep following the user's running builds wherever they are in the app, so Holo never waits on a closed viewer; each until its follower sees it settle, which the library can report first. */
export function useKeeper(running: string[], onSettled: () => void) {
  const held = useRef(new Map<string, () => void>());
  /** Builds seen settling, skipped until the library stops listing them as running. */
  const ended = useRef(new Set<string>());
  const settled = useRef(onSettled);
  settled.current = onSettled;
  const key = [...running].sort().join(" ");

  useEffect(() => {
    const wanted = new Set(running);
    for (const id of ended.current) if (!wanted.has(id)) ended.current.delete(id);
    for (const id of ended.current) wanted.delete(id);
    for (const id of wanted) {
      if (held.current.has(id)) continue;
      let done = false;
      const release = watch(id, ({ build, error }) => {
        if (done || !(error || (build && build.status !== "building"))) return;
        done = true;
        ended.current.add(id);
        queueMicrotask(() => {
          held.current.get(id)?.();
          held.current.delete(id);
          settled.current();
        });
      });
      if (!done) held.current.set(id, release);
      else release();
    }
  }, [key]);

  useEffect(
    () => () => {
      for (const release of held.current.values()) release();
      held.current.clear();
    },
    [],
  );

  /** Holo sees the model through this tab: warn before it closes, and keep the screen awake while it shows. */
  useEffect(() => {
    if (!running.length) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    let lock: WakeLockSentinel | null = null;
    let stopped = false;
    const awake = () => {
      if (stopped || document.visibilityState !== "visible" || (lock && !lock.released)) return;
      navigator.wakeLock?.request("screen").then(
        (held) => (stopped ? void held.release() : (lock = held)),
        () => {},
      );
    };
    awake();
    document.addEventListener("visibilitychange", awake);
    window.addEventListener("beforeunload", warn);
    return () => {
      stopped = true;
      void lock?.release();
      document.removeEventListener("visibilitychange", awake);
      window.removeEventListener("beforeunload", warn);
    };
  }, [running.length > 0]);
}
