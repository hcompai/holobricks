import { PauseIcon, PlayIcon, SkipBackIcon, SkipForwardIcon } from "@phosphor-icons/react";
import type { CSSProperties } from "react";
import type { Build } from "./api";

const SPEEDS = [0.5, 1, 2, 4];

interface Props {
  build: Build | null;
  step: number;
  playing: boolean;
  speed: number;
  onStep: (step: number) => void;
  onPlay: (playing: boolean) => void;
  onSpeed: (speed: number) => void;
}

export function Timeline({ build, step, playing, speed, onStep, onPlay, onSpeed }: Props) {
  const steps = build?.steps ?? [];
  const last = steps.length - 1;
  const current = Math.min(step, last);
  const failed = build?.status === "error" && current === last;
  const finished = build?.status !== "building" && current === last;
  const visiblePieces = build?.pieces.filter((p) => p.step <= current).length ?? 0;
  const label = !steps.length
    ? "No steps yet"
    : failed
      ? "Stopped with an error"
      : finished
        ? "Finished model"
        : `Step ${current + 1} of ${steps.length}: ${steps[current]?.title ?? ""}`;

  return (
    <div className="timeline">
      <button className="icon" disabled={!steps.length} onClick={() => onStep(0)} title="First step">
        <SkipBackIcon size={16} weight="fill" />
      </button>
      <button
        className="play"
        disabled={steps.length < 2}
        onClick={() => {
          if (!playing && current >= last) onStep(0);
          onPlay(!playing);
        }}
        title={playing ? "Pause" : "Play"}
      >
        {playing ? <PauseIcon size={14} weight="fill" /> : <PlayIcon size={14} weight="fill" />}
      </button>
      <button className="icon" disabled={current >= last} onClick={() => onStep(last)} title="Last step">
        <SkipForwardIcon size={16} weight="fill" />
      </button>
      <div className="speeds">
        {SPEEDS.map((s) => (
          <button key={s} className={s === speed ? "active" : ""} onClick={() => onSpeed(s)}>
            {s}×
          </button>
        ))}
      </div>
      <div className="scrub">
        <div className="scrub-label">
          <b>{label}</b>
          <span>
            {visiblePieces} pieces · {current + 1}/{steps.length} steps
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={Math.max(last, 0)}
          value={Math.max(current, 0)}
          disabled={!steps.length}
          onChange={(e) => onStep(Number(e.target.value))}
          style={{ "--fill": `${last > 0 ? (current / last) * 100 : 0}%` } as CSSProperties}
        />
      </div>
      <span className={`status ${build?.status ?? "idle"}`}>
        {build?.status === "building" ? "Building…" : failed ? "Failed" : finished ? "Finished" : ""}
      </span>
    </div>
  );
}
