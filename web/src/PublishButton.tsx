import { CaretDownIcon, GlobeIcon, LockSimpleIcon } from "@phosphor-icons/react";
import { Confirm } from "./Confirm";
import { useMenu } from "./useMenu";

interface Props {
  published: boolean;
  /** Why the build cannot be published yet, or null when it can. */
  blocked: string | null;
  author: string;
  /** An imported build: making it private keeps it under Mine, since it has no session to fall back to. */
  imported?: boolean;
  onPublish: () => Promise<void>;
  onUnpublish: () => Promise<void>;
}

/** Publishes the build to the public library under the author's name, or makes it private again, each after a confirmation. */
export function PublishButton({ published, blocked, author, imported = false, onPublish, onUnpublish }: Props) {
  const { open, setOpen, root } = useMenu();
  const ask = published
    ? {
        name: "Make private",
        question: "Make this build private?",
        note: imported
          ? "It leaves the public library and stays under Mine for you alone: its link only opens it for you. You can publish it again."
          : "It leaves the public library and its link stops working. You can publish it again.",
        doing: "Making private…",
        icon: <LockSimpleIcon size={16} />,
        action: onUnpublish,
      }
    : {
        name: "Publish",
        question: "Publish this build?",
        note: imported
          ? `Everyone at H Company can open it from the library, as ${author}'s.`
          : `Everyone at H Company can open it, as ${author}'s: the model, the chat, and the photos you attached.`,
        doing: "Publishing…",
        icon: <GlobeIcon size={16} />,
        action: onPublish,
      };

  return (
    <div className="menu" ref={root}>
      <button
        className={published ? "published" : undefined}
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
        <span className="button-label">{published ? "Public" : "Publish"}</span>
        {published && <CaretDownIcon size={12} />}
      </button>
      {open && <Confirm {...ask} onClose={() => setOpen(false)} />}
    </div>
  );
}
