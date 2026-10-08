import { Box3, MathUtils, Vector3 } from "three";
import { occluded, occlusionIndex, type OcclusionNode } from "./cameraOcclusion";

export type CameraBounds = [number, number, number, number, number, number];
export interface CameraLayer {
  step: number;
  start: number;
  end: number;
  bounds: CameraBounds;
  /** Solid regions added by this layer; holes and transparent blocks stay out. */
  solids?: CameraBounds[];
}
export interface CameraPose {
  position: Vector3;
  target: Vector3;
  distance: number;
}
export interface CameraLens {
  aspect: number;
  fov: number;
  /** Frame height reserved for captions, below the image. */
  caption?: number;
}

export const cameraBox = (b: CameraBounds) => new Box3(new Vector3(b[0], b[1], b[2]), new Vector3(b[3], b[4], b[5]));
export const cameraBounds = (b: Box3): CameraBounds => [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z];
const ease = (t: number) => {
  const p = MathUtils.clamp(t, 0, 1);
  return p * p * (3 - 2 * p);
};

function visibility(pose: CameraPose, active: Box3, index: OcclusionNode | null, time: number): number {
  const point = active.getCenter(new Vector3());
  const delta = pose.position.clone().sub(point);
  if (occluded(index, point, delta, time)) return 0;
  let visible = 0;
  for (const x of [0.1, 0.5, 0.9])
    for (const z of [0.1, 0.5, 0.9]) {
      point.set(
        MathUtils.lerp(active.min.x, active.max.x, x),
        active.max.y - 0.05,
        MathUtils.lerp(active.min.z, active.max.z, z),
      );
      delta.copy(pose.position).sub(point);
      if (!occluded(index, point, delta, time)) visible++;
    }
  return visible / 9;
}

/** The center and a grid across the work's top must be exposed, not merely inside the frame. */
export function cameraVisibility(pose: CameraPose, active: Box3, solids: CameraBounds[]): number {
  return visibility(pose, active, occlusionIndex(solids.map((bounds) => ({ bounds, time: -Infinity }))), Infinity);
}

/** Include both ends while bounding work independently of voxel and layer counts. */
function samples<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) return items;
  return Array.from({ length: limit }, (_, i) => items[Math.round((i * (items.length - 1)) / (limit - 1))]);
}

function toward(azimuth: number, elevation: number): Vector3 {
  const a = MathUtils.degToRad(azimuth),
    e = MathUtils.degToRad(elevation);
  return new Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
}

/** Required distance along a direction, fitting the active work with a small edge margin. */
export function cameraDistance(box: Box3, target: Vector3, direction: Vector3, lens: CameraLens): number {
  if (box.isEmpty()) return 0;
  const right = new Vector3().crossVectors(new Vector3(0, 1, 0), direction).normalize();
  const up = new Vector3().crossVectors(direction, right);
  const tanY = Math.tan(MathUtils.degToRad(lens.fov / 2)) * (1 - (lens.caption ?? 0)) * 0.94;
  const tanX = Math.tan(MathUtils.degToRad(lens.fov / 2)) * lens.aspect * 0.94;
  const point = new Vector3();
  let distance = 1;
  for (let c = 0; c < 8; c++) {
    point.set(c & 1 ? box.max.x : box.min.x, c & 2 ? box.max.y : box.min.y, c & 4 ? box.max.z : box.min.z).sub(target);
    const ahead = point.dot(direction);
    distance = Math.max(distance, ahead + Math.abs(point.dot(right)) / tanX, ahead + Math.abs(point.dot(up)) / tanY);
  }
  return distance;
}

export interface BuildCameraPlan {
  steps: { start: number; end: number; pose: CameraPose }[];
  hero: CameraPose;
  duration: number;
  revealSeconds: number;
}

interface CameraPoseData {
  position: [number, number, number];
  target: [number, number, number];
  distance: number;
}
export interface CameraPlanData extends Omit<BuildCameraPlan, "steps" | "hero"> {
  steps: { start: number; end: number; pose: CameraPoseData }[];
  hero: CameraPoseData;
}

/** Worker messages carry coordinates; only the small shot list needs Three.js vectors on the UI thread. */
export function cameraPlanData(plan: BuildCameraPlan): CameraPlanData {
  const pose = (p: CameraPose): CameraPoseData => ({
    position: p.position.toArray(),
    target: p.target.toArray(),
    distance: p.distance,
  });
  return { ...plan, steps: plan.steps.map((step) => ({ ...step, pose: pose(step.pose) })), hero: pose(plan.hero) };
}
export function restoreCameraPlan(plan: CameraPlanData): BuildCameraPlan {
  const pose = (p: CameraPoseData): CameraPose => ({
    position: new Vector3(...p.position),
    target: new Vector3(...p.target),
    distance: p.distance,
  });
  return { ...plan, steps: plan.steps.map((step) => ({ ...step, pose: pose(step.pose) })), hero: pose(plan.hero) };
}

