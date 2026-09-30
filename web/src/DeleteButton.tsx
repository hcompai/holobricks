import { TrashIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { useMenu } from "./useMenu";

/** Deletes an imported build for good, after a confirmation naming what goes. */
export function DeleteButton({ name, onDelete }: { name: string; onDelete: () => Promise<void> }) {
  const { open, setOpen, root } = useMenu();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await onDelete();
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="menu publish" ref={root}>
      <button
        className="icon-button"
        onClick={() => setOpen(!open)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Delete"
        title="Delete this build"
      >
        <TrashIcon size={16} />
      </button>
      {open && (
        <div className="menu-list publish-confirm" role="dialog" aria-label="Delete">
          <b>Delete {name}?</b>
          <p className="muted">
            It leaves your library and the public one, and its link stops working. This cannot be undone.
          </p>
          {error && (
            <p className="publish-error" role="alert">
              {error}
            </p>
          )}
          <div className="publish-actions">
            <button onClick={() => setOpen(false)} disabled={busy} autoFocus>
              Cancel
            </button>
            <button className="primary danger" onClick={run} disabled={busy}>
              <TrashIcon size={16} />
              {busy ? "Deleting…" : "Delete"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
