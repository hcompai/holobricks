import { useEffect, useState } from "react";
import type { Bom, Build, Piece } from "./model";
import type { Color } from "./palette";

/** A line of an edited model's parts, counted in the browser and never checked against BrickLink. */
export interface CountedLine {
  part: string;
  title: string;
  color: number;
  colorName: string;
  hex: string;
  count: number;
}

/** The pieces counted by part and color, most first; titles come from the builder's verified list where it has them. */
export function countParts(pieces: Piece[], titles: Map<string, string>, palette: Color[]): CountedLine[] {
  const colors = new Map(palette.map((c) => [c.code, c]));
  const lines = new Map<string, CountedLine>();
  for (const p of pieces) {
    const key = `${p.part}:${p.color}`;
    const line = lines.get(key);
    if (line) line.count++;
    else
      lines.set(key, {
        part: p.part,
        title: titles.get(p.part) ?? p.part.replace(/\.dat$/, ""),
        color: p.color,
        colorName: colors.get(p.color)?.name ?? `Color ${p.color}`,
        hex: colors.get(p.color)?.hex ?? "transparent",
        count: 1,
      });
  }
  return [...lines.values()].sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
}

/** Why a parts list cannot be shown for this model, or null when it can. */
function problem(build: Build, now: number): string | null {
  if ("error" in build.bom) return build.bom.error;
  const bom: Bom = build.bom;
  const pieces = build.pieces.length;
  if (
    bom.revision !== build.revision ||
    bom.validation?.status !== "verified" ||
    !Number.isFinite(bom.validation.valid_until) ||
    bom.pieces !== pieces ||
    !Array.isArray(bom.lines) ||
    bom.lines.some(
      (l) =>
        !l.bricklinkPart || !Number.isSafeInteger(l.bricklinkColor) || !Number.isSafeInteger(l.count) || l.count <= 0,
    ) ||
    bom.lines.reduce((n, l) => n + l.count, 0) !== pieces
  )
    return "The complete parts list could not be verified. Unverified parts cannot be used for shopping.";
  if (bom.validation.valid_until * 1000 <= now) return "This parts list needs a fresh catalog check.";
  return null;
}

/** The build's verified parts list, or, for a model edited in this browser, its `counted` parts. */
export function PartsPanel({ build, counted }: { build: Build; counted: CountedLine[] | null }) {
  const [now, setNow] = useState(Date.now);
  const error = problem(build, now);
  const lines = error || "error" in build.bom ? [] : build.bom.lines;
  const expiry = "error" in build.bom ? null : build.bom.validation.valid_until * 1000;

  useEffect(() => {
    if (expiry === null || expiry <= Date.now()) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(expiry - Date.now(), 2147483647));
    return () => clearTimeout(timer);
  }, [expiry]);

  if (counted)
    return (
      <div className="parts">
        <div className="parts-head">
          <b>{build.pieces.length} pieces</b>
          <span className="muted">{counted.length} distinct part and color combinations</span>
        </div>
        <p className="parts-note" role="status">
          Counted from your edits in this browser, not checked against BrickLink: some parts may not exist in the colors
          you chose. Reset your edits to see and shop the verified list.
        </p>
        <table>
          <thead>
            <tr>
              <th>Qty</th>
              <th>Part</th>
              <th>Color</th>
            </tr>
          </thead>
          <tbody>
            {counted.map((l) => (
              <tr key={`${l.part}-${l.color}`}>
                <td className="qty">{l.count}×</td>
                <td>{l.title}</td>
                <td>
                  <span className="swatch" style={{ background: l.hex }} />
                  {l.colorName}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

  return (
    <div className="parts">
      <div className="parts-head">
        <b>{build.pieces.length} pieces</b>
        <span className="muted">{lines.length} distinct part and color combinations</span>
      </div>
      {error ? (
        <div role="alert">
          <p>{error}</p>
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Qty</th>
              <th>Part</th>
              <th>Color</th>
              <th>BrickLink part / color</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={`${l.part}-${l.color}`}>
                <td className="qty">{l.count}×</td>
                <td>{l.title}</td>
                <td>
                  <span className="swatch" style={{ background: l.hex }} />
                  {l.colorName}
                </td>
                <td className="id">
                  {l.bricklinkPart} / {l.bricklinkColor}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
