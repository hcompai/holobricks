import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { LDrawLoader } from "three/examples/jsm/loaders/LDrawLoader.js";
import { LDrawConditionalLineMaterial } from "three/examples/jsm/materials/LDrawConditionalLineMaterial.js";
import { api, type Piece } from "./api";

export type View = "iso" | "front" | "top";

const VIEW_DIRECTIONS: Record<View, THREE.Vector3> = {
  iso: new THREE.Vector3(1, 0.85, 1.25).normalize(),
  front: new THREE.Vector3(0, 0.25, 1).normalize(),
  top: new THREE.Vector3(0, 1, 0.001).normalize(),
};

/** Three.js scene holding LDraw pieces; each part+color is fetched and parsed once, then cloned per piece. */
export class BrickScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(35, 1, 1, 100000);
  private controls: OrbitControls;
  private loader = new LDrawLoader();
  private root = new THREE.Group();
  private objects = new Map<number, THREE.Object3D>();
  private steps = new Map<number, number>();
  private templates = new Map<string, Promise<THREE.Group>>();
  private materials: Promise<void>;
  private visibleStep = Infinity;
  private resizeObserver: ResizeObserver;
  private frame = 0;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0xf3f3f1);
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
    this.controls.autoRotateSpeed = 1.2;

    this.loader.smoothNormals = true;
    this.loader.setConditionalLineMaterial(LDrawConditionalLineMaterial);
    this.materials = this.loader.preloadMaterials("/api/ldconfig");

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
  }

  private template(part: string, color: number): Promise<THREE.Group> {
    const key = `${part}:${color}`;
    let template = this.templates.get(key);
    if (!template) {
      template = this.materials
        .then(() => fetch(api.partUrl(part, color)))
        .then((r) => r.text())
        .then((text) => new Promise<THREE.Group>((resolve, reject) => this.loader.parse(text, resolve, reject)));
      this.templates.set(key, template);
    }
    return template;
  }

  /** Show exactly these pieces: new ones are loaded and added, missing ones removed. */
  async setPieces(pieces: Piece[]): Promise<void> {
    const wanted = new Set(pieces.map((p) => p.id));
    for (const [id, object] of this.objects) {
      if (!wanted.has(id)) {
        this.root.remove(object);
        this.objects.delete(id);
        this.steps.delete(id);
      }
    }
    const fresh = pieces.filter((p) => !this.steps.has(p.id));
    for (const p of fresh) this.steps.set(p.id, p.step);
    await Promise.all(
      fresh.map(async (p) => {
        const object = (await this.template(p.part, p.color)).clone();
        const [a, b, c, d, e, f, g, h, i] = p.rot;
        object.matrixAutoUpdate = false;
        object.matrix.set(a, b, c, p.pos[0], d, e, f, p.pos[1], g, h, i, p.pos[2], 0, 0, 0, 1);
        object.visible = p.step <= this.visibleStep;
        if (this.steps.has(p.id)) {
          this.objects.set(p.id, object);
          this.root.add(object);
        }
      }),
    );
  }

  setVisibleStep(step: number) {
    this.visibleStep = step;
    for (const [id, object] of this.objects) object.visible = (this.steps.get(id) ?? 0) <= step;
  }

  setSpin(spin: boolean) {
    this.controls.autoRotate = spin;
  }

  /** Point the camera along `view` so the visible pieces (or the empty baseplate) fill the frame. */
  frameView(view: View, width: number, depth: number) {
    const box = new THREE.Box3();
    for (const object of this.objects.values()) if (object.visible) box.expandByObject(object);
    if (box.isEmpty()) {
      box.set(new THREE.Vector3(0, 0, -depth * 20), new THREE.Vector3(width * 20, 40, 0));
    }
    const center = box.getCenter(new THREE.Vector3());
    const radius = box.getSize(new THREE.Vector3()).length() / 2;
    const halfFov = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const fitHeight = radius / Math.tan(halfFov);
    const fitWidth = radius / (Math.tan(halfFov) * this.camera.aspect);
    const distance = Math.max(fitHeight, fitWidth) * 0.72;
    this.camera.position.copy(center).addScaledVector(VIEW_DIRECTIONS[view], distance);
    this.camera.near = distance / 100;
    this.camera.far = distance * 100;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.update();
  }

  /** A square iso render of the whole model, leaving the user's camera untouched. */
  thumbnail(size = 320): Promise<Blob | null> {
    const { position, near, far } = this.camera;
    const saved = { position: position.clone(), target: this.controls.target.clone(), near, far };
    const pixelRatio = this.renderer.getPixelRatio();
    const visibleStep = this.visibleStep;

    this.setVisibleStep(Infinity);
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(size * 2, size * 2, false);
    this.camera.aspect = 1;
    this.frameView("iso", 32, 32);
    this.renderer.render(this.scene, this.camera);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    canvas.getContext("2d")!.drawImage(this.renderer.domElement, 0, 0, size, size);

    this.setVisibleStep(visibleStep);
    this.renderer.setPixelRatio(pixelRatio);
    this.resize();
    Object.assign(this.camera, { near: saved.near, far: saved.far });
    this.camera.position.copy(saved.position);
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(saved.target);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  }
}
