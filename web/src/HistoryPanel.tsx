import { XIcon } from "@phosphor-icons/react";
import type { Version } from "./history";

interface Props {
  versions: Version[];
  selected: string | null;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onSelect: (version: Version | null) => void;
  onClose: () => void;
}

export function HistoryPanel({ versions, selected, loading, error, onRetry, onSelect, onClose }: Props) {
  return (
    <section className="history-panel" aria-label="Version history">
      <div className="history-heading">
        <strong>History</strong>
        <span className="muted small">Saved models</span>
        <span className="spacer" />
        {loading && (
          <span role="status" className="muted small">
            Loading…
          </span>
        )}
        <button className="icon-button" aria-label="Close history" onClick={onClose}>
          <XIcon size={14} />
        </button>
      </div>
      {error ? (
        <div className="history-error" role="alert">
          History unavailable <button onClick={onRetry}>Retry</button>
        </div>
      ) : (
        <div className="history-versions">
          {[...versions].reverse().map((version, index) => {
            const latest = index === 0 && !loading;
            return (
              <button
                key={version.id}
                className={selected === version.id || (!selected && latest) ? "active" : ""}
                aria-label={`V${version.number}${latest ? " · Latest" : ""}`}
                aria-pressed={selected === version.id || (!selected && latest)}
                onClick={() => onSelect(latest ? null : version)}
              >
                <strong>
                  V{version.number} {latest && <span className="muted small">Latest</span>}
                </strong>
                <span>{version.model.pieces.length.toLocaleString()} pieces</span>
                <span className="muted small">
                  {version.at
                    ? new Date(version.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                    : "Starting model"}
                </span>
              </button>
            );
          })}
          {!versions.length && !loading && <span className="muted">No saved models yet</span>}
        </div>
      )}
    </section>
  );
}
