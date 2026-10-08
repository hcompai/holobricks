import { HeartIcon } from "@phosphor-icons/react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { Brick } from "./BrickLoader";
import type { Hearts } from "./hearts";
import type { Shelf } from "./library";
import type { BuildSummary } from "./model";
import { type ProjectActions, ProjectMenu } from "./ProjectMenu";

const PUBLIC_ROWS = 10;
const GAP = 16;

interface Props {
  builds: BuildSummary[] | null;
  /** The shelves the last fetch could not load. */
  failed: Shelf[];
  /** The signed-in user's id: the public builds they own count as theirs too, such as imported ones. Signed out, null: no shelf of theirs. */
  me: string | null;
  onRetry: () => void;
  onOpen: (build: BuildSummary) => void;
  /** What sits beside the user's heading, such as the import button. */
  mineActions?: ReactNode;
  /** What the owner can do with one of their builds from its card, or null for none. */
  manage?: (build: BuildSummary, published: boolean) => ProjectActions | null;
  hearts: Hearts;
  onHeart: (id: string) => void;
}

const AGES: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 86400],
  ["month", 30 * 86400],
  ["week", 7 * 86400],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];
const relative = new Intl.RelativeTimeFormat("en");

/** How long ago `seconds` was: "just now", "5 minutes ago", "1 month ago". */
function ago(seconds: number): string {
  const elapsed = Date.now() / 1000 - seconds;
  const unit = AGES.find(([, size]) => elapsed >= size);
  return unit ? relative.format(-Math.floor(elapsed / unit[1]), unit[0]) : "just now";
}

