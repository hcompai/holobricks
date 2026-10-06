import { type CSSProperties, type PointerEvent, useEffect, useRef, useState } from "react";

export type Detent = "peek" | "half" | "full";

const HANDLE = 22;
/** A release faster than this, in pixels per millisecond, goes on to the next detent. */
const FLICK = 0.35;
/** Movement under this many pixels is a tap. */
const TAP = 6;
const HEIGHTS: Record<Detent, (peek: number) => string> = {
  peek: (peek) => `calc(${peek}px + env(safe-area-inset-bottom))`,
  half: () => "52dvh",
  full: () => "calc(100dvh - var(--bar) - 8px)",
};

/** A phone's bottom sheet: dragged or tapped on its handle between a peek that shows `dock`, half and full height. */
export function useSheet(dock: HTMLElement | null) {
  const [detent, setDetent] = useState<Detent>("peek");
  const [peek, setPeek] = useState(88);
  const [drag, setDrag] = useState<number | null>(null);
  const start = useRef<{ y: number; height: number; lastY: number; lastTime: number; velocity: number } | null>(null);

  useEffect(() => {
    if (!dock) return;
    const fit = () => setPeek(HANDLE + dock.offsetHeight);
    const observer = new ResizeObserver(fit);
    observer.observe(dock);
    fit();
    return () => observer.disconnect();
  }, [dock]);

  const end = (e: PointerEvent<HTMLElement>) => {
    const from = start.current;
    start.current = null;
    setDrag(null);
    if (!from) return;
    const moved = from.y - e.clientY;
    if (Math.abs(moved) < TAP) {
      setDetent((d) => (d === "peek" ? "half" : d === "half" ? "full" : "half"));
      return;
    }
    const height = from.height + moved;
    const stops: [Detent, number][] = [
      ["peek", peek],
      ["half", innerHeight * 0.52],
      ["full", innerHeight - 64],
    ];
    const nearest = stops.reduce((a, b) => (Math.abs(b[1] - height) < Math.abs(a[1] - height) ? b : a));
    const up = stops.find(([, h]) => h > height) ?? stops[stops.length - 1];
    const down = [...stops].reverse().find(([, h]) => h < height) ?? stops[0];
    setDetent((from.velocity > FLICK ? up : from.velocity < -FLICK ? down : nearest)[0]);
  };

  const handle = {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if ((e.target as Element).closest("button, input, textarea, a")) return;
      const sheet = e.currentTarget.closest<HTMLElement>(".sheet");
      if (!sheet) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      const height = sheet.getBoundingClientRect().height;
      start.current = { y: e.clientY, height, lastY: e.clientY, lastTime: e.timeStamp, velocity: 0 };
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const from = start.current;
      if (!from) return;
      if (e.timeStamp > from.lastTime) from.velocity = (from.lastY - e.clientY) / (e.timeStamp - from.lastTime);
      from.lastY = e.clientY;
      from.lastTime = e.timeStamp;
      if (Math.abs(from.y - e.clientY) < TAP) return;
      setDrag(Math.max(peek, Math.min(innerHeight - 64, from.height + from.y - e.clientY)));
    },
    onPointerUp: end,
    onPointerCancel: end,
  };

  const style: CSSProperties =
    drag === null ? { height: HEIGHTS[detent](peek) } : { height: `${drag}px`, transition: "none" };
  return { detent, setDetent, peek, style, handle };
}
