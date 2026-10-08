import { type ReactNode, useState } from "react";

interface Props {
  name: string;
  question: ReactNode;
  note: string;
  doing: string;
  icon: ReactNode;
  danger?: boolean;
  action: () => Promise<void>;
  onClose: () => void;
}

/** A popover confirmation under its button: what will happen, then Cancel or do it; a failure shows and keeps it open. */
export function Confirm({ name, question, note, doing, icon, danger = false, action, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="menu-list confirm" role="dialog" aria-label={name}>
      <b>{question}</b>
      <p className="muted">{note}</p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="confirm-actions">
        <button onClick={onClose} disabled={busy} autoFocus>
          Cancel
        </button>
        <button className={danger ? "primary danger" : "primary"} onClick={run} disabled={busy}>
          {icon}
          {busy ? doing : name}
        </button>
      </div>
    </div>
  );
}
