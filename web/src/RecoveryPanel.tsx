import { useState } from "react";
import { card } from "./library";
import type { Build } from "./model";
import { canRestore, recover, RecoveryProblem } from "./recovery";

export function RecoveryPanel({
  build,
  edited = false,
  onOpen,
}: {
  build: Build;
  edited?: boolean;
  onOpen: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const restore = canRestore(build);
  const previous = card(build.id)?.recoveryAttempt;
  const start = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onOpen(await recover(build));
    } catch (e) {
      setError(
        e instanceof RecoveryProblem
          ? e.message
          : "We couldn't open a recovery attempt. Your original build is unchanged. Check Library for a new attempt before trying again.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="recovery-panel" aria-label="Build recovery">
      <strong>Building was interrupted</strong>
      <p>
        {restore
          ? "Continue from the last shared version in a new attempt. Your original model stays here; later unshared changes may be lost."
          : "Try again with your original requests and photos. This attempt will restart from its original inputs, rather than its last shared version."}
      </p>
      {build.pieces.length > 0 && <p>You can also keep this version and download the model or an image.</p>}
      {restore && edited && <p>Manual edits stay with the original; recovery uses Holo’s shared version.</p>}
      <button disabled={busy} onClick={start}>
        {busy
          ? "Preparing your build…"
          : previous
            ? "Open recovery attempt"
            : restore
              ? "Continue from saved version"
              : "Try again with same request"}
      </button>
      {error && <p role="alert">{error}</p>}
      {build.failure && (
        <details>
          <summary>Technical details</summary>
          <p className="failure-detail">{build.failure}</p>
        </details>
      )}
    </section>
  );
}
