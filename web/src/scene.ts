import { BuildCameraClient } from "./buildCameraClient";
import { cameraBounds, sampleBuildCamera, type BuildCameraPlan, type CameraPose } from "./buildCamera";
import { CAMERA_MOVE_SECONDS } from "./buildTiming";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { LDrawLoader } from "three/examples/jsm/loaders/LDrawLoader.js";
import { LDrawConditionalLineMaterial } from "three/examples/jsm/materials/LDrawConditionalLineMaterial.js";
import type { Box, Camera, Piece } from "./model";
import { buildRevision } from "./buildRevision";
import { placementPop } from "./brickAudio";
import { placedCount, planPlacement, SETTLE_SECONDS, type PlacementPlan } from "./placement";
import { paletteFile } from "./palette";
import { Solids, WALK, Walker } from "./walker";

export type View = "iso" | "isoBack" | "front" | "top";

const VIEW_DIRECTIONS: Record<View, THREE.Vector3> = {
  iso: new THREE.Vector3(1, 0.85, 1.25).normalize(),
  isoBack: new THREE.Vector3(-1, 0.85, -1.25).normalize(),
  front: new THREE.Vector3(0, 0.25, 1).normalize(),
  top: new THREE.Vector3(0, 1, 0.001).normalize(),
};

const SHEET: { view: View; label: string }[] = [
  { view: "iso", label: "3/4 front-right" },
  { view: "isoBack", label: "3/4 back-left" },
  { view: "front", label: "Front" },
  { view: "top", label: "Top (back is up)" },
];

/** Every part the loaded models use, as one LDraw MPD each; a part's geometry never changes, so all scenes share them. */
const PARTS = new Map<string, string>();

export function provideParts(parts: Record<string, string>) {
  for (const [part, packed] of Object.entries(parts)) PARTS.set(part, packed);
}

/** Parts walking goes through: a box would close the opening of an arch or a door, and plants are soft. */
const PASSABLE = /^0 ~?(Arch|Door|Plant)\b/;

/** Whether `part` is passable, by its LDraw description: the line after the pack's first embedded file. */
const passable = (part: string) => PASSABLE.test(PARTS.get(part)?.match(/\n0 FILE [^\n]+\n([^\n]*)/)?.[1] ?? "");

const BACKDROP = "#f6f6f9";
const STUD = 20;
const PLATE = 8;
const SHADOW_MAP = 2048;
/** Edge opacity by how many pixels a stud covers: none where a stud's lines would pile into a dark film, crisp up close. */
const EDGE_FADE = { opacity: 0.6, fromPixels: 3, toPixels: 30 };
/** Vertical fields of view, in degrees: narrow to frame the model, wide to look around inside it. */
const FOV = { orbit: 35, walk: 70 };
const HOVER = { color: 0x4f8cff, opacity: 0.25 };
const SELECTED = { color: 0xf76808, opacity: 0.35, through: 0.12 };

interface Light {
  sun: THREE.Vector3;
  intensity: number;
  sky: number;
  environment: number;
  shadow: number;
}

/** The user's view: a sun from the upper left, so the default camera sees the shadows it casts. */
const FLOOR_SHADOW = 0.18;
const GLIDE_MS = 450;
const RENDER_QUALITY = 0.9;
const SETTLE_MS = 400;
/** Pieces past which a moving view drops to one pixel per point. */
const LARGE_MODEL = 5000;
const VIEW_LIGHT: Light = {
  sun: new THREE.Vector3(-0.5, 1, 0.6).normalize(),
  intensity: 2.6,
  sky: 0.3,
  environment: 0.35,
  shadow: 0.85,
};
/** The builder's renders: a sun behind the camera and no shadows, so every face reads clearly. */
const SHEET_LIGHT: Light = {
  sun: new THREE.Vector3(0.5, 1, 0.8).normalize(),
  intensity: 1.6,
  sky: 0.5,
  environment: 0.55,
  shadow: 0,
};

/** From the model toward a camera seen from compass `angle` (0 front, 90 right) and `elevation` degrees up. */
export function towardCamera(angle: number, elevation: number): THREE.Vector3 {
  const a = THREE.MathUtils.degToRad(angle);
  const e = THREE.MathUtils.degToRad(Math.min(elevation, 89.9));
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
}

/** The world-space volume of `box`, whose studs and plates are whole cells. */
function worldBox(box: Box): THREE.Box3 {
  return new THREE.Box3(
    new THREE.Vector3(box.x0 * STUD, box.z0 * PLATE, -(box.y1 + 1) * STUD),
    new THREE.Vector3((box.x1 + 1) * STUD, (box.z1 + 1) * PLATE, -box.y0 * STUD),
  );
}

/** Planes that keep only what lies inside `box`. */
function clippingPlanes(box: THREE.Box3): THREE.Plane[] {
  return [
    new THREE.Plane(new THREE.Vector3(1, 0, 0), -box.min.x),
    new THREE.Plane(new THREE.Vector3(-1, 0, 0), box.max.x),
    new THREE.Plane(new THREE.Vector3(0, 1, 0), -box.min.y),
    new THREE.Plane(new THREE.Vector3(0, -1, 0), box.max.y),
    new THREE.Plane(new THREE.Vector3(0, 0, 1), -box.min.z),
    new THREE.Plane(new THREE.Vector3(0, 0, -1), box.max.z),
  ];
}

/** `canvas` on the builder's backdrop, for formats without transparency. */
function backed(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = canvas.getContext("2d")!;
  ctx.globalCompositeOperation = "destination-over";
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = "source-over";
  return canvas;
}

/** One scene's instanced edge materials, faded together. */
class Edges {
  private copies = new Map<THREE.Material, THREE.Material>();
  private base = new Map<THREE.Material, { opacity: number; transparent: boolean; depthWrite: boolean }>();

  /** Scale every edge line's opacity by `fade`, 1 being the LDraw colors as defined. */
  fade(fade: number) {
    for (const [material, base] of this.base) {
      const transparent = base.transparent || fade < 1;
      if (material.transparent !== transparent) {
        material.transparent = transparent;
        material.needsUpdate = true;
      }
      material.depthWrite = fade < 1 ? false : base.depthWrite;
      material.visible = fade > 0;
      if (material instanceof THREE.ShaderMaterial) material.uniforms.opacity.value = base.opacity * fade;
      else material.opacity = base.opacity * fade;
    }
  }

  /** A copy of an edge material that reads each instance's transform from the instanceMatrix attribute. */
  instanced = (material: THREE.Material): THREE.Material => {
    let copy = this.copies.get(material);
    if (!copy) {
      copy = material.clone();
      copy.defines = { ...copy.defines, USE_INSTANCING: "" };
      this.base.set(copy, {
        opacity: copy instanceof THREE.ShaderMaterial ? copy.uniforms.opacity.value : copy.opacity,
        transparent: copy.transparent,
        depthWrite: copy.depthWrite,
      });
      if (copy instanceof THREE.ShaderMaterial) {
        copy.clipping = true;
        copy.vertexShader = copy.vertexShader.replace(
          /vec4\( (position|control0|control1|position \+ direction), 1\.0 \)/g,
          "instanceMatrix * $&",
        );
      }
      this.copies.set(material, copy);
    }
    return copy;
  };

  dispose() {
    for (const copy of this.copies.values()) copy.dispose();
    this.copies.clear();
    this.base.clear();
  }
}

