import { TrashIcon } from "@phosphor-icons/react";
import { Confirm } from "./Confirm";
import { useMenu } from "./useMenu";

/** Deletes an imported build for good, after a confirmation naming what goes. */
export function DeleteButton({ name, onDelete }: { name: string; onDelete: () => Promise<void> }) {
  const { open, setOpen, root } = useMenu();
  return (
    <div className="menu publish" ref={root}>
      <button
        className="icon-button"
        onClick={() => setOpen(!open)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Delete"
        title="Delete this build"
      >
        <TrashIcon size={16} />
      </button>
      {open && (
        <Confirm
          name="Delete"
          question={`Delete ${name}?`}
          note="It leaves your library and the public one, and its link stops working. This cannot be undone."
          doing="Deleting…"
          icon={<TrashIcon size={16} />}
          danger
          action={onDelete}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
