import { useEffect, useState } from "react";
import { api, type BomLine, type Build } from "./api";
import { buildRevision } from "./buildRevision";

export function PartsPanel({ build }: { build: Build }) {
  const [lines, setLines] = useState<BomLine[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const pieces = build.pieces.length;

  useEffect(() => {
    let active = true;
    let expiry: ReturnType<typeof setTimeout>;
    setLines([]);
    setError("");
    setLoading(true);
    Promise.all([api.bom(build.id), buildRevision(build.pieces)])
      .then(([bom, revision]) => {
        if (!active) return;
        if (
          bom.error ||
          bom.revision !== revision ||
          bom.validation?.status !== "verified" ||
          !Number.isFinite(bom.validation.valid_until) ||
          bom.validation.valid_until * 1000 <= Date.now() ||
          bom.pieces !== pieces ||
          !Array.isArray(bom.lines) ||
          bom.lines.some(
            (l) =>
              !l.bricklinkPart ||
              !Number.isSafeInteger(l.bricklinkColor) ||
              !Number.isSafeInteger(l.count) ||
              l.count <= 0,
          ) ||
          bom.lines.reduce((n, l) => n + l.count, 0) !== pieces
        )
          throw new Error("Unverified or stale bill of materials");
        setLines(bom.lines);
        setLoading(false);
        expiry = setTimeout(
          () => {
            setLines([]);
            setError("This parts list needs a fresh catalog check.");
          },
          Math.min(bom.validation.valid_until * 1000 - Date.now(), 2147483647),
        );
      })
      .catch(() => {
        if (!active) return;
        setLoading(false);
        setError("The complete parts list could not be verified. Unverified parts cannot be used for shopping.");
      });
    return () => {
      active = false;
      clearTimeout(expiry);
    };
  }, [build.id, build.pieces, pieces, attempt]);

  return (
    <div className="parts">
      <div className="parts-head">
        <b>{pieces} pieces</b>
        <span className="muted">{lines.length} distinct part and color combinations</span>
      </div>
      {loading ? (
        <p role="status">Verifying every part and color…</p>
      ) : error ? (
        <div role="alert">
          <p>{error}</p>
          <button onClick={() => setAttempt((n) => n + 1)}>Check again</button>
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
