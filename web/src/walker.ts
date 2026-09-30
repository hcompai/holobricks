import { PLATE, STUD } from "./edits";

interface Point {
  x: number;
  y: number;
  z: number;
}

/** An axis-aligned box in world units, y up, such as a piece's bounds. */
export interface Solid {
  min: Point;
  max: Point;
}

type Axis = keyof Point;
type Control = "forward" | "back" | "left" | "right" | "jump" | "down";

/** Walking through the model like a minifig, in world units (LDraw's, y up) and seconds. */
export const WALK = {
  eye: 80,
  /** The body: `height` tall from the feet and `radius` from its middle to each side, so it fits a 2-stud gap. */
  height: 88,
  radius: 0.75 * STUD,
  /** The highest ledge climbed without jumping: a brick and its studs, never two. */
  step: 4 * PLATE,
  /** How high a jump goes: over two bricks and their studs. */
  jump: 8 * PLATE,
  gravity: 1600,
  speed: 6 * STUD,
  sprint: 1.6,
  fly: 2,
  /** Seconds to reach the speed the keys ask for: on the ground or flying, then in the air. */
  grip: 0.06,
  drift: 0.3,
  /** Seconds the view takes to catch up with a step up. */
  climb: 0.08,
  doubleTapMs: 300,
  pointerSpeed: 2,
  /** Radians the view stops short of straight up or down, where its heading would be lost. */
  tilt: 0.02,
  lookDistance: 20 * STUD,
};

const KEYS = new Map<string, Control>([
  ["KeyW", "forward"],
  ["ArrowUp", "forward"],
  ["KeyS", "back"],
  ["ArrowDown", "back"],
  ["KeyA", "left"],
  ["ArrowLeft", "left"],
  ["KeyD", "right"],
  ["ArrowRight", "right"],
  ["Space", "jump"],
  ["ShiftLeft", "down"],
  ["ShiftRight", "down"],
]);

const AXES = ["x", "y", "z"] as const;
/** Faces this close count as touching, not overlapping, whatever the rounding. */
const EPS = 1e-3;

/** Whether `a` and `b` overlap on every axis but `skip`. */
function overlaps(a: Solid, b: Solid, skip?: Axis): boolean {
  return AXES.every((axis) => axis === skip || (a.min[axis] < b.max[axis] - EPS && a.max[axis] > b.min[axis] + EPS));
}

/** How far `body` can move along `axis`, up to `distance`, before it touches one of `solids`. */
function clip(body: Solid, solids: Solid[], axis: Axis, distance: number): number {
  for (const solid of solids) {
    if (!overlaps(body, solid, axis)) continue;
    if (distance > 0 && solid.min[axis] >= body.max[axis] - EPS)
      distance = Math.min(distance, solid.min[axis] - body.max[axis]);
    else if (distance < 0 && solid.max[axis] <= body.min[axis] + EPS)
      distance = Math.max(distance, solid.max[axis] - body.min[axis]);
  }
  return distance;
}

function shift(body: Solid, axis: Axis, distance: number) {
  body.min[axis] += distance;
  body.max[axis] += distance;
}

/** Move `body` by `by`, vertically first, each axis stopping at the first solid; how far it went. */
function slide(body: Solid, by: Point, solids: Solid[]): Point {
  const moved = { x: 0, y: 0, z: 0 };
  for (const axis of ["y", "x", "z"] as const) {
    moved[axis] = clip(body, solids, axis, by[axis]);
    shift(body, axis, moved[axis]);
  }
  return moved;
}

/** Ease `value` toward `target` by the fraction `ease`, landing on it once within one unit. */
const approach = (value: number, target: number, ease: number) =>
  Math.abs(target - value) < 1 ? target : value + (target - value) * ease;

const column = (v: number) => Math.floor(v / STUD);
/** Unique while columns stay within 32768 studs of the origin. */
const key = (i: number, j: number) => i * 65536 + j;

/** The solids to collide with, found by the stud columns they stand in, over a floor at `ground`. */
export class Solids {
  private columns = new Map<number, Solid[]>();
  private floor: Solid;

  constructor(solids: Iterable<Solid>, ground: number) {
    this.floor = { min: { x: -Infinity, y: -Infinity, z: -Infinity }, max: { x: Infinity, y: ground, z: Infinity } };
    // Far faces on a column's edge only touch the next column, so it is left out.
    for (const solid of solids)
      for (let i = column(solid.min.x); i < Math.ceil(solid.max.x / STUD); i++)
        for (let j = column(solid.min.z); j < Math.ceil(solid.max.z / STUD); j++) {
          const found = this.columns.get(key(i, j));
          if (found) found.push(solid);
          else this.columns.set(key(i, j), [solid]);
        }
  }

  /** The floor and every solid standing in the columns under `area`, once each. */
  near(area: Solid): Solid[] {
    const found = new Set([this.floor]);
    for (let i = column(area.min.x); i <= column(area.max.x); i++)
      for (let j = column(area.min.z); j <= column(area.max.z); j++)
        for (const solid of this.columns.get(key(i, j)) ?? []) found.add(solid);
    return [...found];
  }
}

