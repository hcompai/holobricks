import { CursorClickIcon, FeatherIcon } from "@phosphor-icons/react";
import { type ReactNode, useEffect, useState } from "react";

/** How long the controls stay up once walking takes the mouse. */
const SHOWN_MS = 4000;
/** Walking looks around with a mouse or trackpad and moves with keys, which touch screens lack. */
const POINTER = window.matchMedia("(any-pointer: fine)").matches;

const SPACE = <kbd className="wide">space</kbd>;
const TWICE = <small>×2</small>;

const CONTROLS: [ReactNode, string][] = [
  [
    <span className="walk-wasd">
      <kbd>W</kbd>
      <kbd>A</kbd>
      <kbd>S</kbd>
      <kbd>D</kbd>
    </span>,
    "Move",
  ],
  [SPACE, "Jump"],
  [
    <span>
      {SPACE}
      {TWICE}
    </span>,
    "Fly",
  ],
  [<kbd>⇧</kbd>, "Down"],
  [
    <span>
      <kbd>W</kbd>
      {TWICE}
    </span>,
    "Sprint",
  ],
  [<kbd>esc</kbd>, "Leave"],
];

/** Walk mode's controls as keycaps: a call to click until walking takes the mouse, then fading away; a chip while flying. */
export function WalkHud({ locked, flying }: { locked: boolean; flying: boolean }) {
  const [away, setAway] = useState(false);

  useEffect(() => {
    setAway(false);
    if (!locked) return;
    const timer = setTimeout(() => setAway(true), SHOWN_MS);
    return () => clearTimeout(timer);
  }, [locked]);

  return (
    <>
      <div className={flying ? "walk-flying" : "walk-flying away"} role="status">
        <FeatherIcon size={13} weight="bold" />
        Flying
      </div>
      <div className={away ? "walk-hud away" : "walk-hud"}>
        {!locked &&
          (POINTER ? (
            <b>
              <CursorClickIcon size={16} weight="bold" />
              Click to walk
            </b>
          ) : (
            <b>Walking needs a keyboard and mouse</b>
          ))}
        {POINTER && (
          <div className="walk-keys">
            {CONTROLS.map(([keys, label]) => (
              <div key={label}>
                {keys}
                {label}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
