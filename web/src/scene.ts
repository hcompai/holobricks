import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { LDrawLoader } from "three/examples/jsm/loaders/LDrawLoader.js";
import { LDrawConditionalLineMaterial } from "three/examples/jsm/materials/LDrawConditionalLineMaterial.js";
import { api, type Box, type Camera, type Piece } from "./api";

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

const BACKDROP = "#f6f6f9";
const STUD = 20;
const PLATE = 8;

/** From the model toward a camera seen from compass `angle` (0 front, 90 right) and `elevation` degrees up. */
function towardCamera(angle: number, elevation: number): THREE.Vector3 {
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

const lineMaterials = new WeakMap<THREE.Material, THREE.Material>();

/** A copy of an edge material that reads each instance's transform from the instanceMatrix attribute. */
function instancedLine(material: THREE.Material): THREE.Material {
  let copy = lineMaterials.get(material);
  if (!copy) {
    copy = material.clone();
    copy.defines = { ...copy.defines, USE_INSTANCING: "" };
    if (copy instanceof THREE.ShaderMaterial) {
      copy.clipping = true;
      copy.vertexShader = copy.vertexShader.replace(
        /vec4\( (position|control0|control1|position \+ direction), 1\.0 \)/g,
        "instanceMatrix * $&",
      );
    }
    lineMaterials.set(material, copy);
  }
  return copy;
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

/** Every piece of one part+color, one instanced draw per template sub-mesh, ordered by step so a count hides later steps. */
class Batch {
  private pieces: Piece[] = [];
  private objects: Instanced[] = [];
  private capacity = 0;
  private visible = 0;
  private bounds: THREE.Box3;

  constructor(
    private template: THREE.Group,
    private root: THREE.Group,
  ) {
    template.updateMatrixWorld(true);
    this.bounds = new THREE.Box3().setFromObject(template);
  }

  set(pieces: Piece[], step: number) {
    this.pieces = [...pieces].sort((a, b) => a.step - b.step || a.id - b.id);
    if (this.pieces.length > this.capacity) this.allocate(2 ** Math.ceil(Math.log2(this.pieces.length)));
    const matrix = new THREE.Matrix4();
    const world = new THREE.Matrix4();
    this.pieces.forEach((p, i) => {
      pieceMatrix(p, matrix);
      for (const o of this.objects) world.multiplyMatrices(matrix, o.local).toArray(o.matrices.array, i * 16);
    });
    for (const o of this.objects) o.matrices.needsUpdate = true;
    this.show(step);
  }

  show(step: number) {
    this.visible = this.pieces.findIndex((p) => p.step > step);
    if (this.visible < 0) this.visible = this.pieces.length;
    for (const { object } of this.objects) {
      if (object instanceof THREE.InstancedMesh) object.count = this.visible;
      else (object.geometry as THREE.InstancedBufferGeometry).instanceCount = this.visible;
    }
  }

  /** Grow `target` by every piece, in the root's local space. */
  expand(target: THREE.Box3) {
    const matrix = new THREE.Matrix4();
    const box = new THREE.Box3();
    for (const p of this.pieces) target.union(box.copy(this.bounds).applyMatrix4(pieceMatrix(p, matrix)));
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
        const mesh = new THREE.InstancedMesh(source.geometry, source.material, capacity);
        object = mesh;
        matrices = mesh.instanceMatrix;
      } else {
        const geometry = new THREE.InstancedBufferGeometry();
        geometry.index = source.geometry.index;
        for (const name in source.geometry.attributes) geometry.setAttribute(name, source.geometry.getAttribute(name));
        for (const group of source.geometry.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
        matrices = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 16), 16);
        geometry.setAttribute("instanceMatrix", matrices);
        const material = Array.isArray(source.material)
          ? source.material.map(instancedLine)
          : instancedLine(source.material);
        object = new THREE.LineSegments(geometry, material);
      }
      object.frustumCulled = false;
      object.matrixAutoUpdate = false;
      this.objects.push({ object, local: source.matrixWorld.clone(), matrices });
      this.root.add(object);
    });
  }
}