function meta(b: BuildSummary, published = false): string {
  return [
    b.source === "showcase" ? "Showcase" : b.author ? `by ${b.author}` : null,
    published ? "public" : null,
    b.id.startsWith("import-") ? "imported" : null,
    b.private ? "private" : null,
    b.status === "building" ? "building…" : b.status === "error" ? "stopped" : null,
    b.source === "showcase" || !b.created ? null : ago(b.created),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The signed-in user's builds, running ones first, then newest: their sessions, and their library builds with no session, such as imported ones. */
function mine(builds: BuildSummary[], me: string | null): BuildSummary[] {
  const linked = new Set(builds.filter((b) => b.source === "fork").map((b) => b.sessionId));
  const sessions = builds.filter((b) => b.source === "fork" || (b.source === "session" && !linked.has(b.id)));
  const ids = new Set(sessions.map((b) => b.id));
  const owned = builds.filter((b) => b.source === "public" && me && b.owner === me && !ids.has(b.id));
  return [...sessions, ...owned].sort(
    (a, b) => Number(b.status === "building") - Number(a.status === "building") || b.created - a.created,
  );
}

/** A build as a card: its thumbnail, captioned with its name and author, the owner's menu and the hearts in its top corner. */
function Tile({
  build,
  published,
  onOpen,
  actions,
  hearts,
}: {
  build: BuildSummary;
  published: boolean;
  onOpen: () => void;
  actions?: ProjectActions | null;
  hearts?: { count: number; mine: boolean; onToggle: () => void } | null;
}) {
  return (
    <div className={`tile-frame${actions ? " tile-owned" : ""}`}>
      <Card build={build} published={published} onOpen={onOpen} />
      {actions && <ProjectMenu {...actions} />}
      {hearts && <HeartButton {...hearts} />}
    </div>
  );
}

function HeartButton({ count, mine, onToggle }: { count: number; mine: boolean; onToggle: () => void }) {
  return (
    <button
      className="tile-heart"
      aria-pressed={mine}
      aria-label={mine ? "Remove your heart" : "Heart this build"}
      title={mine ? "You heart this build" : "Heart this build"}
      onClick={onToggle}
    >
      <HeartIcon size={15} weight={mine ? "fill" : "bold"} />
      {count > 0 && <span>{count.toLocaleString()}</span>}
    </button>
  );
}

function Card({ build: b, published, onOpen }: { build: BuildSummary; published: boolean; onOpen: () => void }) {
  return (
    <button className="tile" title={b.prompt} onClick={onOpen}>
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
      <div className="tile-caption">
        <b>{b.name}</b>
        <span>{meta(b, published)}</span>
      </div>
    </button>
  );
}

/** How many tiles fit across the shelves, narrower on phones. */
function useColumns() {
  const root = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(4);
  useLayoutEffect(() => {
    const fit = (width: number) => {
      const tile = width < 600 ? 150 : 220;
      setColumns(Math.max(1, Math.floor((width + GAP) / (tile + GAP))));
    };
    fit(root.current!.clientWidth);
    const observer = new ResizeObserver(([entry]) => fit(entry.contentRect.width));
    observer.observe(root.current!);
    return () => observer.disconnect();
  }, []);
  return [root, columns] as const;
}

/** Under the home composer: one row of the user's builds, then the public builds with the showcases, ten rows at a time. */
export function HomeShelves({ builds, failed, me, onRetry, onOpen, mineActions, manage, hearts, onHeart }: Props) {
  const [root, columns] = useColumns();
  const [allMine, setAllMine] = useState(false);
  const [publicRows, setPublicRows] = useState(PUBLIC_ROWS);
  // Private builds are their owner's alone: under the user's builds, never under Public.
  const everyone = builds?.filter((b) => b.source !== "session" && b.source !== "fork" && !b.private) ?? [];
  const published = new Set(everyone.filter((b) => b.source === "public").map((b) => b.id));
  const yours = mine(builds ?? [], me);
  const grid = { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: GAP };

  const section = (
    title: string,
    shelf: Shelf,
    all: BuildSummary[],
    shown: BuildSummary[],
    empty: string,
    actions?: ReactNode,
    more?: ReactNode,
    owned = false,
  ) => (
    <section className="home-shelf" aria-label={title}>
      <h2>
        {title}
        {builds && <span className="count">{all.length}</span>}
        <span className="spacer" />
        {actions}
      </h2>
      {failed.includes(shelf) && (
        <div className="load-failed" role="alert">
          <span>{all.length ? "Couldn't refresh these builds." : "Couldn't load these builds."}</span>
          <button onClick={onRetry}>Retry</button>
        </div>
      )}
      {builds === null ? (
        <div className="home-grid" style={grid} aria-busy="true">
          {Array.from({ length: columns }, (_, i) => (
            <div key={i} className="skeleton">
              <div className="tile-thumb" />
              <div className="tile-caption">
                <div className="bar wide" />
                <div className="bar" />
              </div>
            </div>
          ))}
        </div>
      ) : !all.length ? (
        !failed.includes(shelf) && <p className="home-empty">{empty}</p>
      ) : (
        <div className="home-grid" style={grid}>
          {shown.map((b) => {
            const isPublic = (b.source === "session" || b.source === "fork") && published.has(b.id);
            const hearted = b.source === "public" && !b.private;
            return (
              <Tile
                key={`${b.source}:${b.id}`}
                build={b}
                published={isPublic}
                onOpen={() => onOpen(b)}
                actions={owned ? manage?.(b, isPublic || (b.source === "public" && !b.private)) : null}
                hearts={
                  hearted
                    ? { count: hearts.counts[b.id] ?? 0, mine: hearts.mine.has(b.id), onToggle: () => onHeart(b.id) }
                    : null
                }
              />
            );
          })}
        </div>
      )}
      {more}
    </section>
  );

  const publicShown = everyone.slice(0, columns * publicRows);
  return (
    <div className="home-shelves" ref={root}>
      {me &&
        section(
          "Your builds",
          "mine",
          yours,
          allMine ? yours : yours.slice(0, columns),
          "Your builds will show up here once you describe one above or import a model.",
          <>
            {yours.length > columns && (
              <button className="quiet" onClick={() => setAllMine(!allMine)}>
                {allMine ? "Show less" : "Show all"}
              </button>
            )}
            {mineActions}
          </>,
          undefined,
          true,
        )}
      {section(
        "Public builds",
        "public",
        everyone,
        publicShown,
        "Published builds will show up here, and yours can be the first.",
        undefined,
        publicShown.length < everyone.length && (
          <button className="home-more" onClick={() => setPublicRows(publicRows + PUBLIC_ROWS)}>
            Show more builds
          </button>
        ),
      )}
    </div>
  );
}
