import { Box3, Vector3 } from "three";
import { cameraBounds, cameraPlanData, planBuildCamera, type CameraLens, type CameraLayer } from "./buildCamera";

export interface CameraRequest {
  id: number;
  /** step, start, end, template index, position (3), rotation (9), per piece. */
  pieces: Float64Array;
  /** Local part bounds (6) and whether they obstruct sight, per template. */
  templates: Float64Array;
  lens: CameraLens;
  duration: number;
}

self.onmessage = ({ data }: MessageEvent<CameraRequest>) => {
  try {
    const initial = new Box3();
    const initialSolids: ReturnType<typeof cameraBounds>[] = [];
    const layers: CameraLayer[] = [];
    const point = new Vector3();
    for (let i = 0; i < data.pieces.length; i += 16) {
      const row = data.pieces.subarray(i, i + 16);
      const local = data.templates.subarray(row[3] * 7, row[3] * 7 + 7);
      const box = new Box3();
      for (let corner = 0; corner < 8; corner++) {
        const x = local[corner & 1 ? 3 : 0],
          y = local[corner & 2 ? 4 : 1],
          z = local[corner & 4 ? 5 : 2];
        // The visible scene flips LDraw's downward Y and rearward Z around X.
        box.expandByPoint(
          point.set(
            row[7] * x + row[8] * y + row[9] * z + row[4],
            -(row[10] * x + row[11] * y + row[12] * z + row[5]),
            -(row[13] * x + row[14] * y + row[15] * z + row[6]),
          ),
        );
      }
      const bounds = cameraBounds(box);
      if (row[1] === -Infinity) {
        initial.union(box);
        if (local[6]) initialSolids.push(bounds);
      } else {
        // Include the short settling lift without allowing old geometry to widen the shot.
        box.max.y += 6;
        layers.push({
          step: row[0],
          start: row[1],
          end: row[2],
          bounds: cameraBounds(box),
          solids: local[6] ? [bounds] : [],
        });
      }
    }
    layers.sort((a, b) => a.step - b.step || a.start - b.start);
    const plan = planBuildCamera(
      layers,
      initial.isEmpty() ? null : cameraBounds(initial),
      data.lens,
      data.duration,
      0,
      initialSolids,
    );
    self.postMessage({ id: data.id, plan: plan && cameraPlanData(plan) });
  } catch (error) {
    self.postMessage({ id: data.id, error: String(error) });
  }
};
