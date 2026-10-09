import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import type { Reference } from "./session";

/** A contact sheet of photos actually supplied by the user or opened by Holo. */
export function ReferenceBoard({
  references,
  compact = false,
  fallback = null,
}: {
  references: Reference[];
  compact?: boolean;
  fallback?: ReactNode;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(false);
  const visible = references.filter((reference) => !failed.includes(reference.src));
  const latest = visible.at(-1);
  useEffect(() => setSelected(latest?.id ?? null), [latest?.id]);
  const current = visible.find((reference) => reference.id === selected) ?? latest;
  if (!current) return fallback;
  return (
    <div className={`thinking-references ph-private ${compact ? "thinking-references-compact" : ""}`}>
      {(!compact || expanded) && (
        <figure className="thinking-reference" key={current.src}>
          <div className="thinking-reference-image">
            <img
              src={current.src}
              alt={current.caption}
              referrerPolicy="no-referrer"
              onError={() => setFailed((old) => [...old, current.src])}
            />
            <span className="thinking-photo-corners" aria-hidden="true" />
          </div>
          <figcaption>
            {current.kind === "showcase" && <span>Showcase</span>}
            <strong>{current.caption}</strong>
          </figcaption>
        </figure>
      )}
      <div className="thinking-contact-sheet" aria-label="Reference photos">
        {visible.map((reference, index) => (
          <button
            key={reference.id}
            className="thinking-reference-thumb"
            style={{ "--order": index } as CSSProperties}
            aria-label={`View ${reference.caption}`}
            aria-pressed={reference.id === current.id}
            aria-expanded={compact ? expanded && reference.id === current.id : undefined}
            onClick={() => {
              setSelected(reference.id);
              if (compact) setExpanded(!expanded || reference.id !== current.id);
            }}
          >
            <img
              src={reference.src}
              alt=""
              referrerPolicy="no-referrer"
              onError={() => setFailed((old) => [...old, reference.src])}
            />
            <span>{String(index + 1).padStart(2, "0")}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function NameStudy({ title }: { title?: string | null }) {
  return (
    <div className="thinking-name-study" key={title}>
      <div className="thinking-name-title" aria-label={title ?? "A name is on its way"}>
        {title ? (
          title.split("").map((letter, index) => (
            <span key={index} aria-hidden="true" style={{ "--order": index } as CSSProperties}>
              {letter}
            </span>
          ))
        ) : (
          <span className="thinking-name-pending" aria-hidden="true">
            ···
          </span>
        )}
      </div>
      <svg viewBox="0 0 240 20" fill="none" aria-hidden="true">
        <path className="thinking-name-line" d="M12 13Q92 3 227 10M33 17Q98 8 202 15" />
      </svg>
    </div>
  );
}
