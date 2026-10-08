import { XIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { saveDisplayName } from "./library";

/** One field for the name the user's public builds carry; saves it, then hands back the name they now carry. */
export function NameDialog({
  name,
  onSaved,
  onClose,
}: {
  name: string;
  onSaved: (name: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      onSaved(await saveDisplayName(value));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <dialog ref={dialog} className="dialog name-dialog" aria-labelledby="name-title" onCancel={onClose}>
      <div className="dialog-head">
        <div>
          <h2 id="name-title">Display name</h2>
          <p>Shown on your public builds.</p>
        </div>
        <button className="quiet icon-button" aria-label="Close" onClick={onClose}>
          <XIcon size={16} />
        </button>
      </div>
      <form
        className="dialog-generation"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <input
          className="name-input"
          aria-label="Display name"
          value={value}
          maxLength={64}
          autoFocus
          autoComplete="nickname"
          onChange={(e) => setValue(e.target.value)}
        />
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="confirm-actions">
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
