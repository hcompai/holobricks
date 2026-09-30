import type { BuildSummary, Source } from "./model";
import type { BuildRef } from "./useBuild";

const PLACEHOLDERS = 6;

const SECTIONS: { source: Source; title: string }[] = [
  { source: "session", title: "Your builds" },
  { source: "public", title: "Community" },
  { source: "showcase", title: "Showcases" },
];

interface Props {
  builds: BuildSummary[] | null;
  /** Whether the last fetch of the library failed. */
  failed: boolean;
  signedIn: boolean;
  onRetry: () => void;
  active: BuildRef | null;
  onOpen: (build: BuildSummary) => void;
}

export function LibraryPanel({ builds, failed, signedIn, onRetry, active, onOpen }: Props) {
  if (builds === null && failed)
    return (
      <div className="load-failed" role="alert">
        <span>Couldn't load the library.</span>
        <button onClick={onRetry}>Retry</button>
      </div>
    );
  if (builds === null)
    return (
      <div className="library" aria-busy="true">
        {Array.from({ length: PLACEHOLDERS }, (_, i) => (
          <div key={i} className="card skeleton">
            <div className="thumb" />
            <div className="card-body">
              <div className="bar wide" />
              <div className="bar" />
            </div>
          </div>
        ))}
      </div>
    );
  const published = new Set(builds.filter((b) => b.source === "public").map((b) => b.id));
  return (
    <div className="library">
      {SECTIONS.map(({ source, title }) => {
        const shown = builds.filter((b) => b.source === source);
        if (!shown.length && !(source === "session" && signedIn)) return null;
        return (
          <section key={source} className="library-section" aria-label={title}>
            <h3>{title}</h3>
            {!shown.length && <div className="empty">No builds yet. Start one from the chat.</div>}
            {shown.map((b) => (
              <button
                key={b.id}
                className={`card ${b.id === active?.id && b.source === active.source ? "active" : ""}`}
                onClick={() => onOpen(b)}
              >
                {b.thumbnail != null ? (
                  <img className="thumb" src={b.thumbnail} alt="" loading="lazy" decoding="async" />
                ) : (
                  <div className="thumb">{b.name.slice(0, 1).toUpperCase()}</div>
                )}
                <div className="card-body">
                  <b>{b.name}</b>
                  <span className="muted">{b.prompt}</span>
                  <span className="muted small">
                    {[
                      b.author ? `by ${b.author}` : null,
                      b.source === "session" && published.has(b.id) ? "public" : null,
                      b.pieces === null ? null : `${b.pieces.toLocaleString()} pieces`,
                      b.status === "building" ? "building…" : b.status === "error" ? "stopped" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
              </button>
            ))}
          </section>
        );
      })}
    </div>
  );
}
