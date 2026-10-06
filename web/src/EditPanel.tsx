import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  ArrowDownIcon,
  ArrowDownLeftIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  ArrowUpRightIcon,
  ArrowUUpLeftIcon,
  ArrowUUpRightIcon,
  CopyIcon,
  SwapIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import type { Edits } from "./edits";
import type { Color } from "./palette";
import { PartPicker } from "./PartPicker";

/** What the selected piece can do; moves follow the screen, snapped to the model's axes. */
export type Action =
  "left" | "right" | "forward" | "back" | "up" | "down" | "turnLeft" | "turnRight" | "duplicate" | "delete";

/** Keys for each action in edit mode, as `KeyboardEvent.key`: arrows move across the screen, W/S into it. */
export const ACTION_KEYS: Record<string, Action> = {
  ArrowLeft: "left",
  a: "left",
  ArrowRight: "right",
  d: "right",
  ArrowUp: "up",
  e: "up",
  PageUp: "up",
  ArrowDown: "down",
  q: "down",
  PageDown: "down",
  w: "forward",
  s: "back",
  r: "turnRight",
  R: "turnLeft",
  Delete: "delete",
  Backspace: "delete",
};

const MOVES: { action: Action; label: string; icon: React.ReactNode }[] = [
  { action: "up", label: "Move up a plate (↑, E)", icon: <ArrowUpIcon size={16} weight="bold" /> },
  { action: "forward", label: "Move away (W)", icon: <ArrowUpRightIcon size={16} weight="bold" /> },
  { action: "left", label: "Move left (←, A)", icon: <ArrowLeftIcon size={16} weight="bold" /> },
  { action: "down", label: "Move down a plate (↓, Q)", icon: <ArrowDownIcon size={16} weight="bold" /> },
  { action: "right", label: "Move right (→, D)", icon: <ArrowRightIcon size={16} weight="bold" /> },
  { action: "back", label: "Move closer (S)", icon: <ArrowDownLeftIcon size={16} weight="bold" /> },
];

const HINT = matchMedia("(any-pointer: fine)").matches
  ? "Click a piece to select it; Shift-click or Shift-drag a box to add more"
  : "Tap a piece to select it";

