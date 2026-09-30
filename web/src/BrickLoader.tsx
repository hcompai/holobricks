import type { CSSProperties } from "react";

const SIDES = ["front", "right", "back", "left"] as const;
const STUDS = [0, 1, 2, 3];
const STUD_LAYERS = [0, 1, 2, 3, 4];

/** The Brickyard brick in CSS 3D: a white 2×2 brick with the H on two sides and the dot on the others. */
export function Brick() {
  return (
    <div className="brick" aria-hidden="true">
      {SIDES.map((side) => (
        <div key={side} className={`brick-face ${side}`}>
          {side === "front" || side === "back" ? <b>H</b> : <i />}
        </div>
      ))}
      <div className="brick-face top">
        {STUDS.map((s) => (
          <div key={s} className="stud">
            {STUD_LAYERS.map((l) => (
              <i key={l} style={{ "--layer": l } as CSSProperties} />
            ))}
          </div>
        ))}
      </div>
      <div className="brick-face bottom" />
    </div>
  );
}

/** The brick hopping while something loads; `idle` turns it slowly beside a note instead. */
export function BrickLoader({ label, idle = false }: { label: string; idle?: boolean }) {
  return (
    <div className={idle ? "brick-stage idle" : "brick-stage brick-loader"} role={idle ? undefined : "status"}>
      <div className="brick-hop">
        <Brick />
      </div>
      <div className="brick-shadow" />
      <span className={idle ? "brick-note" : "shimmer"}>{label}</span>
    </div>
  );
}
