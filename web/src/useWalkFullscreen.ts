import { useEffect, useRef, useState } from "react";

/** Expand just the walking canvas, using browser fullscreen when available. */
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

  useEffect(() => {
    if (walking) return;
    setFullscreen(false);
    if (ref.current && document.fullscreenElement === ref.current) void document.exitFullscreen().catch(() => {});
  }, [walking]);

  const toggle = async () => {
    const viewer = ref.current;
    if (!viewer || !walking) return;
    if (fullscreen) {
      setFullscreen(false);
      if (document.fullscreenElement === viewer) await document.exitFullscreen().catch(() => {});
      return;
    }
    setFullscreen(true);
    // Embedded browsers can still expand the canvas to fill their viewport.
    if (!document.fullscreenEnabled || !viewer.requestFullscreen) return;
    await viewer.requestFullscreen().catch(() => {});
    // Walking may have ended while the browser was entering fullscreen.
    if (!active.current && document.fullscreenElement === viewer) await document.exitFullscreen().catch(() => {});
  };

  return { ref, fullscreen, toggle };
}
