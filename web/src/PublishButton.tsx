import { CaretDownIcon, GlobeIcon, LockSimpleIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { useMenu } from "./useMenu";

interface Props {
  published: boolean;
  /** Why the build cannot be published yet, or null when it can. */
  blocked: string | null;
  author: string;
  onPublish: () => Promise<void>;
  onUnpublish: () => Promise<void>;
}

/** Publishes the build to the public library under the author's name; making it private again asks first. */
export function PublishButton({ published, blocked, author, onPublish, onUnpublish }: Props) {
  const { open, setOpen, root } = useMenu();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!published)
    return (
      <span className="publish">
        {error && (
          <span className="publish-error" role="alert">
            {error}
          </span>
        )}
        <button
          className="publish-button"
          onClick={() => run(onPublish)}
          disabled={busy || blocked !== null}
          title={blocked ?? `Publish to the public library, as ${author}`}
        >
          <LockSimpleIcon size={16} />
          {busy ? "Publishing…" : "Publish"}
        </button>
      </span>
    );

  return (
    <div className="menu publish" ref={root}>
      <button
        className="publish-button active"
        onClick={() => setOpen(!open)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="In the public library: anyone can open it"
      >
        <GlobeIcon size={16} />
        Public
        <CaretDownIcon size={12} />
      </button>
      {open && (
        <div className="menu-list publish-confirm" role="dialog" aria-label="Make private">
          <b>Make this build private?</b>
          <p className="muted">It leaves the public library and its link stops working. You can publish it again.</p>
          {error && (
            <p className="publish-error" role="alert">
              {error}
            </p>
          )}
          <div className="publish-actions">
            <button onClick={() => setOpen(false)} disabled={busy} autoFocus>
              Cancel
            </button>
            <button className="primary" onClick={() => run(onUnpublish)} disabled={busy}>
              <LockSimpleIcon size={16} />
              {busy ? "Making private…" : "Make private"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