/** Three.js scene holding LDraw pieces; each part+color is fetched and parsed once, then drawn instanced. */
export class BrickScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(35, 1, 1, 100000);
  private controls: OrbitControls;
  private loader = new LDrawLoader();
  private root = new THREE.Group();
  private batches = new Map<string, Batch>();
  private parts = new Map<string, Promise<string>>();
  private templates = new Map<string, Promise<THREE.Group>>();
  private materials: Promise<void>;
  private visibleStep = Infinity;
  private loading: Promise<void> = Promise.resolve();
  /** Set once the user orbits or zooms, so live framing stops fighting them. */
  userMoved = false;
  private resizeObserver: ResizeObserver;
  private frame = 0;
  private framing: { view: View; width: number; depth: number } = { view: "iso", width: 32, depth: 32 };

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    container.appendChild(this.renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(0.5, 1, 0.8);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x6f6f6f, 0.5), sun);

    this.root.rotation.x = Math.PI;
    this.scene.add(this.root);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.addEventListener("start", () => (this.userMoved = true));
    this.controls.autoRotateSpeed = 1.2;

    this.loader.smoothNormals = true;
    this.loader.setConditionalLineMaterial(LDrawConditionalLineMaterial);
    this.materials = this.loader.preloadMaterials(api.ldconfigUrl);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.frameView("iso", 32, 32);
    const tick = () => {
      this.frame = requestAnimationFrame(tick);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    tick();
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (!this.userMoved) this.frameView(this.framing.view, this.framing.width, this.framing.depth);
  }

  /** The packed part places it in main color 16 on its second line; each color gets its own parsed copy. */
  private template(part: string, color: number): Promise<THREE.Group> {
    const key = `${part}:${color}`;
    let template = this.templates.get(key);
    if (!template) {
      let text = this.parts.get(part);
      if (!text) {
        text = fetch(api.partUrl(part)).then((r) => r.text());
        this.parts.set(part, text);
      }
      template = Promise.all([text, this.materials]).then(
        ([packed]) =>
          new Promise<THREE.Group>((resolve, reject) =>
            this.loader.parse(packed.replace("\n1 16 ", `\n1 ${color} `), resolve, reject),
          ),
      );
      this.templates.set(key, template);
    }
    return template;
  }

  /** Show exactly these pieces; calls apply in order, and each resolves once its pieces are drawn. */
  setPieces(pieces: Piece[]): Promise<void> {
    this.loading = this.loading.catch(() => undefined).then(() => this.apply(pieces));
    return this.loading;
  }

  private async apply(pieces: Piece[]) {
    const groups = new Map<string, Piece[]>();
    for (const p of pieces) {
      const key = `${p.part}:${p.color}`;
      const group = groups.get(key);
      if (group) group.push(p);
      else groups.set(key, [p]);
    }
    const templates = await Promise.all(
      [...groups.values()].map(([p]) =>
        this.template(p.part, p.color).catch((error) => {
          console.error(`Could not load ${p.part} in color ${p.color}`, error);
          return null;
        }),
      ),
    );
    for (const [key, batch] of this.batches) {
      if (groups.has(key)) continue;
      batch.dispose();
      this.batches.delete(key);
    }
    [...groups].forEach(([key, group], i) => {
      const template = templates[i];
      if (!template) return;
      let batch = this.batches.get(key);
      if (!batch) this.batches.set(key, (batch = new Batch(template, this.root)));
      batch.set(group, this.visibleStep);
    });
  }

  setVisibleStep(step: number) {
    this.visibleStep = step;
    for (const batch of this.batches.values()) batch.show(step);
  }

  setSpin(spin: boolean) {
    this.controls.autoRotate = spin;
  }

  frameView(view: View, width: number, depth: number) {
    this.framing = { view, width, depth };
    this.aim(VIEW_DIRECTIONS[view], width, depth);
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
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    if (focus) box.copy(focus);
    else {
      for (const batch of this.batches.values()) batch.expand(box);
      box.applyMatrix4(this.root.matrixWorld);
    }
    if (box.isEmpty()) {
      box.set(new THREE.Vector3(0, 0, -depth * 20), new THREE.Vector3(width * 20, 40, 0));
    }
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
  }

  /** Square renders of the whole model, or only of what lies in `box`, into a 2D canvas, leaving the user's camera and timeline untouched. */
  private offscreen(
    size: number,
    tiles: { direction: THREE.Vector3; zoom?: number; at?: THREE.Vector3; x: number; y: number; label?: string }[],
    columns = 1,
    box: Box | null = null,
  ) {
    const focus = box ? worldBox(box) : undefined;
    const { position, near, far } = this.camera;
    const saved = { position: position.clone(), target: this.controls.target.clone(), near, far };
    const pixelRatio = this.renderer.getPixelRatio();
    const visibleStep = this.visibleStep;
    const canvas = document.createElement("canvas");
    canvas.width = size * columns;
    canvas.height = size * Math.ceil(tiles.length / columns);
    const ctx = canvas.getContext("2d")!;

    this.setVisibleStep(Infinity);
    this.renderer.clippingPlanes = focus ? clippingPlanes(focus) : [];
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(size * 2, size * 2, false);
    this.camera.aspect = 1;
    for (const tile of tiles) {
      this.aim(tile.direction, 32, 32, tile.zoom, tile.at, focus);
      this.renderer.render(this.scene, this.camera);
      ctx.fillStyle = BACKDROP;
      ctx.fillRect(tile.x, tile.y, size, size);
      ctx.drawImage(this.renderer.domElement, tile.x, tile.y, size, size);
      if (tile.label) {
        ctx.font = "600 15px system-ui, sans-serif";
        ctx.fillStyle = "#1c1c26";
        ctx.fillText(tile.label, tile.x + 10, tile.y + 22);
        ctx.strokeStyle = "#d8d8e2";
        ctx.strokeRect(tile.x + 0.5, tile.y + 0.5, size - 1, size - 1);
      }
    }

    this.setVisibleStep(visibleStep);
    this.renderer.clippingPlanes = [];
    this.renderer.setPixelRatio(pixelRatio);
    this.resize();
    Object.assign(this.camera, { near: saved.near, far: saved.far });
    this.camera.position.copy(saved.position);
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(saved.target);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  }

  thumbnail(size = 320): Promise<Blob | null> {
    return this.offscreen(size, [{ direction: VIEW_DIRECTIONS.iso, x: 0, y: 0 }]);
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
