import {
  CubeIcon,
  ImagesIcon,
  LightbulbIcon,
  PauseIcon,
  PlayIcon,
  ScanIcon,
  StackIcon,
  TagIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { PHASES, THINKING_PHASES } from "./activity";
import type { Activity, Reference } from "./session";
import { MaterialStudy, NameStudy, ReferenceBoard } from "./ThinkingStudy";
import { buildSubject, type BuildSubject } from "./buildSubject";

const STAGES = {
  [PHASES.idea]: {
    art: "idea",
    icon: LightbulbIcon,
  },
  [PHASES.setup]: {
    art: "setup",
    icon: CubeIcon,
  },
  [PHASES.photos]: {
    art: "photos",
    icon: ImagesIcon,
  },
  [PHASES.naming]: {
    art: "naming",
    icon: TagIcon,
  },
  [PHASES.bricks]: {
    art: "blocks",
    icon: StackIcon,
  },
  [PHASES.checking]: {
    art: "checking",
    icon: ScanIcon,
  },
} as const;

const stage = (label: string) => STAGES[label as keyof typeof STAGES] ?? STAGES[PHASES.idea];

/** A small companion to the chat's real activity label, including once a model is visible. */
export function ThinkingIcon({ label }: { label: string }) {
  const Icon = stage(label).icon;
  return (
    <span className="thinking-icon" aria-hidden="true">
      <Icon size={18} weight="duotone" />
    </span>
  );
}

function Sketch({ subject }: { subject: BuildSubject }) {
  return (
    <svg
      className="thinking-art thinking-art-idea"
      data-subject={subject.kind}
      style={{ color: subject.color }}
      viewBox="0 0 320 210"
      fill="none"
      aria-hidden="true"
    >
      <g className="thinking-plan" transform="translate(65 35)">
        <rect className="thinking-paper" width="190" height="145" rx="10" />
        <path className="thinking-grid" d="M0 36H190M0 72H190M0 108H190M38 0V145M76 0V145M114 0V145M152 0V145" />
        <path className="thinking-outline" d={subject.outline} />
        <path className="thinking-measure" d="M40 130H150M40 126V134M150 126V134" />
      </g>
      <g className="thinking-spark">
        <path d="m258 25 4 12 12 4-12 4-4 12-4-12-12-4 12-4Z" fill="currentColor" />
      </g>
    </svg>
  );
}

function Searching({ action }: { action?: string }) {
  return (
    <div className="thinking-search-study">
      <ImagesIcon size={38} weight="duotone" />
      <div className="thinking-search-orbit" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      {action?.startsWith("Searching") && <p>{action.replace(/^Searching /, "")}</p>}
    </div>
  );
}

/** The empty viewer explains the current observed phase; animations loop without inventing progress. */
export function Thinking({
  activity,
  name = "",
  request = "",
  photos = [],
}: {
  activity: Activity;
  name?: string;
  request?: string;
  photos?: string[];
}) {
  const [paused, setPaused] = useState(false);
  const current = stage(activity.label);
  const subject = buildSubject(name, request);
  const action = activity.work?.steps.at(-1)?.actions.at(-1);
  const references: Reference[] = [
    ...photos.slice(0, 4).map((src, index) => ({
      id: `attached-${index}`,
      src,
      caption: `Your photo ${index + 1}`,
      kind: "attachment" as const,
    })),
    ...(activity.references ?? []),
  ];
  if (!THINKING_PHASES.includes(activity.label)) return null;
  return (
    <div className={`thinking ${paused ? "thinking-paused" : ""}`}>
      <div className={`thinking-card thinking-stage-${current.art}`} data-subject={subject.kind}>
        <div className="thinking-heading">
          <span role="status" aria-live="polite" aria-atomic="true">
            <ThinkingIcon label={activity.label} /> {activity.label}
          </span>
          <button
            className="thinking-pause"
            onClick={() => setPaused(!paused)}
            aria-label={paused ? "Resume animation" : "Pause animation"}
            title={paused ? "Resume animation" : "Pause animation"}
          >
            {paused ? <PlayIcon size={14} weight="fill" /> : <PauseIcon size={14} weight="fill" />}
          </button>
        </div>
        {current.art === "idea" && (
          <>
            <Sketch subject={subject} />
            {references.length > 0 && <ReferenceBoard references={references} compact />}
          </>
        )}
        {current.art === "setup" && <MaterialStudy subject={subject} request={request} parts={activity.parts} />}
        {current.art === "photos" &&
          (references.length ? (
            <ReferenceBoard references={references} fallback={<Searching action={action} />} />
          ) : (
            <Searching action={action} />
          ))}
        {current.art === "naming" && (
          <>
            <NameStudy title={activity.title} />
            {references.length > 0 && <ReferenceBoard references={references} compact />}
          </>
        )}
      </div>
    </div>
  );
}
