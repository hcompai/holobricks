import { FilmStripIcon, PauseIcon, PlayIcon, SkipBackIcon, SkipForwardIcon } from "@phosphor-icons/react";
import { type CSSProperties, useEffect } from "react";
import type { Build } from "./model";

const SPEEDS = [0.5, 1, 2, 4];

interface Props {
  build: Build | null;
  loading: boolean;
  step: number;
  playing: boolean;
  speed: number;
  onStep: (step: number) => void;
  onPlay: (playing: boolean) => void;
  onSpeed: (speed: number) => void;
  onReplay: () => void;
  /** Whether Space plays and pauses; walking takes Space to rise. */
  spaceKey: boolean;
}

export function Timeline(props: Props) {
  const { build, loading, step, playing, speed, onStep, onPlay, onSpeed, onReplay, spaceKey } = props;
  const steps = build?.steps ?? [];
  const last = steps.length - 1;
  const current = Math.min(step, last);
  const failed = build?.status === "error" && current === last;
  const finished = !!build && build.status !== "building" && steps.length > 0 && current === last;
  const visiblePieces = build?.pieces.filter((p) => p.step <= current).length ?? 0;
  const label = loading
    ? "Loading…"
    : !steps.length
      ? "No steps yet"
      : failed
        ? "Stopped with an error"
        : finished
          ? "Finished model"
          : `Step ${current + 1} of ${steps.length}: ${steps[current]?.title ?? ""}`;

  const toggle = () => {
    if (!playing && current >= last) onStep(0);
    onPlay(!playing);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!spaceKey || document.querySelector("dialog[open]")) return;
      if (e.key !== " " || e.repeat || e.ctrlKey || e.metaKey || e.altKey || steps.length < 2) return;
      if (e.target instanceof Element && e.target.closest("input, textarea, select, button, a, [contenteditable]"))
        return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="timeline">
      <button className="icon" disabled={!steps.length} onClick={() => onStep(0)} title="First step">
        <SkipBackIcon size={16} weight="fill" />
      </button>
      <button className="play" disabled={steps.length < 2} onClick={toggle} title={playing ? "Pause" : "Play"}>
        {playing ? <PauseIcon size={14} weight="fill" /> : <PlayIcon size={14} weight="fill" />}
      </button>
      <button className="icon" disabled={current >= last} onClick={() => onStep(last)} title="Last step">
        <SkipForwardIcon size={16} weight="fill" />
      </button>
      <div className="speeds">
        {SPEEDS.map((s) => (
          <button key={s} className={s === speed ? "active" : ""} aria-pressed={s === speed} onClick={() => onSpeed(s)}>
            {s}×
          </button>
        ))}
      </div>
      <div className="scrub">
        <div className="scrub-label">
          <b>{label}</b>
          {!loading && (
            <span>
              {visiblePieces} pieces · {current + 1}/{steps.length} steps
            </span>
          )}
        </div>
        <input
          type="range"
          aria-label="Step"
          min={0}
          max={Math.max(last, 0)}
          value={Math.max(current, 0)}
          disabled={!steps.length}
          onChange={(e) => onStep(Number(e.target.value))}
          style={{ "--fill": `${last > 0 ? (current / last) * 100 : 0}%` } as CSSProperties}
        />
      </div>
      <span className={`status ${build?.status ?? "idle"}`} aria-live="polite">
        {build?.status === "building" ? "Building…" : failed ? "Failed" : finished ? "Finished" : ""}
      </span>
      <button className="timeline-export" onClick={onReplay} disabled={loading || !build?.pieces.length}>
        <FilmStripIcon size={16} /> Export film
      </button>
    </div>
  );
}
