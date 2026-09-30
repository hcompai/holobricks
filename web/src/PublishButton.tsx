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

/** Publishes the build to the public library under the author's name, or makes it private again, each after a confirmation. */
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
  const ask = published
    ? {
        name: "Make private",
        question: "Make this build private?",
        note: "It leaves the public library and its link stops working. You can publish it again.",
        doing: "Making private…",
        icon: <LockSimpleIcon size={16} />,
        action: onUnpublish,
      }
    : {
        name: "Publish",
        question: "Publish this build?",
        note: `Everyone at H Company can open it, as ${author}'s: the model, the chat, and the photos you attached.`,
        doing: "Publishing…",
        icon: <GlobeIcon size={16} />,
        action: onPublish,
      };

  return (
    <div className="menu publish" ref={root}>
      <button
        className={published ? "publish-button active" : "publish-button"}
        onClick={() => setOpen(!open)}
        disabled={!published && blocked !== null}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={
          published
            ? "In the public library: anyone at H Company can open it"
            : (blocked ?? "Publish to the public library")
        }
      >
        {published ? <GlobeIcon size={16} /> : <LockSimpleIcon size={16} />}
        {published ? "Public" : "Publish"}
        {published && <CaretDownIcon size={12} />}
      </button>
      {open && (
        <div className="menu-list publish-confirm" role="dialog" aria-label={ask.name}>
          <b>{ask.question}</b>
          <p className="muted">{ask.note}</p>
          {error && (
            <p className="publish-error" role="alert">
              {error}
            </p>
          )}
          <div className="publish-actions">
            <button onClick={() => setOpen(false)} disabled={busy} autoFocus>
              Cancel
            </button>
            <button className="primary" onClick={() => run(ask.action)} disabled={busy}>
              {ask.icon}
              {busy ? ask.doing : ask.name}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