/** A body that walks, jumps and flies through `Solids`, driven by the keys held and moved frame by frame. */
export class Walker {
  /** The feet: the middle of the body's bottom. */
  x: number;
  y: number;
  z: number;
  flying = false;
  private velocity = { x: 0, y: 0, z: 0 };
  private grounded = false;
  private sprinting = false;
  /** Space went down since the last frame, however briefly. */
  private jumped = false;
  /** How far the view trails below the eye after a step up. */
  private lag = 0;
  private held = new Set<string>();
  private tapped = new Map<Control, number>();

  constructor(
    feet: Point,
    private onFly: (flying: boolean) => void = () => {},
  ) {
    ({ x: this.x, y: this.y, z: this.z } = feet);
  }

  get eye(): number {
    return this.y + WALK.eye - this.lag;
  }

  /** Press the key `code` at `time` milliseconds; false for keys walking does not use. */
  press(code: string, time: number): boolean {
    const control = KEYS.get(code);
    if (!control) return false;
    if (this.held.has(code)) return true;
    this.held.add(code);
    const double = time - (this.tapped.get(control) ?? -Infinity) < WALK.doubleTapMs;
    if (double) this.tapped.delete(control);
    else this.tapped.set(control, time);
    if (control === "jump") this.jumped = true;
    if (double && control === "jump") this.fly(!this.flying);
    if (double && control === "forward") this.sprinting = true;
    return true;
  }

  release(code: string) {
    this.held.delete(code);
    if (!this.pressed("forward")) this.sprinting = false;
  }

  releaseAll() {
    this.held.clear();
    this.sprinting = false;
  }

  /** Move for `seconds`, heading `yaw` radians about y from looking along -z. */
  step(seconds: number, yaw: number, solids: Solids) {
    this.unstick(solids);
    const forward = this.pressed("forward") - this.pressed("back");
    const right = this.pressed("right") - this.pressed("left");
    const speed =
      (WALK.speed * (this.flying ? WALK.fly : 1) * (this.sprinting ? WALK.sprint : 1)) /
      (Math.hypot(forward, right) || 1);
    const [sin, cos] = [Math.sin(yaw), Math.cos(yaw)];
    const ease = 1 - Math.exp(-seconds / (this.grounded || this.flying ? WALK.grip : WALK.drift));
    const v = this.velocity;
    v.x = approach(v.x, (right * cos - forward * sin) * speed, ease);
    v.z = approach(v.z, (-right * sin - forward * cos) * speed, ease);
    if (this.flying) v.y = approach(v.y, (this.pressed("jump") - this.pressed("down")) * WALK.speed * WALK.fly, ease);
    else {
      if (this.grounded && (this.jumped || this.pressed("jump"))) v.y = Math.sqrt(2 * WALK.gravity * WALK.jump);
      v.y -= WALK.gravity * seconds;
    }
    this.jumped = false;
    this.lag = approach(this.lag, 0, 1 - Math.exp(-seconds / WALK.climb));
    this.move({ x: v.x * seconds, y: v.y * seconds, z: v.z * seconds }, solids);
  }

  private pressed(control: Control): number {
    return [...this.held].some((code) => KEYS.get(code) === control) ? 1 : 0;
  }

  private fly(flying: boolean) {
    if (flying === this.flying) return;
    this.flying = flying;
    this.velocity.y = 0;
    this.onFly(flying);
  }

  private body(): Solid {
    const { radius: r, height } = WALK;
    return {
      min: { x: this.x - r, y: this.y, z: this.z - r },
      max: { x: this.x + r, y: this.y + height, z: this.z + r },
    };
  }

  /** Rise out of any solid the body is inside, onto the free space above it. */
  private unstick(solids: Solids) {
    for (;;) {
      const body = this.body();
      const inside = solids.near(body).filter((solid) => overlaps(body, solid));
      if (!inside.length) return;
      this.y = Math.max(...inside.map((solid) => solid.max.y));
      this.velocity.y = 0;
    }
  }

  /** Slide by `by` against the solids; on the ground, step up a ledge when that goes further. */
  private move(by: Point, solids: Solids) {
    const body = this.body();
    const reach = { x: Math.abs(by.x), z: Math.abs(by.z) };
    const near = solids.near({
      min: { x: body.min.x - reach.x, y: 0, z: body.min.z - reach.z },
      max: { x: body.max.x + reach.x, y: 0, z: body.max.z + reach.z },
    });
    let moved = slide(body, by, near);
    let landed = by.y < 0 && moved.y > by.y;
    if ((this.grounded || landed) && (moved.x !== by.x || moved.z !== by.z)) {
      const stepped = this.body();
      const up = clip(stepped, near, "y", WALK.step);
      shift(stepped, "y", up);
      const across = slide(stepped, { x: by.x, y: 0, z: by.z }, near);
      const down = clip(stepped, near, "y", -up);
      if (across.x ** 2 + across.z ** 2 > moved.x ** 2 + moved.z ** 2) {
        moved = { x: across.x, y: up + down, z: across.z };
        landed = down > -up;
        this.lag = Math.min(this.lag + moved.y, WALK.step);
      }
    }
    this.x += moved.x;
    this.y += moved.y;
    this.z += moved.z;
    const v = this.velocity;
    if (moved.x !== by.x) v.x = 0;
    if (moved.z !== by.z) v.z = 0;
    if (moved.y !== by.y) v.y = 0;
    this.grounded = landed;
    if (landed) this.fly(false);
  }
}
