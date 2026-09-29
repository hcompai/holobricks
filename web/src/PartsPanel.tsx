import { useEffect, useState } from "react";
import type { Bom, Build } from "./api";

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

export function PartsPanel({ build }: { build: Build }) {
  const [now, setNow] = useState(Date.now);
  const error = problem(build, now);
  const lines = error || "error" in build.bom ? [] : build.bom.lines;
  const expiry = "error" in build.bom ? null : build.bom.validation.valid_until * 1000;

  useEffect(() => {
    if (expiry === null || expiry <= Date.now()) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(expiry - Date.now(), 2147483647));
    return () => clearTimeout(timer);
  }, [expiry]);

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
