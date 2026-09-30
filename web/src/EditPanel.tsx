import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowLineDownIcon,
  ArrowLineUpIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  ArrowUUpLeftIcon,
  ArrowUUpRightIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { Edits } from "./edits";

/** What the selected piece can do; moves follow the screen, snapped to the model's axes. */
export type Action = "left" | "right" | "forward" | "back" | "up" | "down" | "turnLeft" | "turnRight" | "delete";

/** Keys for each action in edit mode, as `KeyboardEvent.key`. */
export const ACTION_KEYS: Record<string, Action> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "forward",
  ArrowDown: "back",
  PageUp: "up",
  e: "up",
  PageDown: "down",
  q: "down",
  r: "turnRight",
  R: "turnLeft",
  Delete: "delete",
  Backspace: "delete",
};

const MOVES: { action: Action; label: string; icon: React.ReactNode; area: string }[] = [
  { action: "forward", label: "Move forward (↑)", icon: <ArrowUpIcon size={16} weight="bold" />, area: "forward" },
  { action: "left", label: "Move left (←)", icon: <ArrowLeftIcon size={16} weight="bold" />, area: "left" },
  { action: "right", label: "Move right (→)", icon: <ArrowRightIcon size={16} weight="bold" />, area: "right" },
  { action: "back", label: "Move back (↓)", icon: <ArrowDownIcon size={16} weight="bold" />, area: "back" },
  {
    action: "up",
    label: "Move up a plate (E, Page Up)",
    icon: <ArrowLineUpIcon size={16} weight="bold" />,
    area: "up",
  },
  {
    action: "down",
    label: "Move down a plate (Q, Page Down)",
    icon: <ArrowLineDownIcon size={16} weight="bold" />,
    area: "down",
  },
];

/** The edit toolbar: how many changes, undo, redo and reset. */
export function EditBar({ edits }: { edits: Edits }) {
  const count = edits.edits.length;
  return (
    <div className="edit-bar" role="toolbar" aria-label="Edit mode">
      <span>{count ? `${count} change${count === 1 ? "" : "s"}` : "Click a piece to select it"}</span>
      <button className="icon-button" onClick={edits.undo} disabled={!count} title="Undo (⌘Z)" aria-label="Undo">
        <ArrowUUpLeftIcon size={16} weight="bold" />
      </button>
      <button
        className="icon-button"
        onClick={edits.redo}
        disabled={!edits.canRedo}
        title="Redo (⇧⌘Z)"
        aria-label="Redo"
      >
        <ArrowUUpRightIcon size={16} weight="bold" />
      </button>
      <button onClick={edits.reset} disabled={!count}>
        Reset
      </button>
    </div>
  );
}

/** The selected piece's controls: move a stud or a plate, turn a quarter, or delete it. */
export function EditPanel({
  label,
  onAction,
  onClose,
}: {
  label: string;
  onAction: (a: Action) => void;
  onClose: () => void;
}) {
  return (
    <div className="edit-panel" role="dialog" aria-label="Selected piece">
      <div className="edit-panel-head">
        <b title={label}>{label}</b>
        <button className="icon-button" onClick={onClose} title="Deselect (Esc)" aria-label="Deselect">
          <XIcon size={14} weight="bold" />
        </button>
      </div>
      <div className="edit-moves">
        {MOVES.map((m) => (
          <button
            key={m.action}
            style={{ gridArea: m.area }}
            onClick={() => onAction(m.action)}
            title={m.label}
            aria-label={m.label}
          >
            {m.icon}
          </button>
        ))}
      </div>
      <div className="edit-actions">
        <button onClick={() => onAction("turnLeft")} title="Turn left (⇧R)" aria-label="Turn left">
          <ArrowCounterClockwiseIcon size={16} weight="bold" />
        </button>
        <button onClick={() => onAction("turnRight")} title="Turn right (R)" aria-label="Turn right">
          <ArrowClockwiseIcon size={16} weight="bold" />
        </button>
        <button className="danger" onClick={() => onAction("delete")} title="Delete (Del)" aria-label="Delete">
          <TrashIcon size={16} weight="bold" /> Delete
        </button>
      </div>
    </div>
  );
}
