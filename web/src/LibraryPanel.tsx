import { api, type BuildSummary } from "./api";

interface Props {
  builds: BuildSummary[];
  activeId: string | null;
  onOpen: (id: string) => void;
}

export function LibraryPanel({ builds, activeId, onOpen }: Props) {
  if (!builds.length) return <div className="empty">No builds yet. Start one from the chat.</div>;
  return (
    <div className="library">
      {builds.map((b) => (
        <button key={b.id} className={`card ${b.id === activeId ? "active" : ""}`} onClick={() => onOpen(b.id)}>
          {b.thumbnail ? (
            <img className="thumb" src={api.thumbnailUrl(b.id)} alt="" />
          ) : (
            <div className="thumb">{b.name.slice(0, 1).toUpperCase()}</div>
          )}
          <div className="card-body">
            <b>{b.name}</b>
            <span className="muted">{b.prompt}</span>
            <span className="muted small">
              {b.pieces} pieces · {b.steps} steps{b.status === "building" ? " · building…" : ""}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}
