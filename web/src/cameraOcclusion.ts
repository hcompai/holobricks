import type { Vector3 } from "three";
import type { CameraBounds } from "./buildCamera";

export interface CameraSolid {
  bounds: CameraBounds;
  time: number;
}
export interface OcclusionNode {
  bounds: CameraBounds;
  time: number;
  solids?: CameraSolid[];
  left?: OcclusionNode;
  right?: OcclusionNode;
}

/** Build once per plan; rays visit nearby regions rather than scanning every solid. */
export function occlusionIndex(solids: CameraSolid[]): OcclusionNode | null {
  if (!solids.length) return null;
  const bounds: CameraBounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  let time = Infinity;
  for (const solid of solids) {
    time = Math.min(time, solid.time);
    for (let axis = 0; axis < 3; axis++) {
      bounds[axis] = Math.min(bounds[axis], solid.bounds[axis]);
      bounds[axis + 3] = Math.max(bounds[axis + 3], solid.bounds[axis + 3]);
    }
  }
  if (solids.length <= 8) return { bounds, time, solids };
  let axis = 0;
  for (let i = 1; i < 3; i++) if (bounds[i + 3] - bounds[i] > bounds[axis + 3] - bounds[axis]) axis = i;
  const middle = bounds[axis] + bounds[axis + 3];
  let left: CameraSolid[] = [],
    right: CameraSolid[] = [];
  for (const solid of solids) (solid.bounds[axis] + solid.bounds[axis + 3] < middle ? left : right).push(solid);
  if (!left.length || !right.length) {
    left = solids.slice(0, solids.length >>> 1);
    right = solids.slice(solids.length >>> 1);
  }
  return { bounds, time, left: occlusionIndex(left)!, right: occlusionIndex(right)! };
}

const axes = ["x", "y", "z"] as const;
function intersects(box: CameraBounds, point: Vector3, delta: Vector3): boolean {
  let near = 0,
    far = 1;
  for (let axis = 0; axis < 3; axis++) {
    const key = axes[axis],
      direction = delta[key];
    if (Math.abs(direction) < 1e-8) {
      if (point[key] <= box[axis] || point[key] >= box[axis + 3]) return false;
    } else {
      const a = (box[axis] - point[key]) / direction;
      const b = (box[axis + 3] - point[key]) / direction;
      near = Math.max(near, Math.min(a, b));
      far = Math.min(far, Math.max(a, b));
    }
    if (far <= near + 1e-6) return false;
  }
  return far > 0.001 && near < 0.999;
}

export function occluded(node: OcclusionNode | null, point: Vector3, delta: Vector3, time: number): boolean {
  if (!node || node.time >= time || !intersects(node.bounds, point, delta)) return false;
  if (!node.solids) return occluded(node.left!, point, delta, time) || occluded(node.right!, point, delta, time);
  return node.solids.some(({ bounds: box, time: placed }) => {
    if (placed >= time) return false;
    // Overwritten work inside an old region is not occluded by that region.
    if (
      point.x > box[0] &&
      point.x < box[3] &&
      point.y > box[1] &&
      point.y < box[4] &&
      point.z > box[2] &&
      point.z < box[5]
    )
      return false;
    return intersects(box, point, delta);
  });
}