function frame(active: Box3, direction: Vector3, lens: CameraLens): CameraPose {
  const target = active.getCenter(new Vector3());
  const distance = cameraDistance(active, target, direction, lens);
  return { target, distance, position: target.clone().addScaledVector(direction, distance) };
}

/** Choose one clear composition for an entire step. Layers affect visibility, never camera movement. */
export function planBuildCamera(
  layers: CameraLayer[],
  initial: CameraBounds | null,
  lens: CameraLens,
  duration: number,
  revealSeconds = 1.8,
  initialSolids: CameraBounds[] = initial ? [initial] : [],
): BuildCameraPlan | null {
  if (!layers.length) return null;
  const groups: CameraLayer[][] = [];
  for (const layer of layers) {
    const previous = groups.at(-1);
    if (previous?.[0].step === layer.step) previous.push(layer);
    else groups.push([layer]);
  }
  const context = initial ? cameraBox(initial) : new Box3();
  const index = occlusionIndex([
    ...initialSolids.map((bounds) => ({ bounds, time: -Infinity })),
    ...layers.flatMap((layer) => (layer.solids ?? [layer.bounds]).map((bounds) => ({ bounds, time: layer.start }))),
  ]);
  let preferred: Vector3 | null = null;
  const steps = groups.map((group) => {
    const active = new Box3();
    for (const layer of group) active.union(cameraBox(layer.bounds));
    // At most 48 work regions per step, covering bottom, top and separated additions.
    const checks = samples(group, 8).flatMap((layer) =>
      samples(layer.solids?.length ? layer.solids : [layer.bounds], 6).map((bounds) => ({
        region: cameraBox(bounds),
        time: layer.start,
      })),
    );
    context.union(active);
    const size = active.getSize(new Vector3());
    const base = preferred
      ? MathUtils.radToDeg(Math.atan2(preferred.x, preferred.z))
      : MathUtils.clamp(MathUtils.radToDeg(Math.atan2(size.z, size.x)), 22, 68);
    const elevation = 49 - MathUtils.clamp(size.y / Math.max(size.x, size.z, 1), 0, 1) * 21;
    let best = toward(base, elevation),
      score = -Infinity;
    candidates: for (const offset of [0, -30, 30, -60, 60, -90, 90, -135, 135, 180])
      for (const height of [elevation, 55, 72, 85]) {
        const direction = toward(base + offset, height);
        const pose = frame(active, direction, lens);
        const penalty = Math.abs(offset) * 0.035 + Math.abs(height - elevation) * 0.12;
        let exposed = 1;
        for (const check of checks) {
          exposed = Math.min(exposed, visibility(pose, check.region, index, check.time));
          if (exposed * 100 - penalty <= score) break;
        }
        const rating = exposed * 100 - penalty;
        if (rating > score) {
          best = direction;
          score = rating;
        }
        // The preferred angle already exposes everything; no alternative can improve it.
        if (score === 100) break candidates;
      }
    preferred = best;
    return { start: group[0].start, end: group.at(-1)!.end, pose: frame(active, best, lens) };
  });
  const size = context.getSize(new Vector3());
  const direction = toward(MathUtils.clamp(MathUtils.radToDeg(Math.atan2(size.z, size.x)), 22, 68) + 26, 28);
  const target = context.getCenter(new Vector3());
  const distance = cameraDistance(context, target, direction, lens);
  return {
    steps,
    hero: { target, distance, position: target.clone().addScaledVector(direction, distance) },
    duration,
    revealSeconds,
  };
}

/** Move only in the gap before the next step, or during the final reveal. Placement shots stay exactly still. */
export function sampleBuildCamera(plan: BuildCameraPlan, seconds: number): CameraPose {
  let index = 0,
    end = plan.steps.length;
  while (index + 1 < end) {
    const middle = (index + end) >>> 1;
    if (plan.steps[middle].start <= seconds) index = middle;
    else end = middle;
  }
  const current = plan.steps[index];
  let next = current.pose,
    mix = 0;
  const following = plan.steps[index + 1];
  if (following && seconds > current.end) {
    next = following.pose;
    mix = ease((seconds - current.end) / Math.max(following.start - current.end, 0.001));
  } else if (!following && seconds > plan.duration && plan.revealSeconds > 0) {
    next = plan.hero;
    mix = ease((seconds - plan.duration) / Math.max(plan.revealSeconds - 0.3, 0.001));
  }
  if (mix === 0) return current.pose;
  if (mix === 1) return next;
  return {
    target: current.pose.target.clone().lerp(next.target, mix),
    position: current.pose.position.clone().lerp(next.position, mix),
    distance: MathUtils.lerp(current.pose.distance, next.distance, mix),
  };
}
