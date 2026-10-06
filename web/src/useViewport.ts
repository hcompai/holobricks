import { useLayoutEffect, useState } from "react";

/** Mobile keyboards resize the visible viewport without resizing the page layout. */
export function useViewport(active: boolean) {
  const [size, setSize] = useState<{ height: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!active) return;
    const viewport = window.visualViewport;
    const fit = () => {
      // Leave browser pinch zoom alone; only follow keyboard and browser chrome changes.
      if (viewport && viewport.scale !== 1) return;
      setSize({ height: viewport?.height ?? window.innerHeight, top: viewport?.offsetTop ?? 0 });
    };
    fit();
    viewport?.addEventListener("resize", fit);
    viewport?.addEventListener("scroll", fit);
    window.addEventListener("resize", fit);
    return () => {
      viewport?.removeEventListener("resize", fit);
      viewport?.removeEventListener("scroll", fit);
      window.removeEventListener("resize", fit);
    };
  }, [active]);
  return active ? size : null;
}
