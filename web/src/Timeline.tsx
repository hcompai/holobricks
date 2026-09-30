import { PauseIcon, PlayIcon, SkipBackIcon, SkipForwardIcon } from "@phosphor-icons/react";
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
  /** Whether Space plays and pauses; walking takes Space to jump and fly. */
  spaceKey: boolean;
}

export function Timeline(props: Props) {
  const { build, loading, step, playing, speed, onStep, onPlay, onSpeed, spaceKey } = props;
  const steps = build?.steps ?? [];
  const last = steps.length - 1;
  const current = Math.min(step, last);
  const building = build?.status === "building";
  const failed = build?.status === "error" && current === last;
  const finished = !!build && !building && steps.length > 0 && current === last;
  const visiblePieces = build?.pieces.filter((p) => p.step <= current).length ?? 0;
  const label = loading
    ? "Loading…"
    : !steps.length
      ? "No steps yet"
      : failed
        ? "Stopped with an error"
        : finished
          ? "Finished"
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
      <button
        className="quiet icon-button skip"
        disabled={!steps.length}
        onClick={() => onStep(0)}
        title="First step"
        aria-label="First step"
      >
        <SkipBackIcon size={16} weight="fill" />
      </button>
      <button className="play" disabled={steps.length < 2} onClick={toggle} title={playing ? "Pause" : "Play"}>
        {playing ? <PauseIcon size={16} weight="fill" /> : <PlayIcon size={16} weight="fill" />}
      </button>
      <button
        className="quiet icon-button skip"
        disabled={current >= last}
        onClick={() => onStep(last)}
        title="Last step"
        aria-label="Last step"
      >
        <SkipForwardIcon size={16} weight="fill" />
      </button>
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
      <span className="status" aria-live="polite">
        {building ? "Building…" : ""}
      </span>
      <button
        className="quiet speed"
        onClick={() => onSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])}
        title="Playback speed"
        aria-label={`Playback speed: ${speed}×`}
      >
        {speed}×
      </button>
    </div>
  );
}
