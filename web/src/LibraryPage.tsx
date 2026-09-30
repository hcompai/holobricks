import { SignInButton } from "./AccountMenu";
import type { BuildSummary } from "./model";
import type { BuildRef } from "./useBuild";

const PLACEHOLDERS = 8;

/** The library's two shelves: the signed-in user's builds, and everyone's with the showcases. */
export type Shelf = "mine" | "public";

interface Props {
  builds: BuildSummary[] | null;
  /** Whether the last fetch of the library failed. */
  failed: boolean;
  shelf: Shelf;
  signedIn: boolean;
  active: BuildRef | null;
  onShelf: (shelf: Shelf) => void;
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

export function LibraryPage({ builds, failed, shelf, signedIn, active, onShelf, onRetry, onOpen }: Props) {
  const mine = builds?.filter((b) => b.source === "session") ?? [];
  const everyone = builds?.filter((b) => b.source !== "session") ?? [];
  const published = new Set(everyone.filter((b) => b.source === "public").map((b) => b.id));
  const shown = shelf === "mine" ? mine : everyone;
  const tab = (value: Shelf, label: string, count: number) => (
    <button
      role="tab"
      aria-selected={shelf === value}
      className={shelf === value ? "active" : ""}
      onClick={() => onShelf(value)}
    >
      {label}
      {builds && <span className="count">{count}</span>}
    </button>
  );

  return (
    <section className="library-page" aria-label="Library">
      <div className="library-bar">
        <div className="tabs" role="tablist">
          {tab("mine", "Mine", mine.length)}
          {tab("public", "Public", everyone.length)}
        </div>
      </div>
      {builds === null && failed ? (
        <div className="load-failed" role="alert">
          <span>Couldn't load the library.</span>
          <button onClick={onRetry}>Retry</button>
        </div>
      ) : builds === null ? (
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
      ) : shelf === "mine" && !signedIn ? (
        <div className="library-empty">
          <span>Sign in with your H account to build with Holo; your builds show up here.</span>
          <SignInButton />
        </div>
      ) : !shown.length ? (
        <div className="library-empty">No builds yet. Describe one in the chat.</div>
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
}
