import { useEffect, useState } from "react";
import * as THREE from "three";
import { LDrawLoader } from "three/examples/jsm/loaders/LDrawLoader.js";
import { LDrawConditionalLineMaterial } from "three/examples/jsm/materials/LDrawConditionalLineMaterial.js";
import { paletteFile } from "./palette";

/** Pixels per side; tiles show it at half size for sharp edges on high-density screens. */
const SIZE = 128;
const VIEW = new THREE.Vector3(1, 0.85, 1.25).normalize();

/** One small renderer for every preview, so a long list of parts costs a single WebGL context. */
class Previewer {
  private renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  private loader = new LDrawLoader();
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 1, 10000);
  private materials: Promise<void>;

  constructor() {
    this.renderer.setSize(SIZE, SIZE, false);
    this.renderer.setClearColor(0, 0);
    this.loader.smoothNormals = true;
    this.loader.setConditionalLineMaterial(LDrawConditionalLineMaterial);
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(-0.5, 1, 0.8);
    this.scene.add(sun, new THREE.HemisphereLight(0xffffff, 0x777777, 1.6));
    this.materials = paletteFile().then(async (text) => {
      const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
      try {
        await this.loader.preloadMaterials(url);
      } finally {
        URL.revokeObjectURL(url);
      }
    });
  }

  async render(pack: string, color: number): Promise<string> {
    await this.materials;
    const group = await new Promise<THREE.Group>((resolve, reject) =>
      this.loader.parse(pack.replace("\n1 16 ", `\n1 ${color} `), resolve, reject),
    );
    // LDraw's y points down.
    group.rotation.x = Math.PI;
    this.scene.add(group);
    try {
      const box = new THREE.Box3().setFromObject(group);
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const distance = sphere.radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2));
      this.camera.position.copy(sphere.center).addScaledVector(VIEW, distance);
      this.camera.lookAt(sphere.center);
      this.camera.near = distance / 10;
      this.camera.far = distance * 10;
      this.camera.updateProjectionMatrix();
      this.renderer.render(this.scene, this.camera);
      return this.renderer.domElement.toDataURL("image/png");
    } finally {
      this.scene.remove(group);
      group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
  }
}

let previewer: Previewer | null = null;
const previews = new Map<string, Promise<string | null>>();
/** Previews draw one at a time, in the order asked. */
let queue: Promise<unknown> = Promise.resolve();

/** A picture of `part` in `color`, seen from the front right, as a data URL; null if it cannot be drawn. */
export function partPreview(part: string, pack: string, color: number): Promise<string | null> {
  const key = `${part}:${color}`;
  let preview = previews.get(key);
  if (!preview) {
    preview = queue.then(() => (previewer ??= new Previewer()).render(pack, color)).catch(() => null);
    queue = preview;
    previews.set(key, preview);
  }
  return preview;
}

/** The preview once drawn, null until then. */
export function usePartPreview(part: string, pack: string | undefined, color: number): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    setSrc(null);
    if (!pack) return;
    let current = true;
    void partPreview(part, pack, color).then((url) => current && setSrc(url));
    return () => {
      current = false;
    };
  }, [part, pack, color]);
  return src;
}
