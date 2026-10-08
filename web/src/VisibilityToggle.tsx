import { useRef, useState } from "react";
import type { Publishing } from "./ShareMenu";

/** Visibility changes only after the existing publish/unpublish operation succeeds. */
export function VisibilityToggle({ publishing }: { publishing: Publishing }) {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const blocked = !publishing.published ? publishing.blocked : null;
  const toggle = async () => {
    if (busy.current || blocked) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      await (publishing.published ? publishing.onUnpublish() : publishing.onPublish());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't change visibility. Try again.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  return (
    <div className="visibility-control">
      <button
        role="switch"
        aria-label="Public"
        aria-checked={publishing.published}
        aria-busy={pending}
        disabled={pending || !!blocked}
        title={blocked ?? (publishing.published ? "Anyone can open this model" : "Publish this model to the library")}
        onClick={toggle}
      >
        <span className="visibility-track" aria-hidden="true">
          <span />
        </span>
        Public
      </button>
      {error && (
        <p className="visibility-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
