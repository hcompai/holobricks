import { mine, Tile } from "./LibraryPage";
import type { BuildSummary } from "./model";

const SHOWN = 12;

interface Props {
  builds: BuildSummary[];
  me: string;
  onOpen: (build: BuildSummary) => void;
  onLibrary: () => void;
}

/** Under the home composer: the user's builds, running ones first, then the gallery's showcases. */
export function HomeShelves({ builds, me, onOpen, onLibrary }: Props) {
  const yours = mine(builds, me)
    .sort((a, b) => Number(b.status === "building") - Number(a.status === "building"))
    .slice(0, SHOWN);
  const showcases = builds.filter((b) => b.source === "showcase").slice(0, SHOWN);
  const shelf = (title: string, shown: BuildSummary[]) =>
    shown.length > 0 && (
      <section className="home-shelf" aria-label={title}>
        <h2>
          {title}
          <button className="quiet" onClick={onLibrary}>
            See all
          </button>
        </h2>
        <div className="home-row">
          {shown.map((b) => (
            <Tile key={`${b.source}:${b.id}`} build={b} onOpen={() => onOpen(b)} />
          ))}
        </div>
      </section>
    );
  return (
    <>
      {shelf("Your builds", yours)}
      {shelf("From the gallery", showcases)}
    </>
  );
}
