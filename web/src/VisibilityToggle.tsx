import { GlobeIcon, LockSimpleIcon } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { Confirm } from "./Confirm";
import type { Publishing } from "./ShareMenu";
import { useMenu } from "./useMenu";

/** What going public means, asked before the user's first public build. */
export const publishAsk = (name: string, author: string, action: () => Promise<void>) => ({
  name: "Make it public",
  question: `Share ${name} with everyone?`,
  note: `Public builds appear in the library for anyone to open, fork and download, credited to ${author}. You can make a build private again at any time.`,
  doing: "Publishing…",
  icon: <GlobeIcon size={16} />,
  action,
});

/** A Private / Public switch for the open build; the first public build is confirmed, the next ones switch on the click. */
export function VisibilityToggle({ publishing, name }: { publishing: Publishing; name: string }) {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const { open: asking, setOpen: setAsking, root } = useMenu();
  const { published } = publishing;
  const blocked = published ? null : publishing.blocked;

  const change = async () => {
    busy.current = true;
    setPending(true);
    setError("");
    try {
      await (published ? publishing.onUnpublish() : publishing.onPublish());
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  const toggle = () => {
    if (busy.current || blocked) return;
    if (!published && publishing.first) return setAsking(true);
    change().catch((e) => setError(e instanceof Error ? e.message : "Couldn't change visibility. Try again."));
  };

  return (
    <div className="visibility-control" ref={root}>
      <button
        role="switch"
        aria-label="Public"
        aria-checked={published}
        aria-busy={pending}
        disabled={pending || !!blocked}
        title={
          blocked ??
          (published
            ? "Anyone can open this build. Switch to make it private."
            : "Only you can open this build. Switch to share it with everyone.")
        }
        onClick={toggle}
      >
        <span className="visibility-track" aria-hidden="true">
          <span className="visibility-knob">
            {published ? <GlobeIcon size={10} weight="bold" /> : <LockSimpleIcon size={10} weight="bold" />}
          </span>
        </span>
        <span className="visibility-label">{published ? "Public" : "Private"}</span>
      </button>
      {asking && <Confirm {...publishAsk(name, publishing.author, change)} onClose={() => setAsking(false)} />}
      {error && (
        <p className="visibility-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
