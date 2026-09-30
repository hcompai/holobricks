import type { BuildSummary } from "./model";
import type { BuildRef } from "./useBuild";

const PLACEHOLDERS = 4;

interface Props {
  builds: BuildSummary[] | null;
  /** Whether the last fetch of the library failed. */
  failed: boolean;
  active: BuildRef | null;
  onRetry: () => void;
  onOpen: (build: BuildSummary) => void;
}

function meta(b: BuildSummary, published: Set<string>): string {
  return [
    b.source === "showcase" ? "Showcase" : b.author ? `by ${b.author}` : null,
    b.source === "session" && published.has(b.id) ? "public" : null,
    b.pieces === null ? null : `${b.pieces.toLocaleString()} pieces`,
    b.status === "building" ? "building…" : b.status === "error" ? "stopped" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The library over the viewer: everyone's public builds with the showcases, then the user's own. */
export function LibraryPage({ builds, failed, active, onRetry, onOpen }: Props) {
  const mine = builds?.filter((b) => b.source === "session") ?? [];
  const everyone = builds?.filter((b) => b.source !== "session") ?? [];
  const published = new Set(everyone.filter((b) => b.source === "public").map((b) => b.id));

  const section = (title: string, shown: BuildSummary[], empty: string) => (
    <section className="library-section" aria-label={title}>
      <h2>
        {title}
        {builds && <span className="count">{shown.length}</span>}
      </h2>
      {builds === null ? (
        <div className="library-grid" aria-busy="true">
          {Array.from({ length: PLACEHOLDERS }, (_, i) => (
            <div key={i} className="tile skeleton">
              <div className="tile-thumb" />
              <div className="tile-body">
                <div className="bar wide" />
                <div className="bar" />
              </div>
            </div>
          ))}
        </div>
      ) : !shown.length ? (
        <p className="library-empty">{empty}</p>
      ) : (
        <div className="library-grid">
          {shown.map((b) => (
            <button
              key={`${b.source}:${b.id}`}
              className={b.id === active?.id && b.source === active.source ? "tile active" : "tile"}
              title={b.prompt}
              onClick={() => onOpen(b)}
            >
              {b.thumbnail != null ? (
                <img className="tile-thumb" src={b.thumbnail} alt="" loading="lazy" decoding="async" />
              ) : (
                <div className="tile-thumb">{b.name.slice(0, 1).toUpperCase()}</div>
              )}
              <div className="tile-body">
                <b>{b.name}</b>
                <span className="muted small">{meta(b, published)}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );

  return (
    <div className="library-page" role="region" aria-label="Library">
      {builds === null && failed ? (
        <div className="load-failed" role="alert">
          <span>Couldn't load the library.</span>
          <button onClick={onRetry}>Retry</button>
        </div>
      ) : (
        <>
          {section("Public", everyone, "Nothing public yet. Publish one of your builds to share it here.")}
          {section("Mine", mine, "No builds yet. Describe one in the chat.")}
        </>
      )}
    </div>
  );
}
