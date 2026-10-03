import { CubeIcon, ImagesIcon, LightbulbIcon, ScanIcon, StackIcon, TagIcon } from "@phosphor-icons/react";
import { PHASES } from "./activity";
import { BrickLoader } from "./BrickLoader";
import type { Activity, Reference } from "./session";
import { NameStudy, ReferenceBoard } from "./ThinkingStudy";
import { buildSubject, type BuildSubject } from "./buildSubject";

const STAGES = {
  [PHASES.idea]: {
    art: "idea",
    icon: LightbulbIcon,
  },
  [PHASES.message]: {
    art: "message",
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
  [PHASES.draft]: {
    art: "blocks",
    icon: StackIcon,
  },
  [PHASES.checking]: {
    art: "checking",
    icon: ScanIcon,
  },
} as const;

const stage = (label: string) => STAGES[label as keyof typeof STAGES] ?? { art: "working", icon: StackIcon };

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
  // Every phase needs a visible waiting state until the first model arrives.
  if (!["idea", "photos", "naming"].includes(current.art))
    return (
      <div className={`thinking thinking-stage-${current.art}`}>
        <BrickLoader label={activity.label} />
      </div>
    );
  return (
    <div className={`thinking thinking-stage-${current.art}`}>
      <div className="thinking-card" data-subject={subject.kind}>
        <div className="thinking-heading">
          <span role="status" aria-live="polite" aria-atomic="true">
            <ThinkingIcon label={activity.label} /> {activity.label}
          </span>
        </div>
        {current.art === "idea" && (
          <>
            <Sketch subject={subject} />
            {references.length > 0 && <ReferenceBoard references={references} compact />}
          </>
        )}
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
