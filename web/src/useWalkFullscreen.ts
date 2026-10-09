import { useEffect, useRef, useState } from "react";

const touch = window.matchMedia("(pointer: coarse)");

/** Expand just the walking canvas, using browser fullscreen when available; touch screens expand on entering walk. */
export function useWalkFullscreen(walking: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const active = useRef(walking);
  active.current = walking;
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const viewer = ref.current;
    const changed = () => setFullscreen(document.fullscreenElement === viewer);
    document.addEventListener("fullscreenchange", changed);
    return () => {
      document.removeEventListener("fullscreenchange", changed);
      if (viewer && document.fullscreenElement === viewer) void document.exitFullscreen().catch(() => {});
    };
  }, []);

  const enter = async () => {
    const viewer = ref.current;
    if (!viewer || !active.current) return;
    setFullscreen(true);
    // Embedded browsers can still expand the canvas to fill their viewport.
    if (!document.fullscreenEnabled || !viewer.requestFullscreen) return;
    await viewer.requestFullscreen().catch(() => {});
    if (document.fullscreenElement !== viewer) return;
    // Walking may have ended while the browser was entering fullscreen.
    if (!active.current) return void (await document.exitFullscreen().catch(() => {}));
    if (touch.matches) {
      const orientation = screen.orientation as ScreenOrientation & { lock?: (to: string) => Promise<void> };
      await orientation.lock?.("landscape").catch(() => {});
    }
  };

  useEffect(() => {
    if (walking) {
      if (touch.matches) void enter();
      return;
    }
    setFullscreen(false);
    if (ref.current && document.fullscreenElement === ref.current) void document.exitFullscreen().catch(() => {});
  }, [walking]);

  const toggle = async () => {
    const viewer = ref.current;
    if (!viewer || !walking) return;
    if (!fullscreen) return enter();
    setFullscreen(false);
    if (document.fullscreenElement === viewer) await document.exitFullscreen().catch(() => {});
  };

  return { ref, fullscreen, toggle };
}
