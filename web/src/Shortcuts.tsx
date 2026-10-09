import { useEffect } from "react";
import { typing } from "./scene";
import { useMenu } from "./useMenu";

const MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = MAC ? "⌘" : "Ctrl+";
const ALT = MAC ? "Option" : "Alt";

/** Every mouse and keyboard control, by mode: [keys, what they do]. */
const SECTIONS: { title: string; rows: [string, string][] }[] = [
  {
    title: "View",
    rows: [
      ["Drag", "Turn around the model"],
      ["Right-drag", "Pan"],
      ["Scroll", "Zoom"],
      ["?", "Show or hide these shortcuts"],
    ],
  },
  {
    title: "Edit",
    rows: [
      ["Click", "Select a piece"],
      [`Shift-click, ${MOD}click`, "Add or remove a piece"],
      ["Shift-drag", "Add the pieces seen in a box"],
      [`Shift-${ALT}-drag`, "Add every piece in a box, hidden ones too"],
      ["← →, A / D", "Move a stud left / right, as seen on screen"],
      ["↑ ↓, E / Q", "Move up / down a plate"],
      ["W / S", "Move a stud away / closer, along the view"],
      ["R / Shift-R", "Turn right / left a quarter"],
      [`${MOD}D`, "Duplicate beside it"],
      ["Delete, Backspace", "Delete"],
      [`${MOD}Z / Shift-${MOD}Z`, "Undo / redo"],
      ["Esc", "Clear the selection"],
    ],
  },
  {
    title: "Walk",
    rows: [
      ["Click", "Take the mouse to look around"],
      ["W A S D, arrows", "Walk"],
      ["W W", "Sprint: tap twice, then hold"],
      ["Space", "Jump"],
      ["Space Space", "Fly, or drop to the ground"],
      ["Space / Shift", "Fly up / down"],
      ["Esc", "Release the mouse; again to stop walking"],
    ],
  },
];

/** Every shortcut, listed beside the view controls when the ? key opens it. */
export function Shortcuts() {
  const { open, setOpen, root } = useMenu();

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!typing(e) && e.key === "?") setOpen((o) => !o);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  return (
    <div className="menu needs-mouse" ref={root}>
      {open && (
        <div className="menu-list shortcuts" role="dialog" aria-label="Shortcuts">
          {SECTIONS.map((section) => (
            <section key={section.title}>
              <b>{section.title}</b>
              <dl>
                {section.rows.map(([keys, action]) => (
                  <div key={keys}>
                    <dt>{keys}</dt>
                    <dd>{action}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
