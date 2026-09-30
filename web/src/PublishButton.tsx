import { GlobeIcon, LockSimpleIcon } from "@phosphor-icons/react";
import { useState } from "react";

interface Props {
  published: boolean;
  /** Why the build cannot be published yet, or null when it can. */
  blocked: string | null;
  author: string;
  onPublish: () => Promise<void>;
  onUnpublish: () => Promise<void>;
}

/** Publishes the build to the public library under the author's name, or takes it out. */
export function PublishButton({ published, blocked, author, onPublish, onUnpublish }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await (published ? onUnpublish() : onPublish());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const title = published
    ? "In the public library: anyone can open it. Click to take it out."
    : (blocked ?? `Publish to the public library, as ${author}`);
  return (
    <span className="publish">
      {error && (
        <span className="publish-error" role="alert">
          {error}
        </span>
      )}
      <button
        className={published ? "publish-button active" : "publish-button"}
        onClick={run}
        disabled={busy || (!published && blocked !== null)}
        title={title}
        aria-pressed={published}
      >
        {published ? <GlobeIcon size={16} /> : <LockSimpleIcon size={16} />}
        {busy ? (published ? "Unpublishing…" : "Publishing…") : published ? "Public" : "Publish"}
      </button>
    </span>
  );
}
