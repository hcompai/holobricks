import { useEffect, useState } from "react";
import { api, type BomLine, type Build } from "./api";

export function PartsPanel({ build }: { build: Build }) {
  const [lines, setLines] = useState<BomLine[]>([]);
  const pieces = build.pieces.length;

  useEffect(() => {
    let active = true;
    api.bom(build.id).then((bom) => active && setLines(bom), console.error);
    return () => {
      active = false;
    };
  }, [build.id, pieces]);

  return (
    <div className="parts">
      <div className="parts-head">
        <b>{pieces} pieces</b>
        <span className="muted">{lines.length} distinct part and color combinations</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Qty</th>
            <th>Part</th>
            <th>Color</th>
            <th>LDraw id</th>
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
              <td className="id">{l.part.replace(".dat", "")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
