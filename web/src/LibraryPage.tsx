import type { ReactNode } from "react";
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
  /** The signed-in user's id: the public builds they own count as theirs too, such as imported ones. */
  me: string | null;
  /** What sits beside the Mine heading, such as the import button. */
  mineActions?: ReactNode;
}

function meta(b: BuildSummary, published: Set<string>): string {
  return [
    b.source === "showcase" ? "Showcase" : b.author ? `by ${b.author}` : null,
    b.source === "session" && published.has(b.id) ? "public" : null,
    b.id.startsWith("import-") ? "imported" : null,
    b.pieces === null ? null : `${b.pieces.toLocaleString()} pieces`,
    b.status === "building" ? "building…" : b.status === "error" ? "stopped" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The library over the viewer: everyone's public builds with the showcases, then the user's own. */
export function LibraryPage({ builds, failed, active, onRetry, onOpen, me, mineActions }: Props) {
  const sessions = builds?.filter((b) => b.source === "session") ?? [];
  const everyone = builds?.filter((b) => b.source !== "session") ?? [];
  const ids = new Set(sessions.map((b) => b.id));
  // Builds with no session of theirs, like imported ones, are the user's through the library only.
  const owned = everyone.filter((b) => b.source === "public" && me && b.owner === me && !ids.has(b.id));
  const mine = [...sessions, ...owned].sort((a, b) => b.created - a.created);
  const published = new Set(everyone.filter((b) => b.source === "public").map((b) => b.id));

  const section = (title: string, shown: BuildSummary[], empty: string, actions?: ReactNode) => (
    <section className="library-section" aria-label={title}>
      <h2>
        {title}
        {builds && <span className="count">{shown.length}</span>}
        {actions}
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
          {section("Mine", mine, "No builds yet. Describe one in the chat, or import one.", mineActions)}
        </>
      )}
    </div>
  );
}