/** The edit toolbar: how many changes, undo, redo and reset. */
export function EditBar({ edits }: { edits: Edits }) {
  const count = edits.edits.length;
  return (
    <div className="edit-bar" role="toolbar" aria-label="Edit mode">
      <span>{count ? `${count} change${count === 1 ? "" : "s"}` : HINT}</span>
      <button className="quiet icon-button" onClick={edits.undo} disabled={!count} title="Undo (⌘Z)" aria-label="Undo">
        <ArrowUUpLeftIcon size={16} weight="bold" />
      </button>
      <button
        className="quiet icon-button"
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

const FAMILIES: { family: Color["family"]; label: string }[] = [
  { family: "solid", label: "Solid" },
  { family: "transparent", label: "Transparent" },
  { family: "metallic", label: "Metallic" },
];

function Swatch({ color, onPick }: { color: Color; onPick: (code: number) => void }) {
  return (
    <button
      role="option"
      aria-selected={false}
      className={`color-swatch ${color.family}`}
      style={{ background: color.hex }}
      title={color.name}
      aria-label={color.name}
      onClick={() => onPick(color.code)}
    />
  );
}

/** The selection's colors, and a picker listing the model's own colors before the whole palette. */
function ColorPicker({ palette, used, current, onColor }: ColorProps) {
  const [open, setOpen] = useState(false);
  const byCode = new Map(palette.map((c) => [c.code, c]));
  const shown = current.map((code) => byCode.get(code));
  const name = current.length === 1 ? (shown[0]?.name ?? `Color ${current[0]}`) : "Mixed colors";
  const pick = (code: number) => {
    onColor(code);
    setOpen(false);
  };
  const inModel = used.flatMap((code) => byCode.get(code) ?? []);
  return (
    <div className="edit-color">
      <button
        className="edit-color-current"
        aria-expanded={open}
        aria-label={`Change color: ${name}`}
        title={`${name}: change color`}
        disabled={!palette.length}
        onClick={() => setOpen(!open)}
      >
        {shown.slice(0, 4).map((c, i) => (
          <span key={i} className="swatch-dot" style={{ background: c?.hex ?? "transparent" }} />
        ))}
        <span className="edit-color-name">{name}</span>
      </button>
      {open && (
        <div className="color-picker" role="listbox" aria-label="Colors">
          {[
            { label: "In this model", colors: inModel },
            ...FAMILIES.map((f) => ({ label: f.label, colors: palette.filter((c) => c.family === f.family) })),
          ]
            .filter((section) => section.colors.length)
            .map((section) => (
              <section key={section.label}>
                <small>{section.label}</small>
                <div className="color-swatches">
                  {section.colors.map((c) => (
                    <Swatch key={c.code} color={c} onPick={pick} />
                  ))}
                </div>
              </section>
            ))}
        </div>
      )}
    </div>
  );
}

interface ColorProps {
  /** Every color a piece can take. */
  palette: Color[];
  /** The model's colors, most used first. */
  used: number[];
  /** The selected pieces' colors. */
  current: number[];
  onColor: (code: number) => void;
}

export interface ReplaceProps {
  /** The model's parts, most used first. */
  usedParts: string[];
  /** The model's packed parts. */
  packs: Record<string, string>;
  /** The selected pieces' parts. */
  currentParts: string[];
  onReplace: (part: string, pack: string) => void;
}

/** The selection's controls: move a stud or a plate, turn a quarter about its middle, recolor, replace or delete it. */
export function EditPanel({
  label,
  onAction,
  onClose,
  usedParts,
  packs,
  currentParts,
  onReplace,
  ...color
}: {
  label: string;
  onAction: (a: Action) => void;
  onClose: () => void;
} & ColorProps &
  ReplaceProps) {
  const [replacing, setReplacing] = useState(false);
  return (
    <div className={replacing ? "edit-panel replacing" : "edit-panel"} role="dialog" aria-label="Selection">
      <div className="edit-panel-head">
        <b title={label}>{label}</b>
        <button className="quiet icon-button" onClick={onClose} title="Deselect (Esc)" aria-label="Deselect">
          <XIcon size={14} weight="bold" />
        </button>
      </div>
      {replacing ? (
        <PartPicker
          used={usedParts}
          packs={packs}
          current={currentParts}
          color={color.current[0] ?? 16}
          onPick={(part, pack) => {
            onReplace(part, pack);
            setReplacing(false);
          }}
          onBack={() => setReplacing(false)}
        />
      ) : (
        <SelectionControls onAction={onAction} onReplace={() => setReplacing(true)} color={color} />
      )}
    </div>
  );
}

function SelectionControls({
  onAction,
  onReplace,
  color,
}: {
  onAction: (a: Action) => void;
  onReplace: () => void;
  color: ColorProps;
}) {
  return (
    <>
      <div className="edit-moves">
        {MOVES.map((m) => (
          <button
            key={m.action}
            style={{ gridArea: m.action }}
            onClick={() => onAction(m.action)}
            title={m.label}
            aria-label={m.label}
          >
            {m.icon}
          </button>
        ))}
      </div>
      <ColorPicker {...color} />
      <button className="edit-replace" onClick={onReplace} title="Replace with another part" aria-label="Replace part">
        <SwapIcon size={16} weight="bold" />
        <span>Replace part</span>
      </button>
      <div className="edit-actions">
        <button onClick={() => onAction("turnLeft")} title="Turn left (⇧R)" aria-label="Turn left">
          <ArrowCounterClockwiseIcon size={16} weight="bold" />
        </button>
        <button onClick={() => onAction("turnRight")} title="Turn right (R)" aria-label="Turn right">
          <ArrowClockwiseIcon size={16} weight="bold" />
        </button>
        <button onClick={() => onAction("duplicate")} title="Duplicate beside it (⌘D)" aria-label="Duplicate">
          <CopyIcon size={16} weight="bold" />
        </button>
        <button className="danger" onClick={() => onAction("delete")} title="Delete (Del)" aria-label="Delete">
          <TrashIcon size={16} weight="bold" />
        </button>
      </div>
    </>
  );
}