function pieceMatrix(p: Piece, target: THREE.Matrix4): THREE.Matrix4 {
  const [a, b, c, d, e, f, g, h, i] = p.rot;
  return target.set(a, b, c, p.pos[0], d, e, f, p.pos[1], g, h, i, p.pos[2], 0, 0, 0, 1);
}

interface Instanced {
  object: THREE.Mesh | THREE.LineSegments;
  local: THREE.Matrix4;
  matrices: THREE.InstancedBufferAttribute;
}

/** Moves a piece away from its slot: `matrix` holds its placed transform and `size` its largest dimension, in LDraw units. */
export type Motion = (piece: Piece, matrix: THREE.Matrix4, size: number) => void;

/** Every piece of one part+color, one instanced draw per template sub-mesh, ordered by step so a count hides later steps. */
class Batch {
  private pieces: Piece[] = [];
  private objects: Instanced[] = [];
  private capacity = 0;
  private visible = 0;
  /** The part's own bounds, before any piece's transform. */
  readonly bounds: THREE.Box3;
  private size: number;
  /** The pieces drawn away from their slots, as a range of indices. */
  private moved = [0, 0];

  constructor(
    readonly template: THREE.Group,
    private root: THREE.Group,
    private materials: { mesh: (m: THREE.Material) => THREE.Material; line: (m: THREE.Material) => THREE.Material },
  ) {
    template.updateMatrixWorld(true);
    this.bounds = new THREE.Box3().setFromObject(template);
    const size = this.bounds.getSize(new THREE.Vector3());
    this.size = Math.max(size.x, size.y, size.z);
  }

  set(pieces: Piece[], step: number) {
    this.pieces = [...pieces].sort((a, b) => a.step - b.step || a.id - b.id);
    if (this.pieces.length > this.capacity) this.allocate(2 ** Math.ceil(Math.log2(this.pieces.length)));
    this.moved = [0, this.pieces.length];
    this.pose(0, 0);
    this.show(step);
  }

  /** Draw the pieces of steps `first` up to `last` (excluded) where `motion` moves them, and all others in their slots. */
  pose(first: number, last: number, motion?: Motion) {
    const from = this.firstAfter(first - 1);
    const to = this.firstAfter(last - 1);
    const matrix = new THREE.Matrix4();
    const world = new THREE.Matrix4();
    const write = (i: number, moving: boolean) => {
      const p = this.pieces[i];
      pieceMatrix(p, matrix);
      if (moving) motion?.(p, matrix, this.size);
      for (const o of this.objects) world.multiplyMatrices(matrix, o.local).toArray(o.matrices.array, i * 16);
    };
    const [a, b] = this.moved;
    for (let i = a; i < b; i++) if (i < from || i >= to) write(i, false);
    for (let i = from; i < to; i++) write(i, true);
    this.moved = [from, to];
    const start = Math.min(a, from);
    const end = Math.max(b, to);
    if (end <= start) return;
    for (const o of this.objects) {
      o.matrices.addUpdateRange(start * 16, (end - start) * 16);
      o.matrices.needsUpdate = true;
    }
    this.invalidateBounds();
  }

  /** The piece drawn as instance `index` of `object`, if this batch draws it. */
  pieceAt(object: THREE.Object3D, index: number): Piece | null {
    return this.objects.some((o) => o.object === object) ? (this.pieces[index] ?? null) : null;
  }

  /** The meshes that can be picked: only their visible instances are hit. */
  meshes(): THREE.InstancedMesh[] {
    return this.objects.flatMap(({ object }) =>
      object instanceof THREE.InstancedMesh && object.count ? [object] : [],
    );
  }

  /** Raycasts cache instanced bounds, which moving or revealing pieces makes stale. */
  private invalidateBounds() {
    for (const { object } of this.objects)
      if (object instanceof THREE.InstancedMesh) object.boundingSphere = object.boundingBox = null;
  }

  /** The index of the first piece of a step after `step`. */
  private firstAfter(step: number): number {
    let lo = 0;
    let hi = this.pieces.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.pieces[mid].step > step) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }

  show(step: number) {
    this.visible = this.firstAfter(step);
    for (const { object } of this.objects) {
      if (object instanceof THREE.InstancedMesh) object.count = this.visible;
      else (object.geometry as THREE.InstancedBufferGeometry).instanceCount = this.visible;
    }
    this.invalidateBounds();
  }

  /** Grow `target` by the pieces with these `ids`, in the root's local space: LDraw units. */
  expandIds(target: THREE.Box3, ids: Set<number>) {
    const matrix = new THREE.Matrix4();
    const box = new THREE.Box3();
    for (const p of this.pieces)
      if (ids.has(p.id)) target.union(box.copy(this.bounds).applyMatrix4(pieceMatrix(p, matrix)));
  }

  /** The pieces shown up to the visible step, each with the middle of its bounds in the root's local space. */
  *shown(): Generator<[Piece, THREE.Vector3]> {
    const matrix = new THREE.Matrix4();
    const middle = this.bounds.getCenter(new THREE.Vector3());
    for (const p of this.pieces.slice(0, this.visible)) yield [p, middle.clone().applyMatrix4(pieceMatrix(p, matrix))];
  }

  /** The bounds of each piece shown up to the visible step, in the root's local space. */
  shownBounds(): THREE.Box3[] {
    const matrix = new THREE.Matrix4();
    return this.pieces.slice(0, this.visible).map((p) => this.bounds.clone().applyMatrix4(pieceMatrix(p, matrix)));
  }

  /** Grow `target` by every piece, in the root's local space. */
  expand(target: THREE.Box3) {
    const matrix = new THREE.Matrix4();
    const box = new THREE.Box3();
    for (const p of this.pieces) target.union(box.copy(this.bounds).applyMatrix4(pieceMatrix(p, matrix)));
  }

  /** Grow each step's box in `steps` by its pieces, in the root's local space. */
  expandSteps(steps: THREE.Box3[]) {
    const matrix = new THREE.Matrix4();
    const box = new THREE.Box3();
    for (const p of this.pieces) {
      box.copy(this.bounds).applyMatrix4(pieceMatrix(p, matrix));
      (steps[p.step] ??= new THREE.Box3()).union(box);
    }
  }

  dispose() {
    for (const { object } of this.objects) {
      this.root.remove(object);
      if (object instanceof THREE.InstancedMesh) object.dispose();
      else object.geometry.dispose();
    }
    this.objects = [];
  }

  private allocate(capacity: number) {
    this.dispose();
    this.capacity = capacity;
    this.template.traverse((source) => {
      if (!(source instanceof THREE.Mesh || source instanceof THREE.LineSegments)) return;
      let object: THREE.Mesh | THREE.LineSegments;
      let matrices: THREE.InstancedBufferAttribute;
      if (source instanceof THREE.Mesh) {
        const { mesh: look } = this.materials;
        const material = Array.isArray(source.material) ? source.material.map(look) : look(source.material);
        const mesh = new THREE.InstancedMesh(source.geometry, material, capacity);
        mesh.castShadow = ![source.material].flat().some((m) => m.transparent);
        mesh.receiveShadow = true;
        object = mesh;
        matrices = mesh.instanceMatrix;
      } else {
        const geometry = new THREE.InstancedBufferGeometry();
        geometry.index = source.geometry.index;
        for (const name in source.geometry.attributes) geometry.setAttribute(name, source.geometry.getAttribute(name));
        for (const group of source.geometry.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
        matrices = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 16), 16);
        geometry.setAttribute("instanceMatrix", matrices);
        const { line } = this.materials;
        const material = Array.isArray(source.material) ? source.material.map(line) : line(source.material);
        object = new THREE.LineSegments(geometry, material);
      }
      object.frustumCulled = false;
      object.matrixAutoUpdate = false;
      this.objects.push({ object, local: source.matrixWorld.clone(), matrices });
      this.root.add(object);
    });
  }
}

