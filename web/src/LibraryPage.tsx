import { type ReactNode, useEffect, useRef } from "react";
import { Brick } from "./BrickLoader";
import type { Shelf } from "./library";
import type { BuildSummary } from "./model";
import { typing } from "./scene";
import type { BuildRef } from "./useBuild";

const PLACEHOLDERS = 4;

interface Props {
  builds: BuildSummary[] | null;
  /** The shelves the last fetch could not load. */
  failed: Shelf[];
  active: BuildRef | null;
  onRetry: () => void;
  onOpen: (build: BuildSummary) => void;
  onClose: () => void;
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
    b.private ? "private" : null,
    b.pieces === null ? null : `${b.pieces.toLocaleString()} pieces`,
    b.status === "building" ? "building…" : b.status === "error" ? "stopped" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The library over the viewer: the user's own builds, then everyone's public builds with the showcases. */
export function LibraryPage({ builds, failed, active, onRetry, onOpen, onClose, me, mineActions }: Props) {
  const page = useRef<HTMLDivElement>(null);
  useEffect(() => page.current?.focus(), []);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !typing(event) && !document.querySelector("dialog[open]")) onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  const sessions = builds?.filter((b) => b.source === "session") ?? [];
  // Private builds are their owner's alone: under Mine, never under Public.
  const everyone = builds?.filter((b) => b.source !== "session" && !b.private) ?? [];
  const privately = builds?.filter((b) => b.private) ?? [];
  const ids = new Set(sessions.map((b) => b.id));
  // Builds with no session of theirs, like imported ones, are the user's through the library only.
  const owned = [...everyone, ...privately].filter(
    (b) => b.source === "public" && me && b.owner === me && !ids.has(b.id),
  );
  const mine = [...sessions, ...owned].sort((a, b) => b.created - a.created);
  const published = new Set(everyone.filter((b) => b.source === "public").map((b) => b.id));

  const section = (title: string, shelf: Shelf, shown: BuildSummary[], empty: string, actions?: ReactNode) => (
    <section className="library-section" aria-label={title}>
      <h2>
        {title}
        {builds && <span className="count">{shown.length}</span>}
        {actions}
      </h2>
      {failed.includes(shelf) && (
        <div className="load-failed" role="alert">
          <span>{shown.length ? "Couldn't refresh these builds." : "Couldn't load these builds."}</span>
          <button onClick={onRetry}>Retry</button>
        </div>
      )}
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
        !failed.includes(shelf) && <p className="library-empty">{empty}</p>
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
              ) : b.status === "building" ? (
                <div className="tile-thumb">
                  <div className="brick-hop">
                    <Brick />
                  </div>
                </div>
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
    <div className="library-page" role="region" aria-label="Library" ref={page} tabIndex={-1}>
      {section("Mine", "mine", mine, "No builds yet. Describe one in the chat, or import one.", mineActions)}
      {section("Public", "public", everyone, "Nothing public yet. Publish one of your builds to share it here.")}
    </div>
  );
}
