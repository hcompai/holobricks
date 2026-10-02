import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { usePalette } from "./palette";
import type { Reference, StudyPart } from "./session";
import type { BuildSubject } from "./buildSubject";

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
    <div className={`thinking-references ${compact ? "thinking-references-compact" : ""}`}>
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

const EXAMPLES: StudyPart[] = [
  { id: "3001", title: "Brick 2 x 4" },
  { id: "3020", title: "Plate 2 x 4" },
  { id: "3068b", title: "Tile 2 x 2" },
  { id: "3039", title: "Slope 45 2 x 2" },
  { id: "3659", title: "Arch 1 x 4" },
  { id: "3942c", title: "Cone 2 x 2" },
];

/** Shape silhouettes accompany real part names and LDraw colors, without claiming catalog availability. */
function PartShape({ title }: { title: string }) {
  const flat = /plate|tile/i.test(title);
  const tile = /tile/i.test(title);
  return (
    <svg viewBox="0 0 96 80" fill="currentColor" aria-hidden="true">
      <g className="thinking-part-turn">
        {/cone|round/i.test(title) ? (
          <path d="M29 52 39 23H57L67 52Q48 65 29 52Z" />
        ) : /arch/i.test(title) ? (
          <path d="M18 24H78V58H63V46Q48 27 33 46V58H18Z" />
        ) : /slope/i.test(title) ? (
          <path d="M18 55 40 22H77V55Z" />
        ) : (
          <path d={flat ? "M18 37 47 25 78 37V48L48 61 18 48Z" : "M18 29 47 17 78 29V55L48 68 18 55Z"} />
        )}
        <path d="M48 39 78 27V55L48 68Z" fill="black" opacity=".12" />
        {!tile &&
          !/slope|cone|arch|round/i.test(title) &&
          [0, 1, 2, 3].map((i) => (
            <ellipse
              key={i}
              cx={36 + (i % 2) * 20}
              cy={(flat ? 31 : 23) + Math.floor(i / 2) * 9}
              rx="7"
              ry="4"
              stroke="white"
              strokeOpacity=".35"
            />
          ))}
      </g>
    </svg>
  );
}

export function MaterialStudy({
  subject,
  request,
  parts = [],
}: {
  subject: BuildSubject;
  request: string;
  parts?: StudyPart[];
}) {
  const palette = usePalette();
  const [selected, setSelected] = useState<string | null>(null);
  const names = parts.length
    ? parts.slice(0, 6)
    : subject.kind === "tree"
      ? [...EXAMPLES.slice(0, 4), { id: "2417", title: "Plant Leaves 6 x 5" }, { id: "3005", title: "Brick 1 x 1" }]
      : EXAMPLES;
  const colors = /red|rocket|lighthouse/i.test(request)
    ? [4, 15, 1, 0, 14, 4]
    : /forest|tree|garden/i.test(request)
      ? [2, 70, 71, 28, 2, 14]
      : [71, 72, 19, 70, 15, 0];
  const current = names.some((p) => p.id === selected) ? selected : names[0]?.id;
  return (
    <div className="thinking-material-study">
      <div className="thinking-materials">
        {names.map((part, index) => (
          <button
            key={part.id}
            className="thinking-material"
            style={{ "--order": index } as CSSProperties}
            aria-pressed={part.id === current}
            onClick={() => setSelected(part.id)}
            title={`Part ${part.id}`}
          >
            <span
              className="thinking-part"
              style={{ color: palette.find((c) => c.code === colors[index])?.hex ?? "#8888a6" }}
            >
              <PartShape title={part.title} />
            </span>
            <span>{part.title}</span>
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