export interface PlacementProgress {
  active: boolean;
  paused: boolean;
  placed: number;
  total: number;
  layer: number;
}

export interface SceneOptions {
  onPlacement?: (progress: PlacementProgress) => void;
  onFollowBuild?: (follow: boolean) => void;
  signal?: AbortSignal;
  /** False when the caller sizes and draws every frame: no render loop or container tracking. */
  interactive?: boolean;
  onError?: (error: Error) => void;
  /** The material meshes draw with, given their LDraw one. */
  material?: (material: THREE.Material) => THREE.Material;
  /** Called when walking takes or releases the mouse pointer. */
  onWalkLock?: (locked: boolean) => void;
  /** Called when walking starts or stops flying. */
  onFly?: (flying: boolean) => void;
  /** How highlighted pieces show: tinted and outlined (the default), or only outlined, as instructions draw new pieces. */
  marks?: "tint" | "outline";
}

function mark(color: number, opacity: number, through = false): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    opacity,
    transparent: true,
    depthWrite: false,
    depthTest: !through,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
  });
}

export const typing = (event: KeyboardEvent) =>
  event.target instanceof HTMLElement && !!event.target.closest("input, textarea, select, [contenteditable]");

/** Three.js scene holding LDraw pieces; each part+color is fetched and parsed once, then drawn instanced. */
export class BrickScene {
  /** Exposed for offline renderers that compose their own passes; the live view only goes through methods. */
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV.orbit, 1, 1, 100000);
  readonly sun = new THREE.DirectionalLight();
  readonly sky = new THREE.HemisphereLight(0xffffff, 0x6f6f6f);
  private sunDistance = 1;
  private dirty = true;
  private shadowsStale = true;
  private controls: OrbitControls;
  private loader = new LDrawLoader();
  private root = new THREE.Group();
  private batches = new Map<string, Batch>();
  private templates = new Map<string, Promise<THREE.Group>>();
  private materials: Promise<void> | null = null;
  private lifetime = new AbortController();
  private visibleStep = Infinity;
  private placement: {
    plan: PlacementPlan;
    seconds: number;
    paused: boolean;
    reported: number;
    sounded: number;
  } | null = null;
  private placementSpeed = 1;
  private placementEnabled = true;
  private followBuild = true;
  private buildComplete = false;
  private cameraPlanner = new BuildCameraClient();
  private cameraGeneration = 0;
  private cameraPlanning = false;
  private cameraPlan: PlacementPlan | null = null;
  private cameraMotion: { track: BuildCameraPlan; seconds: number; approach: number; from: CameraPose } | null = null;
  private loading: Promise<void> = Promise.resolve();
  private wanted: Piece[] | null = null;
  private shown: Piece[] | null = null;
  /** The shown pieces' bounds, whatever step is visible. */
  private bounds: THREE.Box3 | null = null;
  /** Set once the user orbits or zooms, so live framing stops fighting them. */
  userMoved = false;
  private resizeObserver = new ResizeObserver(() => this.resize());
  private frame = 0;
  private disposed = false;
  private environment: THREE.WebGLRenderTarget;
  private framing: { view: View; width: number; depth: number } = { view: "iso", width: 32, depth: 32 };
  private edges = new Edges();
  private materialsFor: ConstructorParameters<typeof Batch>[2];
  private raycaster = new THREE.Raycaster();
  /** Tints drawn over the hovered and the selected piece; never picked or rendered for the builder. */
  private overlay = new THREE.Group();
  private highlighted: { hover: number | null; selected: number[] } = { hover: null, selected: [] };
  private marks = {
    hover: mark(HOVER.color, HOVER.opacity),
    selected: mark(SELECTED.color, SELECTED.opacity),
    through: mark(SELECTED.color, SELECTED.through, true),
  };
  /** Outlines of the highlighted pieces' bounds, seen through anything in front of them. */
  private outlines = {
    hover: new THREE.LineBasicMaterial({ color: HOVER.color, depthTest: false, transparent: true }),
    selected: new THREE.LineBasicMaterial({ color: SELECTED.color, depthTest: false, transparent: true }),
  };
  private outlineBox = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
  private pointer: PointerLockControls | null = null;
  private walking = false;
  private walker: Walker | null = null;
  /** What walking collides with: the pieces shown, rebuilt once they change. */
  private solids: Solids | null = null;
  private timer = new THREE.Timer();
  private ground = 0;
  /** Catches the model's shadow in the user's view. */
  private floor: THREE.Mesh<THREE.PlaneGeometry, THREE.ShadowMaterial> | null = null;
  /** The camera easing from one framing to the next: [position, target] at each end. */
  private glide: { from: THREE.Vector3[]; to: THREE.Vector3[]; start: number } | null = null;
  private dragging = false;
  private settling: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private container: HTMLElement,
    private options: SceneOptions = {},
  ) {
    const interactive = options.interactive ?? true;
    this.materialsFor = { mesh: options.material ?? ((m) => m), line: this.edges.instanced };
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(interactive ? Math.min(window.devicePixelRatio, 2) : 1);
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.autoUpdate = false;
    container.appendChild(this.renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, 0.04);
    this.scene.environment = this.environment.texture;
    room.dispose();
    pmrem.dispose();
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.setScalar(SHADOW_MAP);
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sky, this.sun, this.sun.target);

    this.root.rotation.x = Math.PI;
    this.root.add(this.overlay);
    this.scene.add(this.root);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.addEventListener("start", () => {
      this.userMoved = true;
      this.setFollowBuild(false);
      this.options.onFollowBuild?.(false);
      this.glide = null;
      clearTimeout(this.settling);
      this.dragging = true;
      this.sharpen();
    });
    this.controls.addEventListener("end", () => {
      this.settling = setTimeout(() => {
        this.dragging = false;
        this.sharpen();
      }, SETTLE_MS);
    });
    this.controls.addEventListener("change", () => {
      this.dirty = true;
      if (this.walking) return;
      this.camera.near = Math.max(1, this.camera.position.distanceTo(this.controls.target) / 100);
      this.camera.updateProjectionMatrix();
    });
    this.controls.autoRotateSpeed = 1.2;

    this.loader.smoothNormals = true;
    this.loader.setConditionalLineMaterial(LDrawConditionalLineMaterial);
    options.signal?.addEventListener("abort", () => this.lifetime.abort(), { once: true });
    if (options.signal?.aborted) this.lifetime.abort();
    this.renderer.domElement.addEventListener("webglcontextlost", this.contextLost);

    if (!interactive) return;
    this.floor = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.ShadowMaterial({ opacity: FLOOR_SHADOW }),
    );
    this.floor.receiveShadow = true;
    this.floor.visible = false;
    this.scene.add(this.floor);
    this.resizeObserver.observe(container);
    this.resize();
    this.frameView("iso", 32, 32);
    const tick = (time?: number) => {
      this.frame = requestAnimationFrame(tick);
      const seconds = Math.min(this.timer.update(time).getDelta(), 0.1);
      this.advancePlacement(seconds);
      if (this.walking) this.walk(seconds);
      else {
        this.controls.enableDamping = !this.followingBuild;
        this.controls.update();
        if (this.cameraMotion || this.cameraPlanning) this.advanceCamera(seconds);
        else this.ease();
      }
      if (this.dirty && this.container.checkVisibility({ visibilityProperty: true })) this.draw();
    };
    tick();
  }

  /** The user's view: sunlit with shadows, edges faded by how many pixels a stud covers. */
  private draw(completed = false) {
    this.dirty = false;
    if (this.shadowsStale) this.fitShadows();
    this.light(this.placement && !completed ? { ...VIEW_LIGHT, shadow: 0 } : VIEW_LIGHT);
    this.adaptEdges(this.renderer.getDrawingBufferSize(new THREE.Vector2()).y);
    this.renderer.render(this.scene, this.camera);
  }

  private adaptEdges(height: number) {
    const distance = this.walking ? WALK.lookDistance : this.camera.position.distanceTo(this.controls.target);
    this.fadeEdges(distance, height);
  }

  /** Fade edges by how many pixels a stud covers `distance` away in a `height`-pixel frame. */
  fadeEdges(distance: number, height: number) {
    const pixels = (STUD * height) / (2 * distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    const { opacity, fromPixels, toPixels } = EDGE_FADE;
    this.edges.fade(opacity * THREE.MathUtils.smoothstep(pixels, fromPixels, toPixels));
  }

  /** Aim the sun's shadow camera at the whole model and redraw its shadow map on the next render. */
  private fitShadows() {
    this.shadowsStale = false;
    const box = this.modelBox();
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const r = Math.max(sphere.radius, STUD);
    if (this.floor) {
      this.floor.visible = !box.isEmpty();
      this.floor.position.set(sphere.center.x, box.min.y - 0.1, sphere.center.z);
      this.floor.scale.setScalar(4 * r);
    }
    this.sun.target.position.copy(sphere.center);
    this.sun.target.updateMatrixWorld();
    this.sunDistance = 2 * r;
    const camera = this.sun.shadow.camera;
    Object.assign(camera, { left: -r, right: r, top: r, bottom: -r, near: r, far: 3 * r });
    camera.updateProjectionMatrix();
    this.sun.shadow.normalBias = (2 * r) / this.sun.shadow.mapSize.x;
    this.renderer.shadowMap.needsUpdate = true;
  }

  private light({ sun, intensity, sky, environment, shadow }: Light) {
    this.sun.position.copy(this.sun.target.position).addScaledVector(sun, this.sunDistance);
    this.sun.intensity = intensity;
    this.sun.shadow.intensity = shadow;
    this.sky.intensity = sky;
    this.scene.environmentIntensity = environment;
  }

  /** The world-space bounds of every piece, empty with none. */
  modelBox(): THREE.Box3 {
    if (!this.bounds) {
      this.root.updateMatrixWorld(true);
      this.bounds = new THREE.Box3();
      for (const batch of this.batches.values()) batch.expand(this.bounds);
      this.bounds.applyMatrix4(this.root.matrixWorld);
    }
    return this.bounds.clone();
  }

  /** The world-space bounds of each step's pieces, indexed by step. */
  stepBoxes(): THREE.Box3[] {
    this.root.updateMatrixWorld(true);
    const steps: THREE.Box3[] = [];
    for (const batch of this.batches.values()) batch.expandSteps(steps);
    for (const box of steps) box?.applyMatrix4(this.root.matrixWorld);
    return steps;
  }

  /** Draw the pieces of steps `first` up to `last` (excluded) where `motion` moves them, in the pieces' LDraw space. */
  pose(first: number, last: number, motion: Motion) {
    for (const batch of this.batches.values()) batch.pose(first, last, motion);
    this.dirty = true;
  }

  /** Size the drawing buffer in pixels, for callers that draw every frame themselves. */
  setSize(width: number, height: number) {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cameraPlanner.dispose();
    this.lifetime.abort();
    this.renderer.domElement.removeEventListener("webglcontextlost", this.contextLost);
    cancelAnimationFrame(this.frame);
    clearTimeout(this.settling);
    this.resizeObserver.disconnect();
    this.stopListening();
    this.pointer?.unlock();
    this.pointer?.dispose();
    this.controls.dispose();
    this.overlay.clear();
    for (const material of [...Object.values(this.marks), ...Object.values(this.outlines)]) material.dispose();
    this.outlineBox.dispose();
    for (const batch of this.batches.values()) batch.dispose();
    this.batches.clear();
    this.environment.dispose();
    this.sun.shadow.dispose();
    this.floor?.geometry.dispose();
    this.floor?.material.dispose();
    // Parsing may still be in flight when an export is cancelled. Release its resources too.
    void Promise.allSettled(this.templates.values()).then((results) => {
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>(this.loader.materials);
      for (const result of results) {
        if (result.status !== "fulfilled") continue;
        result.value.traverse((object) => {
          if (!(object instanceof THREE.Mesh || object instanceof THREE.LineSegments)) return;
          geometries.add(object.geometry);
          for (const material of [object.material].flat()) materials.add(material);
        });
      }
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      this.edges.dispose();
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    const aspectChanged = this.camera.aspect !== w / h;
    this.camera.aspect = w / h;
    this.dirty = true;
    this.camera.updateProjectionMatrix();
    if (this.followingBuild && this.cameraPlan) {
      if (aspectChanged) this.planCamera(this.cameraPlan);
    } else if (!this.userMoved) this.frameView(this.framing.view, this.framing.width, this.framing.depth);
  }

  private contextLost = (event: Event) => {
    event.preventDefault();
    this.options.onError?.(new Error("The 3D connection was lost. Reload the model to recover."));
  };

  private assertAvailable() {
    if (this.disposed || this.lifetime.signal.aborted) throw new Error("Renderer disposed");
    if (this.renderer.getContext().isContextLost()) throw new Error("The 3D connection was lost");
  }

  private palette(): Promise<void> {
    if (!this.materials) {
      const pending = paletteFile().then(async (text) => {
        if (!/^0 !COLOUR /m.test(text)) throw new Error("Empty LDraw color palette");
        const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
        try {
          await this.loader.preloadMaterials(url);
        } finally {
          URL.revokeObjectURL(url);
        }
      });
      this.materials = pending;
      void pending.catch(() => {
        if (this.materials === pending) this.materials = null;
      });
    }
    return this.materials;
  }

  /** Failed parses are evicted, so retrying can actually recover. */
  private template(part: string, color: number): Promise<THREE.Group> {
    const key = `${part}:${color}`;
    let template = this.templates.get(key);
    if (!template) {
      template = this.palette()
        // Each parse gets its own task so a big model keeps the page responsive while it loads.
        .then(() => new Promise((resolve) => setTimeout(resolve)))
        .then(() => {
          this.assertAvailable();
          const packed = PARTS.get(part);
          // Never parse an incomplete pack or follow its external references.
          if (!packed?.startsWith("0 FILE ") || !/\n[134] /m.test(packed))
            throw new Error(`Invalid render asset: ${part}`);
          return new Promise<THREE.Group>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`Parsing ${part} timed out`)), 12000);
            this.loader.parse(
              packed.replace("\n1 16 ", `\n1 ${color} `),
              (group) => {
                clearTimeout(timer);
                if (new THREE.Box3().setFromObject(group).isEmpty()) reject(new Error(`Empty render asset: ${part}`));
                else resolve(group);
              },
              (error) => {
                clearTimeout(timer);
                reject(error);
              },
            );
          });
        });
      this.templates.set(key, template);
      const pending = template;
      void pending.catch(() => {
        if (this.templates.get(key) === pending) this.templates.delete(key);
      });
    }
    return template;
  }

  /** True only after these exact pieces were drawn. Superseded calls cannot acknowledge success. */
  setPieces(pieces: Piece[], { animate = false, fresh = false } = {}): Promise<boolean> {
    this.wanted = pieces;
    const update = this.loading
      .catch(() => undefined)
      .then(async () => {
        if (this.wanted !== pieces) return false;
        const previous = fresh ? [] : (this.shown ?? []).filter((p) => p.step <= this.visibleStep);
        if (this.shown !== pieces && !(await this.apply(pieces, () => this.wanted === pieces))) return false;
        this.cancelCamera();
        if (fresh) this.userMoved = false;
        this.finishPlacement();
        this.showStep(this.visibleStep);
        if (animate) this.startPlacement(previous);
        this.assertAvailable();
        this.draw();
        return this.wanted === pieces;
      });
    this.loading = update.then(
      () => undefined,
      () => undefined,
    );
    return update;
  }

  /** Capture only the current scene, never install an obsolete agent request into the user's canvas. */
  renderBuild(pieces: Piece[], revision: string, camera: Camera | null, box: Box | null): Promise<Blob | null> {
    const render = this.loading
      .catch(() => undefined)
      .then(async () => {
        if (this.wanted !== pieces || this.shown !== pieces || (await buildRevision(pieces)) !== revision) return null;
        this.assertAvailable();
        return camera ? this.view(camera, box) : this.sheet(box);
      });
    this.loading = render.then(
      () => undefined,
      () => undefined,
    );
    return render;
  }

  renderThumbnail(pieces: Piece[]): Promise<Blob | null> {
    const render = this.loading
      .catch(() => undefined)
      .then(() => {
        if (this.wanted !== pieces || this.shown !== pieces) return null;
        this.assertAvailable();
        return this.thumbnail();
      });
    this.loading = render.then(
      () => undefined,
      () => undefined,
    );
    return render;
  }

  private async apply(pieces: Piece[], current: () => boolean): Promise<boolean> {
    const groups = new Map<string, Piece[]>();
    for (const p of pieces) {
      const key = `${p.part}:${p.color}`;
      const group = groups.get(key);
      if (group) group.push(p);
      else groups.set(key, [p]);
    }
    // Preflight the complete candidate before touching any live batch.
    const templates = await Promise.all([...groups.values()].map(([p]) => this.template(p.part, p.color)));
    this.assertAvailable();
    if (!current()) return false;
    for (const [key, batch] of this.batches) {
      if (groups.has(key)) continue;
      batch.dispose();
      this.batches.delete(key);
    }
    [...groups].forEach(([key, group], i) => {
      const template = templates[i];
      if (!template) return;
      let batch = this.batches.get(key);
      if (!batch) this.batches.set(key, (batch = new Batch(template, this.root, this.materialsFor)));
      batch.set(group, this.visibleStep);
    });
    this.shown = pieces;
    this.solids = null;
    this.bounds = null;
    this.dirty = this.shadowsStale = true;
    this.drawHighlights();
    return true;
  }

  /** Flush the current camera and timeline before acknowledging a revision. */
  drawCurrent() {
    this.assertAvailable();
    this.draw();
  }

  setVisibleStep(step: number, animate = false) {
    if (step === this.visibleStep) return;
    const previous = (this.shown ?? []).filter((p) => p.step <= this.visibleStep);
    const forward = step > this.visibleStep;
    this.cancelCamera();
    this.finishPlacement();
    this.showStep(step);
    if (animate && forward) this.startPlacement(previous);
  }

  private showStep(step: number) {
    this.visibleStep = step;
    for (const batch of this.batches.values()) batch.show(step);
    this.solids = null;
    this.dirty = this.shadowsStale = true;
    this.drawHighlights();
  }

  private startPlacement(previous: Piece[]) {
    if (!this.placementEnabled || this.walking || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const plan = planPlacement(
      (this.shown ?? []).filter((p) => p.step <= this.visibleStep),
      previous,
    );
    if (!plan.pieces.length) return;
    this.placement = { plan, seconds: -1, paused: false, reported: -Infinity, sounded: 0 };
    this.posePlacement();
    this.reportPlacement();
    if (this.followingBuild) this.planCamera(plan);
  }

  get followingBuild() {
    return this.followBuild && !this.walking && !this.controls.autoRotate && !this.userMoved;
  }

  private cancelCamera() {
    this.cameraGeneration++;
    this.cameraPlanning = false;
    this.cameraMotion = null;
    this.cameraPlan = null;
  }

  setFollowBuild(follow: boolean) {
    this.followBuild = follow;
    if (!follow) this.cancelCamera();
    else {
      this.userMoved = false;
      this.controls.autoRotate = false;
      if (this.placement) this.planCamera(this.placement.plan);
    }
  }

  setBuildComplete(complete: boolean) {
    this.buildComplete = complete;
    if (this.cameraMotion) this.cameraMotion.track.revealSeconds = complete ? 1.8 : 0;
  }

  private planCamera(plan: PlacementPlan) {
    this.cameraPlan = plan;
    this.glide = null;
    const generation = ++this.cameraGeneration;
    this.cameraPlanning = true;
    const visible = (this.shown ?? []).filter((p) => p.step <= this.visibleStep);
    const pieces = new Float64Array(visible.length * 16);
    const templates: number[] = [];
    const indices = new Map<string, number>();
    const ends = new Map(plan.steps.map((step) => [step.index, step.end]));
    visible.forEach((piece, i) => {
      const key = `${piece.part}:${piece.color}`;
      let index = indices.get(key);
      if (index === undefined) {
        const batch = this.batches.get(key)!;
        index = indices.size;
        indices.set(key, index);
        let opaque = true;
        batch.template.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            if (materials.some((material) => material.transparent)) opaque = false;
          }
        });
        templates.push(...cameraBounds(batch.bounds), +opaque);
      }
      pieces.set(
        [
          piece.step,
          plan.starts.get(piece.id) ?? -Infinity,
          ends.get(piece.step) ?? 0,
          index,
          ...piece.pos,
          ...piece.rot,
        ],
        i * 16,
      );
    });
    void this.cameraPlanner
      .plan({
        pieces,
        templates: Float64Array.from(templates),
        lens: { aspect: this.camera.aspect, fov: FOV.orbit },
        duration: plan.duration,
      })
      .then((track) => {
        if (this.disposed || generation !== this.cameraGeneration) return;
        this.cameraPlanning = false;
        if (!track || !this.followingBuild) return;
        track.revealSeconds = this.buildComplete ? 1.8 : 0;
        this.cameraMotion = {
          track,
          seconds: Math.max(0, this.placement?.seconds ?? plan.duration),
          approach: 0,
          from: {
            position: this.camera.position.clone(),
            target: this.controls.target.clone(),
            distance: this.camera.position.distanceTo(this.controls.target),
          },
        };
      })
      .catch((error) => {
        if (this.disposed || generation !== this.cameraGeneration) return;
        this.setFollowBuild(false);
        this.options.onFollowBuild?.(false);
        console.error("Could not plan the build camera", error);
      });
  }

  private advanceCamera(delta: number) {
    const motion = this.cameraMotion;
    if (!motion || !this.followingBuild || this.placement?.paused || document.hidden) return;
    const end = motion.track.duration + motion.track.revealSeconds;
    if (motion.seconds >= end) return;
    motion.approach = Math.min(motion.approach + delta, CAMERA_MOVE_SECONDS);
    motion.seconds = Math.max(0, this.placement?.seconds ?? Math.min(motion.seconds + delta, end));
    const pose = sampleBuildCamera(motion.track, motion.seconds);
    const t = motion.approach / CAMERA_MOVE_SECONDS,
      eased = t * t * (3 - 2 * t);
    this.camera.position.copy(motion.from.position).lerp(pose.position, eased);
    this.controls.target.copy(motion.from.target).lerp(pose.target, eased);
    this.camera.near = Math.max(0.1, pose.distance / 100);
    this.camera.far = Math.max(100000, pose.distance * 100);
    this.camera.fov = FOV.orbit;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.controls.target);
    this.dirty = true;
  }

  setPlacementSpeed(speed: number) {
    this.placementSpeed = Math.max(0.1, Math.min(8, speed));
  }

  setPlacementEnabled(enabled: boolean) {
    this.placementEnabled = enabled;
    if (!enabled) this.finishPlacement();
  }

  pausePlacement(paused: boolean) {
    if (!this.placement) return;
    this.placement.paused = paused;
    this.reportPlacement();
  }

  finishPlacement() {
    const current = this.placement;
    if (!current) return;
    this.placement = null;
    if (this.cameraMotion) this.cameraMotion.seconds = current.plan.duration;
    for (const batch of this.batches.values()) batch.pose(0, Infinity);
    this.dirty = this.shadowsStale = true;
    this.options.onPlacement?.({
      active: false,
      paused: false,
      placed: current.plan.pieces.length,
      total: current.plan.pieces.length,
      layer: 0,
    });
  }

  /** Scale pending instances to zero, then drop each real part a fraction of a stud into its final transform. */
  private posePlacement() {
    const current = this.placement;
    if (!current) return;
    const { plan, seconds } = current;
    this.pose(0, this.visibleStep + 1, (piece, matrix) => {
      const start = plan.starts.get(piece.id);
      if (start === undefined) return;
      const elapsed = seconds - start;
      if (elapsed < 0) matrix.scale(new THREE.Vector3(0, 0, 0));
      else if (elapsed < SETTLE_SECONDS) {
        const progress = elapsed / SETTLE_SECONDS;
        // The root flips LDraw Y; subtracting moves the piece upward in the visible world.
        matrix.elements[13] -= 6 * (1 - progress) ** 3;
      }
    });
  }

  private advancePlacement(delta: number) {
    const current = this.placement;
    if (!current || current.paused || this.cameraPlanning) return;
    if (this.cameraMotion && this.cameraMotion.approach < CAMERA_MOVE_SECONDS) return;
    current.seconds = Math.max(0, current.seconds) + delta * this.placementSpeed;
    this.posePlacement();
    const landed = placedCount(current.plan, current.seconds - SETTLE_SECONDS);
    if (landed > current.sounded) {
      placementPop(current.plan.pieces[landed - 1].part);
      current.sounded = landed;
    }
    if (current.seconds >= current.plan.duration) this.finishPlacement();
    else if (current.seconds - current.reported >= 0.05) this.reportPlacement();
  }

  private reportPlacement() {
    const current = this.placement;
    if (!current) return;
    const placed = placedCount(current.plan, current.seconds);
    current.reported = current.seconds;
    const piece = current.plan.pieces[Math.max(0, placed - 1)];
    this.options.onPlacement?.({
      active: true,
      paused: current.paused,
      placed,
      total: current.plan.pieces.length,
      layer: Math.max(1, Math.round(-piece.pos[1] / PLATE) + 1),
    });
  }

  setSpin(spin: boolean) {
    this.controls.autoRotate = spin;
    this.sharpen();
  }

  /** Big models move at one pixel per point, and sharpen again once still. */
  private sharpen() {
    const moving = this.dragging || this.controls.autoRotate;
    const ratio = moving && (this.shown?.length ?? 0) > LARGE_MODEL ? 1 : Math.min(window.devicePixelRatio, 2);
    if (ratio === this.renderer.getPixelRatio()) return;
    this.renderer.setPixelRatio(ratio);
    this.resize();
  }

  /** The piece drawn under the client point (`x`, `y`), among the pieces shown up to the visible step. */
  pick(x: number, y: number): Piece | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const point = new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(point, this.camera);
    const batches = [...this.batches.values()];
    for (const hit of this.raycaster.intersectObjects(
      batches.flatMap((b) => b.meshes()),
      false,
    )) {
      if (hit.instanceId === undefined) continue;
      for (const batch of batches) {
        const piece = batch.pieceAt(hit.object, hit.instanceId);
        if (piece) return piece;
      }
    }
    return null;
  }

  /** The bounds of the pieces with these ids, in LDraw units: x right, y down, z away from the front. */
  piecesBox(ids: number[]): THREE.Box3 {
    const box = new THREE.Box3();
    const wanted = new Set(ids);
    for (const batch of this.batches.values()) batch.expandIds(box, wanted);
    return box;
  }

  /** The ids of the pieces shown whose middle falls inside the client rectangle, hidden ones included. */
  piecesIn(x0: number, y0: number, x1: number, y1: number): number[] {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const [left, right] = [Math.min(x0, x1), Math.max(x0, x1)];
    const [top, bottom] = [Math.min(y0, y1), Math.max(y0, y1)];
    this.root.updateMatrixWorld(true);
    this.camera.updateMatrixWorld();
    const ids: number[] = [];
    for (const batch of this.batches.values())
      for (const [piece, middle] of batch.shown()) {
        const ndc = middle.applyMatrix4(this.root.matrixWorld).project(this.camera);
        if (ndc.z > 1) continue;
        const x = rect.left + ((ndc.x + 1) / 2) * rect.width;
        const y = rect.top + ((1 - ndc.y) / 2) * rect.height;
        if (x >= left && x <= right && y >= top && y <= bottom) ids.push(piece.id);
      }
    return ids;
  }

  /** The ids of the pieces seen inside the client rectangle: rays cast on a grid across it, at most about `rays`. */
  piecesSeenIn(x0: number, y0: number, x1: number, y1: number, rays = 600): number[] {
    const [left, right] = [Math.min(x0, x1), Math.max(x0, x1)];
    const [top, bottom] = [Math.min(y0, y1), Math.max(y0, y1)];
    const spacing = Math.max(3, Math.sqrt(((right - left) * (bottom - top)) / rays));
    const ids = new Set<number>();
    for (let y = top + spacing / 2; y < bottom; y += spacing)
      for (let x = left + spacing / 2; x < right; x += spacing) {
        const piece = this.pick(x, y);
        if (piece) ids.add(piece.id);
      }
    return [...ids];
  }

  /** Let the mouse orbit the camera, or not while it draws a selection box. */
  setOrbit(orbit: boolean) {
    if (!this.walking) this.controls.enabled = orbit;
  }

  /** Tint the piece under the pointer and the selected pieces, by id. */
  setHighlight(hover: number | null, selected: number[]) {
    const same = (a: number[], b: number[]) => a.length === b.length && a.every((id, i) => id === b[i]);
    if (this.highlighted.hover === hover && same(this.highlighted.selected, selected)) return;
    this.highlighted = { hover, selected };
    this.drawHighlights();
  }

  /** The model's horizontal axes nearest the screen's right and the view's forward, in LDraw units. */
  screenAxes(): { right: [number, number, number]; forward: [number, number, number] } {
    const d = this.camera.getWorldDirection(new THREE.Vector3());
    const forward =
      Math.abs(d.x) > Math.abs(d.z)
        ? new THREE.Vector3(Math.sign(d.x), 0, 0)
        : new THREE.Vector3(0, 0, Math.sign(d.z) || -1);
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    // The root turns the world half a turn about x, so LDraw's axes are the world's x, -y and -z.
    const ldraw = (v: THREE.Vector3): [number, number, number] => [v.x || 0, -v.y || 0, -v.z || 0];
    return { right: ldraw(right), forward: ldraw(forward) };
  }

  /** Walk through the model at a minifig's eye height, or go back to orbiting it. */
  setWalk(walk: boolean) {
    if (walk === this.walking) return;
    this.walking = walk;
    this.glide = null;
    if (walk) {
      this.camera.fov = FOV.walk;
      this.camera.updateProjectionMatrix();
      this.pointer ??= this.makePointer();
      this.controls.enabled = false;
      this.controls.autoRotate = false;
      this.userMoved = true;
      this.standAtFront();
      window.addEventListener("keydown", this.keyDown);
      window.addEventListener("keyup", this.keyUp);
      window.addEventListener("blur", this.releaseKeys);
    } else {
      this.stopListening();
      this.walker = null;
      this.pointer?.unlock();
      this.controls.enabled = true;
      // Carry on from where the walk ended: same place, same lens, orbiting what is in view. A chosen view resets both.
      this.controls.target.copy(this.inView());
      this.controls.update();
    }
    this.dirty = true;
  }

  /** Take the mouse pointer to look around, while walking; the browser needs a click for it. */
  lockPointer() {
    if (this.walking) this.pointer?.lock();
  }

  /** The point the camera looks at: the piece in the middle of the view, else as far as the model's middle. */
  private inView(): THREE.Vector3 {
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const meshes = [...this.batches.values()].flatMap((b) => b.meshes());
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    const middle = this.modelBox().getCenter(new THREE.Vector3());
    const distance = hit?.distance ?? Math.max(this.camera.position.distanceTo(middle), 2 * STUD);
    return this.raycaster.ray.at(distance, new THREE.Vector3());
  }

  private makePointer(): PointerLockControls {
    const pointer = new PointerLockControls(this.camera, this.renderer.domElement);
    pointer.pointerSpeed = WALK.pointerSpeed;
    pointer.minPolarAngle = WALK.tilt;
    pointer.maxPolarAngle = Math.PI - WALK.tilt;
    pointer.addEventListener("change", () => (this.dirty = true));
    pointer.addEventListener("lock", () => this.options.onWalkLock?.(true));
    pointer.addEventListener("unlock", () => this.options.onWalkLock?.(false));
    return pointer;
  }

  /** Stand in front of the model, on its ground, looking at its middle. */
  private standAtFront() {
    const box = this.modelBox();
    if (box.isEmpty())
      box.set(new THREE.Vector3(0, 0, -this.framing.depth * STUD), new THREE.Vector3(this.framing.width * STUD, 0, 0));
    const center = box.getCenter(new THREE.Vector3());
    this.ground = box.min.y;
    this.solids = null;
    const feet = { x: center.x, y: this.ground, z: box.max.z + 8 * STUD };
    this.walker = new Walker(feet, (flying) => this.options.onFly?.(flying));
    this.camera.position.set(feet.x, this.walker.eye, feet.z);
    this.camera.near = 1;
    this.camera.far = Math.max(100000, box.getSize(new THREE.Vector3()).length() * 10);
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(center.x, this.walker.eye, center.z);
  }

  /** The pieces shown, in world space, over the ground. */
  private collider(): Solids {
    this.root.updateMatrixWorld(true);
    const boxes = [...this.batches]
      .filter(([key]) => !passable(key.slice(0, key.lastIndexOf(":"))))
      .flatMap(([, batch]) => batch.shownBounds());
    for (const box of boxes) box.applyMatrix4(this.root.matrixWorld);
    return new Solids(boxes, this.ground);
  }

  private walk(seconds: number) {
    if (!this.walker) return;
    this.solids ??= this.collider();
    this.walker.step(seconds, new THREE.Euler().setFromQuaternion(this.camera.quaternion, "YXZ").y, this.solids);
    const eye = new THREE.Vector3(this.walker.x, this.walker.eye, this.walker.z);
    if (eye.equals(this.camera.position)) return;
    this.camera.position.copy(eye);
    this.dirty = true;
  }

  private keyDown = (event: KeyboardEvent) => {
    if (typing(event) || event.metaKey || event.ctrlKey || event.altKey) return;
    if (this.walker?.press(event.code, event.timeStamp)) event.preventDefault();
  };

  private keyUp = (event: KeyboardEvent) => this.walker?.release(event.code);

  private releaseKeys = () => this.walker?.releaseAll();

  private stopListening() {
    window.removeEventListener("keydown", this.keyDown);
    window.removeEventListener("keyup", this.keyUp);
    window.removeEventListener("blur", this.releaseKeys);
    this.walker?.releaseAll();
  }

  private drawHighlights() {
    this.overlay.clear();
    const { hover, selected } = this.highlighted;
    const wanted = new Set([...selected, ...(hover === null ? [] : [hover])]);
    const pieces = new Map((this.shown ?? []).filter((p) => wanted.has(p.id)).map((p) => [p.id, p]));
    const add = (id: number, materials: THREE.Material[], outline: THREE.LineBasicMaterial) => {
      const piece = pieces.get(id);
      const batch = piece && this.batches.get(`${piece.part}:${piece.color}`);
      if (!piece || !batch || piece.step > this.visibleStep) return;
      const matrix = pieceMatrix(piece, new THREE.Matrix4());
      const box = new THREE.LineSegments(this.outlineBox, outline);
      const center = batch.bounds.getCenter(new THREE.Vector3());
      const size = batch.bounds.getSize(new THREE.Vector3()).addScalar(2);
      box.matrixAutoUpdate = false;
      box.matrix.multiplyMatrices(matrix, new THREE.Matrix4().compose(center, new THREE.Quaternion(), size));
      box.renderOrder = 2;
      this.overlay.add(box);
      batch.template.traverse((source) => {
        if (!(source instanceof THREE.Mesh)) return;
        for (const material of materials) {
          const tint = new THREE.Mesh(source.geometry, material);
          tint.matrixAutoUpdate = false;
          tint.matrix.multiplyMatrices(matrix, source.matrixWorld);
          tint.renderOrder = 1;
          this.overlay.add(tint);
        }
      });
    };
    const tint = this.options.marks !== "outline";
    if (hover !== null && !selected.includes(hover)) add(hover, tint ? [this.marks.hover] : [], this.outlines.hover);
    for (const id of selected) add(id, tint ? [this.marks.selected, this.marks.through] : [], this.outlines.selected);
    this.dirty = true;
  }

  /** Frame the model from `view`; `smooth` eases the camera there instead of cutting. */
  frameView(view: View, width: number, depth: number, smooth = false) {
    this.framing = { view, width, depth };
    if (this.walking) return;
    const from = [this.camera.position.clone(), this.controls.target.clone()];
    this.aim(VIEW_DIRECTIONS[view], width, depth);
    this.glide = null;
    if (!smooth) return;
    this.glide = { from, to: [this.camera.position.clone(), this.controls.target.clone()], start: performance.now() };
    this.ease();
  }

  private ease() {
    if (!this.glide) return;
    const { from, to, start } = this.glide;
    const t = Math.min(1, (performance.now() - start) / GLIDE_MS);
    const eased = 1 - (1 - t) ** 3;
    this.camera.position.lerpVectors(from[0], to[0], eased);
    this.controls.target.lerpVectors(from[1], to[1], eased);
    if (t === 1) this.glide = null;
    this.dirty = true;
  }

  /** Point the camera along `direction` so the whole model (or the empty baseplate, or `focus`) fills the frame, then close in `zoom` times on `at`. */
  private aim(
    direction: THREE.Vector3,
    width: number,
    depth: number,
    zoom = 1,
    at?: THREE.Vector3,
    focus?: THREE.Box3,
  ) {
    const box = focus ? focus.clone() : this.modelBox();
    if (box.isEmpty()) {
      box.set(new THREE.Vector3(0, 0, -depth * 20), new THREE.Vector3(width * 20, 40, 0));
    }
    // A view framed by the app always uses the orbit lens, even right after a walk kept the wider one.
    this.camera.fov = FOV.orbit;
    const center = box.getCenter(new THREE.Vector3());
    direction = direction.clone().normalize();
    this.camera.position.copy(center).add(direction);
    this.camera.lookAt(center);
    this.camera.updateMatrixWorld();
    const tanY = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const tanX = tanY * this.camera.aspect;
    let distance = 0;
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z]) {
          const p = new THREE.Vector3(x, y, z).applyMatrix4(this.camera.matrixWorldInverse);
          const depth = p.z + 1;
          distance = Math.max(distance, depth + Math.abs(p.x) / tanX, depth + Math.abs(p.y) / tanY);
        }
    distance *= 1.04 / zoom;
    const target = at ?? center;
    this.camera.position.copy(target).addScaledVector(direction, distance);
    this.camera.near = distance / 100;
    this.camera.far = distance * 100;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(target);
    this.controls.update();
    this.dirty = true;
  }

  /** Square renders of the whole model, or only of what lies in `box`, as a JPEG, leaving the user's camera and timeline untouched. */
  private offscreen(...args: Parameters<BrickScene["paint"]>): Promise<Blob | null> {
    const canvas = backed(this.paint(...args));
    return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", RENDER_QUALITY));
  }

  /**
   * Square renders into a transparent 2D canvas, leaving the user's camera and timeline untouched: the whole model, or
   * only what lies in `box`; with `page`, only the steps shown and their highlights, as an instructions page.
   */
  private paint(
    size: number,
    tiles: {
      direction: THREE.Vector3;
      zoom?: number;
      at?: THREE.Vector3;
      focus?: THREE.Box3;
      x: number;
      y: number;
      label?: string;
    }[],
    columns = 1,
    box: Box | null = null,
    page = false,
  ): HTMLCanvasElement {
    const focus = box ? worldBox(box) : undefined;
    const { position, near, far } = this.camera;
    const saved = {
      position: position.clone(),
      quaternion: this.camera.quaternion.clone(),
      target: this.controls.target.clone(),
      near,
      far,
      fov: this.camera.fov,
    };
    const pixelRatio = this.renderer.getPixelRatio();
    const visibleStep = this.visibleStep;
    const canvas = document.createElement("canvas");
    canvas.width = size * columns;
    canvas.height = size * Math.ceil(tiles.length / columns);
    const ctx = canvas.getContext("2d")!;

    try {
      if (this.placement) for (const batch of this.batches.values()) batch.pose(0, Infinity);
      if (!page) {
        this.overlay.visible = false;
        this.showStep(Infinity);
      }
      this.renderer.clippingPlanes = focus ? clippingPlanes(focus) : [];
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(size * 2, size * 2, false);
      this.light(SHEET_LIGHT);
      this.camera.aspect = 1;
      for (const tile of tiles) {
        this.aim(tile.direction, 32, 32, tile.zoom, tile.at, tile.focus ?? focus);
        this.adaptEdges(size);
        this.renderer.render(this.scene, this.camera);
        ctx.drawImage(this.renderer.domElement, tile.x, tile.y, size, size);
        if (tile.label) {
          ctx.font = "600 15px system-ui, sans-serif";
          ctx.fillStyle = "#1c1c26";
          ctx.fillText(tile.label, tile.x + 10, tile.y + 22);
          ctx.strokeStyle = "#d8d8e2";
          ctx.strokeRect(tile.x + 0.5, tile.y + 0.5, size - 1, size - 1);
        }
      }
    } finally {
      this.showStep(visibleStep);
      this.posePlacement();
      this.renderer.clippingPlanes = [];
      this.renderer.setPixelRatio(pixelRatio);
      this.resize();
      Object.assign(this.camera, { near: saved.near, far: saved.far, fov: saved.fov });
      this.camera.position.copy(saved.position);
      this.camera.updateProjectionMatrix();
      this.controls.target.copy(saved.target);
      this.controls.update();
      if (this.walking) this.camera.quaternion.copy(saved.quaternion);
      this.overlay.visible = true;
      this.draw();
    }
    return canvas;
  }

  /** An instructions page: the steps shown with their highlights, from the 3/4 front, framing `focus` (world space). */
  page(size: number, focus: THREE.Box3): HTMLCanvasElement {
    return backed(this.paint(size, [{ direction: VIEW_DIRECTIONS.iso, focus, x: 0, y: 0 }], 1, null, true));
  }

  /** The user's view as they see it, on the viewer's backdrop. */
  image(): Promise<Blob | null> {
    if (this.placement) for (const batch of this.batches.values()) batch.pose(0, Infinity);
    this.overlay.visible = false;
    this.shadowsStale = true;
    this.draw(true);
    this.overlay.visible = true;
    this.dirty = true;
    const source = this.renderer.domElement;
    const canvas = document.createElement("canvas");
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = getComputedStyle(this.container).backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0);
    this.posePlacement();
    return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  }

  /** A library tile: the 3/4 view as a PNG with a transparent background, so it sits on either theme. */
  thumbnail(size = 320): Promise<Blob | null> {
    const canvas = this.paint(size, [{ direction: VIEW_DIRECTIONS.iso, x: 0, y: 0 }]);
    return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  }

  /** The four labelled views a builder looks at to check its work, of the model or only of `box`. */
  sheet(box: Box | null = null, size = 384): Promise<Blob | null> {
    const tiles = SHEET.map((s, i) => ({
      direction: VIEW_DIRECTIONS[s.view],
      label: s.label,
      x: (i % 2) * size,
      y: Math.floor(i / 2) * size,
    }));
    return this.offscreen(size, tiles, 2, box);
  }

  /** The one view a builder asks for, with the build's x and y in studs and z in plates. */
  view(camera: Camera, box: Box | null = null, size = 768): Promise<Blob | null> {
    const at = camera.at
      ? new THREE.Vector3(camera.at[0] * STUD, camera.at[2] * PLATE, -camera.at[1] * STUD)
      : undefined;
    const tile = { direction: towardCamera(camera.angle, camera.elevation), zoom: camera.zoom, at, x: 0, y: 0 };
    return this.offscreen(size, [tile], 1, box);
  }
}
