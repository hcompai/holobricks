import { DotsThreeIcon, GlobeIcon, LockSimpleIcon, PencilSimpleIcon, TrashIcon } from "@phosphor-icons/react";
import { type ComponentProps, type FormEvent, useEffect, useState } from "react";
import { Confirm } from "./Confirm";
import { deleteAsk } from "./ShareMenu";
import { useMenu } from "./useMenu";

/** What the owner can do with one of their projects from its card. */
export interface ProjectActions {
  name: string;
  published: boolean;
  /** An imported build: private keeps it, since it has no session to fall back to. */
  imported: boolean;
  onRename: (name: string) => Promise<void>;
  onVisibility: (makePublic: boolean) => Promise<void>;
  onDelete: () => Promise<void>;
  /** What deleting does, when it is not the default. */
  deleteNote?: string;
}

type Ask = Omit<ComponentProps<typeof Confirm>, "onClose">;

/** A "⋯" on the owner's card: rename it, make it private or public, or delete it, each confirmed. */
export function ProjectMenu(actions: ProjectActions) {
  const { name, published, imported, onRename, onVisibility, onDelete, deleteNote } = actions;
  const { open, setOpen, root } = useMenu();
  const [ask, setAsk] = useState<Ask | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) return;
    setAsk(null);
    setRenaming(false);
    setError(null);
  }, [open]);

  const rename = async (e: FormEvent) => {
    e.preventDefault();
    const next = draft.trim();
    if (!next || next === name) return setOpen(false);
    try {
      await onRename(next);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const visibility: Ask = published
    ? {
        name: "Make private",
        question: `Make ${name} private?`,
        note: imported
          ? "It leaves the public library and stays under Your builds for you alone. You can publish it again."
          : "It leaves the public library and its link stops working. You can publish it again.",
        doing: "Making private…",
        icon: <LockSimpleIcon size={16} />,
        action: () => onVisibility(false),
      }
    : {
        name: "Publish",
        question: `Publish ${name}?`,
        note: imported
          ? "Everyone at H Company can open it from the library."
          : "Everyone at H Company can open it: Holo's latest model and the chat. Open the build to publish it with your hand edits.",
        doing: "Publishing…",
        icon: <GlobeIcon size={16} />,
        action: () => onVisibility(true),
      };

  return (
    <div className="menu project-menu" ref={root}>
      <button
        className={open ? "icon-button active" : "icon-button"}
        aria-label="Rename, publish or delete"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Rename, publish or delete"
        onClick={() => setOpen(!open)}
      >
        <DotsThreeIcon size={18} weight="bold" />
      </button>
      {open &&
        (ask ? (
          <Confirm {...ask} onClose={() => setOpen(false)} />
        ) : renaming ? (
          <form className="menu-list project-rename" onSubmit={rename} aria-label="Rename">
            <input
              value={draft}
              maxLength={80}
              autoFocus
              aria-label="New name"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
            />
            {error && (
              <p className="error-text" role="alert">
                {error}
              </p>
            )}
            <div className="confirm-actions">
              <button type="button" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="primary" disabled={!draft.trim()}>
                Rename
              </button>
            </div>
          </form>
        ) : (
          <div className="menu-list" role="menu">
            <button
              role="menuitem"
              onClick={() => {
                setDraft(name);
                setRenaming(true);
              }}
            >
              <PencilSimpleIcon size={16} /> Rename
            </button>
            <button role="menuitem" onClick={() => setAsk(visibility)}>
              {published ? <LockSimpleIcon size={16} /> : <GlobeIcon size={16} />}
              {published ? "Make private" : "Publish"}
            </button>
            <button role="menuitem" className="danger" onClick={() => setAsk(deleteAsk(name, onDelete, deleteNote))}>
              <TrashIcon size={16} /> Delete
            </button>
          </div>
        ))}
    </div>
  );
}
