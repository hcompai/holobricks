import type { Build } from "./model";
import { script } from "./remix";

/** A spatial reference for the request, not a restriction on which pieces Holo may change. */
export function selectedArea(model: Build, ids: number[]): Record<string, Blob> {
  const pieces = model.pieces.filter((p) => ids.includes(p.id));
  if (!pieces.length) throw new Error("Select an area first.");
  const area = {
    revision: model.revision,
    guidance:
      "These pieces indicate the area the user means. Adjust nearby or related pieces as needed to fulfil the request coherently; this is not a strict edit boundary.",
    coordinates: "LDraw units: x right, y down, z away from the front; 20 units per stud, 8 per plate.",
    pieces,
  };
  return {
    "selected-area.json": new Blob([JSON.stringify(area)], { type: "application/json" }),
    "selected-area-model.py": new Blob([script(model)], { type: "text/x-python" }),
  };
}
