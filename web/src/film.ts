import * as THREE from "three";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { HorizontalTiltShiftShader } from "three/examples/jsm/shaders/HorizontalTiltShiftShader.js";
import { VerticalTiltShiftShader } from "three/examples/jsm/shaders/VerticalTiltShiftShader.js";
import type { Build, Piece } from "./api";
import {
  DROP,
  fall,
  filmSteps,
  frameCount,
  HOLO_MODEL,
  landed,
  planFilm,
  started,
  type FilmOptions,
  type FilmPlan,
  type FilmStep,
} from "./filmPlan";
import { BrickScene, towardCamera, type Motion } from "./scene";

const FONT = '"Plus Jakarta Sans Variable", system-ui, sans-serif';
const BACKDROP = "#eceef3";
const SHADE = "236, 238, 243";
const INK = "#1c1c26";
const MUTED = "#5d5d6c";
const ACCENT = "#f76808";
const FOV = 28;
/** Share of the frame's height kept clear of the model for the lower third. */
const CAPTION = 0.17;
const MARGIN = 1.08;
const HERO_ANGLE = 35;
const ORBIT_DEGREES = 55;
const ELEVATION = { start: 36, end: 21 };
const LOOKAHEAD_S = 1.2;
const SMOOTH_S = 0.9;
/** The smallest framing, as a share of the finished model's, so the first bricks are not shot in macro. */
const CLOSEST = 0.42;
const TILT = THREE.MathUtils.degToRad(10);
/** Angular radius of the key light, which sets how fast shadows soften with distance. */
const SUN_RADIUS = 0.05;
const LIGHT = { azimuth: -55, elevation: 52, sun: 2.3, shadow: 0.92, sky: 0.45, environment: 0.5 };
const SHADOW_MAP = 4096;
const MSAA = 4;
/** Hold a step's title on screen at least this long, so fast steps do not flicker. */
const CAPTION_MIN_S = 0.9;
const FADE_S = 0.25;
/** Frames timed to estimate a film's cost, as shares of it: early frames show fewer pieces. */
const CALIBRATION = [0.2, 0.45, 0.7, 1];

interface Pose {
  position: THREE.Vector3;
  target: THREE.Vector3;
  distance: number;
  azimuth: number;
}

/** Element `i` of the base-`base` Van der Corput sequence, in [0, 1). */
function halton(i: number, base: number): number {
  let result = 0;
  let f = 1 / base;
  for (let n = i + 1; n > 0; n = Math.floor(n / base), f /= base) result += f * (n % base);
  return result;
}

/** A stable pseudo-random number in [0, 1) for `n`. */
function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 2 ** 32;
}

/** Glossy ABS for regular colors and clear acrylic for transparent ones; other LDraw finishes keep their look. */
function plastic(cache: Map<THREE.Material, THREE.Material>) {
  return (source: THREE.Material): THREE.Material => {
    if (!(source instanceof THREE.MeshStandardMaterial)) return source;
    const regular = source.metalness === 0 && source.roughness === 0.3;
    if (!regular && !source.transparent) return source;
    let material = cache.get(source);
    if (!material) {
      const physical = new THREE.MeshPhysicalMaterial();
      THREE.MeshStandardMaterial.prototype.copy.call(physical, source);
      physical.defines = { STANDARD: "", PHYSICAL: "" };
      Object.assign(physical, { roughness: 0.34, clearcoat: 0.12, clearcoatRoughness: 0.3, specularIntensity: 0.5 });
      if (source.transparent) {
        Object.assign(physical, { transmission: 1, thickness: 8, roughness: 0.08, opacity: 1 });
        Object.assign(physical, { transparent: false, depthWrite: true });
      }
      cache.set(source, (material = physical));
    }
    return material;
  };
}

/** Evenly spread unit vectors, along which a hull keeps its farthest points. */
const HULL = Array.from({ length: 128 }, (_, i) => {
  const y = 1 - (2 * i + 1) / 128;
  const r = Math.sqrt(1 - y * y);
  const phi = i * Math.PI * (3 - Math.sqrt(5));
  return new THREE.Vector3(r * Math.cos(phi), y, r * Math.sin(phi));
});

/** The farthest corners of a growing set of boxes along each HULL direction: a cheap stand-in for its convex hull. */
class Hull {
  private reach = new Float64Array(HULL.length).fill(-Infinity);
  readonly points = HULL.map(() => new THREE.Vector3());
  readonly box = new THREE.Box3();

  add(box: THREE.Box3) {
    if (box.isEmpty()) return;
    this.box.union(box);
    const corner = new THREE.Vector3();
    for (let c = 0; c < 8; c++) {
      corner.set(c & 1 ? box.max.x : box.min.x, c & 2 ? box.max.y : box.min.y, c & 4 ? box.max.z : box.min.z);
      HULL.forEach((direction, k) => {
        const reach = corner.dot(direction);
        if (reach > this.reach[k]) {
          this.reach[k] = reach;
          this.points[k].copy(corner);
        }
      });
    }
  }
}

/**
 * The target and distance along `direction` that fit every point in a view with half-extents `tanX` and `tanY`
 * at unit depth, centering the points' silhouette.
 */
function fit(points: THREE.Vector3[], direction: THREE.Vector3, tanX: number, tanY: number) {
  const z = direction;
  const x = new THREE.Vector3().crossVectors(THREE.Object3D.DEFAULT_UP, z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  let [right, left, top, bottom] = [-Infinity, -Infinity, -Infinity, -Infinity];
  for (const p of points) {
    const [px, py, pz] = [p.dot(x), p.dot(y), p.dot(z)];
    right = Math.max(right, pz + px / tanX);
    left = Math.max(left, pz - px / tanX);
    top = Math.max(top, pz + py / tanY);
    bottom = Math.max(bottom, pz - py / tanY);
  }
  const target = new THREE.Vector3()
    .addScaledVector(x, (tanX * (right - left)) / 2)
    .addScaledVector(y, (tanY * (top - bottom)) / 2);
  return { target, distance: Math.max(right + left, top + bottom) / 2 };
}

/** A centered moving average over `radius` entries on each side, clamped at the ends. */
function smooth(values: number[], radius: number): number[] {
  const prefix = [0];
  for (const v of values) prefix.push(prefix[prefix.length - 1] + v);
  return values.map((_, i) => {
    const lo = Math.max(0, i - radius);
    const hi = Math.min(values.length, i + radius + 1);
    return (prefix[hi] - prefix[lo]) / (hi - lo);
  });
}

function quad(shader: { uniforms: Record<string, THREE.IUniform>; vertexShader: string; fragmentShader: string }) {
  return new FullScreenQuad(
    new THREE.ShaderMaterial({ ...shader, uniforms: THREE.UniformsUtils.clone(shader.uniforms) }),
  );
}

/** Renders a build's film frame by frame, offline: frame `i` depends only on the build, the options and `i`. */
export class FilmRenderer {
  private scene: BrickScene;
  private ctx: CanvasRenderingContext2D;
  private materials = new Map<THREE.Material, THREE.Material>();
  /** Every piece with its fall order as its step, so the scene's step count reveals them in order. */
  private ranked: Piece[];
  private boxes: THREE.Box3[] = [];
  private final = new Hull();
  private ground: THREE.Mesh;
  private options!: FilmOptions;
  private plan!: FilmPlan;
  private poses: Pose[] = [];
  private captions: FilmStep[] = [];
  private targets: THREE.WebGLRenderTarget[] = [];
  private ao: GTAOPass | null = null;
  private output = new OutputPass();
  private blend = new FullScreenQuad(
    new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, weight: { value: 1 } },
      vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
      fragmentShader:
        "uniform sampler2D tDiffuse; uniform float weight; varying vec2 vUv; void main() { gl_FragColor = texture2D(tDiffuse, vUv) * weight; }",
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      depthTest: false,
      depthWrite: false,
    }),
  );
  private tiltX = quad(HorizontalTiltShiftShader);
  private tiltY = quad(VerticalTiltShiftShader);

  constructor(
    private build: Build,
    readonly canvas: HTMLCanvasElement,
    signal: AbortSignal,
  ) {
    this.ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    this.ranked = filmSteps(build.pieces)
      .flat()
      .map((p, rank) => ({ ...p, step: rank }));
    this.scene = new BrickScene(document.createElement("div"), {
      interactive: false,
      signal,
      material: plastic(this.materials),
    });
    const { renderer, scene, sun } = this.scene;
    renderer.autoClear = false;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.05;
    sun.shadow.mapSize.setScalar(SHADOW_MAP);
    sun.shadow.radius = 2;
    scene.background = new THREE.Color(BACKDROP);
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.ShadowMaterial({ color: INK, opacity: 0.3 }),
    );
    this.ground.receiveShadow = true;
    scene.add(this.ground);
  }

  /** Load every part; rejects when any is missing, so a film never shows a partial model. */
  async prepare() {
    await Promise.all([
      this.scene.setPieces(this.ranked),
      document.fonts.load(`800 30px ${FONT}`),
      document.fonts.load(`700 16px ${FONT}`),
    ]);
    this.boxes = this.scene.stepBoxes();
    this.final = new Hull();
    for (const box of this.boxes) this.final.add(box);
    const sphere = this.final.box.getBoundingSphere(new THREE.Sphere());
    this.ground.scale.setScalar(sphere.radius * 400);
    this.ground.position.set(sphere.center.x, this.final.box.min.y, sphere.center.z);
  }

  get frames(): number {
    return frameCount(this.options);
  }

  get samples(): number {
    return this.options.samples;
  }

  configure(options: FilmOptions) {
    this.options = { ...options };
    this.plan = planFilm(this.build, options.seconds);
    const { width, height } = options;
    this.canvas.width = width;
    this.canvas.height = height;
    this.scene.setSize(width, height);
    for (const target of this.targets) target.dispose();
    this.ao?.dispose();
    const target = (samples = 0) => new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, samples });
    this.targets = [target(MSAA), target(), target(), target()];
    this.ao = new GTAOPass(this.scene.scene, this.scene.camera, width, height);
    const noise = this.ao.pdNoiseTexture.image.data as Uint8Array;
    for (let k = 0; k < noise.length; k++) noise[k] = Math.floor(hash(k) * 256);
    this.ao.pdNoiseTexture.needsUpdate = true;
    this.ao.blendIntensity = 0.85;
    this.ao.updatePdMaterial({ radius: 6, rings: 2, samples: 16 });
    this.poses = this.track();
    this.captions = [];
    for (const step of this.plan.steps) {
      const shown = this.captions[this.captions.length - 1];
      if (!shown || step.start - shown.start >= CAPTION_MIN_S) this.captions.push(step);
    }
  }

  /** Set the most samples per frame whose estimated render time fits `budgetMs` for the whole film. */
  calibrate(budgetMs: number, most = 32): number {
    const probes = CALIBRATION.map((share) => Math.round(share * (this.frames - 1)));
    const cost = (samples: number) =>
      probes.reduce((sum, frame) => {
        const start = performance.now();
        this.pixels(frame, samples);
        return sum + performance.now() - start;
      }, 0) / probes.length;
    const perFrame = budgetMs / this.frames;
    cost(4);
    const one = cost(1);
    const perSample = Math.max((cost(4) - one) / 3, 0.1);
    let samples = Math.min(Math.max(Math.floor((perFrame - one + perSample) / perSample), 1), most);
    for (let measured = cost(samples); samples > 1 && measured > perFrame; measured = cost(samples))
      samples = Math.max(Math.min(samples - 1, Math.floor((samples * perFrame) / measured)), 1);
    this.options.samples = samples;
    return samples;
  }

  /** How many pieces land during each frame. */
  landings(): number[] {
    const { fps } = this.options;
    return Array.from({ length: this.frames }, (_, i) =>
      i === 0 ? landed(this.plan, 0) : landed(this.plan, i / fps) - landed(this.plan, (i - 1) / fps),
    );
  }

  /** Draw frame `i` into the canvas. */
  render(i: number, samples = this.options.samples): HTMLCanvasElement {
    if (this.scene.renderer.getContext().isContextLost()) throw new Error("The WebGL context was lost.");
    const time = i / this.options.fps;
    const count = started(this.plan, time);
    this.scene.setVisibleStep(count - 1);
    this.scene.pose(landed(this.plan, time), count, this.motion(time));
    this.shoot(this.poses[i], samples);
    this.overlay(time);
    return this.canvas;
  }

  pixels(i: number, samples = this.options.samples): ImageData {
    this.render(i, samples);
    return this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
  }

  private motion(time: number): Motion {
    const { starts, flight } = this.plan;
    const axis = new THREE.Vector3();
    const tilt = new THREE.Matrix4();
    return (piece, matrix, size) => {
      const fallen = fall((time - starts[piece.step]) / flight);
      const turn = 2 * Math.PI * hash(piece.id);
      const angle = TILT * (0.6 + 0.4 * hash(piece.id + 1)) * fallen.tilt * Math.min(1, 60 / size);
      const [x, y, z] = matrix.elements.slice(12, 15);
      tilt.makeRotationAxis(axis.set(Math.cos(turn), 0, Math.sin(turn)), angle);
      matrix
        .setPosition(0, 0, 0)
        .premultiply(tilt)
        .setPosition(x, y - fallen.lift, z);
    };
  }

  /** Degrees around the model: a slow orbit while building, then one full turn easing to rest on the hero angle. */
  private azimuth(time: number): number {
    const { assembled, hold } = this.plan;
    const orbit = ORBIT_DEGREES / assembled;
    const start = HERO_ANGLE - ORBIT_DEGREES - 360;
    if (time <= assembled) return start + orbit * time;
    const turntable = hold - assembled;
    const s = Math.min((time - assembled) / turntable, 1);
    // The orbit's speed fades out as (1 - s)², while a sin² surge makes up the rest of the turn.
    const surge = (2 * (360 - (orbit * turntable) / 3)) / turntable;
    const fading = (orbit * turntable * (1 - (1 - s) ** 3)) / 3;
    return start + ORBIT_DEGREES + fading + surge * turntable * (s / 2 - Math.sin(2 * Math.PI * s) / (4 * Math.PI));
  }

  /** The camera for every frame, framing what is built a moment ahead, smoothed so it glides. */
  private track(): Pose[] {
    const { fps, width, height } = this.options;
    const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const [tanX, tanY] = [(tan * width) / height, tan * (1 - CAPTION)];
    const built = new Hull();
    const drop = new THREE.Vector3(0, DROP, 0);
    let included = 0;
    const raw = Array.from({ length: this.frames }, (_, i) => {
      const time = i / fps;
      const progress = THREE.MathUtils.smootherstep(time, 0, this.plan.hold);
      const azimuth = this.azimuth(time);
      const direction = towardCamera(azimuth, THREE.MathUtils.lerp(ELEVATION.start, ELEVATION.end, progress));
      const whole = fit(this.final.points, direction, tanX, tanY);
      if (time + LOOKAHEAD_S >= this.plan.assembled) return { azimuth, direction, ...whole };
      for (const count = Math.max(started(this.plan, time + LOOKAHEAD_S), 1); included < count; included++) {
        built.add(this.boxes[included]);
      }
      const falling = built.points.flatMap((p) => [p, p.clone().add(drop)]);
      const part = fit(falling, direction, tanX, tanY);
      return { azimuth, direction, target: part.target, distance: Math.max(part.distance, CLOSEST * whole.distance) };
    });
    const radius = Math.round(SMOOTH_S * fps);
    const distances = smooth(
      raw.map((r) => r.distance * MARGIN),
      radius,
    );
    const [x, y, z] = (["x", "y", "z"] as const).map((axis) =>
      smooth(
        raw.map((r) => r.target[axis]),
        radius,
      ),
    );
    return raw.map((r, i) => {
      const target = new THREE.Vector3(x[i], y[i], z[i]);
      const position = target.clone().addScaledVector(r.direction, distances[i]);
      return { target, position, distance: distances[i], azimuth: r.azimuth };
    });
  }

  /** Average jittered renders lit by a key light that turns with the camera and spans a small disk, then add AO and tone map. */
  private shoot(pose: Pose, samples: number) {
    const { renderer, scene, camera, sun, sky } = this.scene;
    const { width, height, dof } = this.options;
    const [beauty, accumulated, post, spare] = this.targets;
    const shift = (CAPTION * height) / 2;
    camera.fov = FOV;
    camera.near = pose.distance / 50;
    camera.far = pose.distance * 50;
    camera.position.copy(pose.position);
    camera.lookAt(pose.target);
    camera.updateMatrixWorld();
    this.scene.fadeEdges(pose.distance, height);

    const sphere = this.final.box.getBoundingSphere(new THREE.Sphere());
    const r = sphere.radius * 1.6;
    Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: r * 0.1, far: r * 3 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.normalBias = (2 * r) / SHADOW_MAP;
    sun.target.position.copy(sphere.center);
    sun.target.updateMatrixWorld();
    sun.intensity = LIGHT.sun;
    sun.shadow.intensity = LIGHT.shadow;
    sky.intensity = LIGHT.sky;
    scene.environmentIntensity = LIGHT.environment;
    const key = towardCamera(pose.azimuth + LIGHT.azimuth, LIGHT.elevation);
    const across = new THREE.Vector3().crossVectors(key, camera.up).normalize();
    const up = new THREE.Vector3().crossVectors(across, key);

    const clear = renderer.getClearColor(new THREE.Color());
    const clearAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(accumulated);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.setClearColor(clear, clearAlpha);
    const blend = this.blend.material as THREE.ShaderMaterial;
    blend.uniforms.tDiffuse.value = beauty.texture;
    blend.uniforms.weight.value = 1 / samples;
    for (let s = 0; s < samples; s++) {
      const [jx, jy] = samples > 1 ? [halton(s, 2) - 0.5, halton(s, 3) - 0.5] : [0, 0];
      camera.setViewOffset(width, height, jx, jy + shift, width, height);
      const spread = SUN_RADIUS * Math.sqrt(halton(s, 5));
      const angle = 2 * Math.PI * halton(s, 7);
      const direction = key
        .clone()
        .addScaledVector(across, spread * Math.cos(angle))
        .addScaledVector(up, spread * Math.sin(angle))
        .normalize();
      sun.position.copy(sphere.center).addScaledVector(direction, r * 1.5);
      sun.updateMatrixWorld();
      renderer.shadowMap.needsUpdate = true;
      renderer.setRenderTarget(beauty);
      renderer.render(scene, camera);
      renderer.setRenderTarget(accumulated);
      this.blend.render(renderer);
    }
    camera.setViewOffset(width, height, 0, shift, width, height);
    this.ao!.updateGtaoMaterial({ radius: Math.max(20, pose.distance * 0.015), distanceExponent: 1, thickness: 1 });
    this.ao!.render(renderer, post, accumulated, 0, false);
    let result = post;
    if (dof) {
      for (const [pass, into, uniform, size] of [
        [this.tiltX, spare, "h", width],
        [this.tiltY, post, "v", height],
      ] as const) {
        const shader = pass.material as THREE.ShaderMaterial;
        shader.uniforms.tDiffuse.value = result.texture;
        shader.uniforms[uniform].value = 4 / size;
        shader.uniforms.r.value = 0.5 + CAPTION / 2;
        renderer.setRenderTarget(into);
        pass.render(renderer);
        result = into;
      }
    }
    this.output.renderToScreen = true;
    this.output.render(renderer, spare, result, 0, false);
    camera.clearViewOffset();
  }

  /** A vignette, the corner title, and the lower third: what is being built and how many pieces have landed. */
  private overlay(time: number) {
    const { width, height, branded, label } = this.options;
    const { plan, ctx } = this;
    const unit = Math.min(width, height) / 1080;
    const margin = 56 * unit;
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
    ctx.drawImage(this.scene.renderer.domElement, 0, 0, width, height);
    const [cx, cy] = [width / 2, height * 0.45];
    const vignette = ctx.createRadialGradient(
      cx,
      cy,
      Math.min(width, height) * 0.35,
      cx,
      cy,
      Math.hypot(width, height) * 0.6,
    );
    vignette.addColorStop(0, "rgba(20, 20, 40, 0)");
    vignette.addColorStop(1, "rgba(20, 20, 40, 0.1)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = ACCENT;
    ctx.fillRect(margin, margin, 30 * unit, 6 * unit);
    ctx.fillStyle = INK;
    ctx.font = `800 ${(label ? 50 : 34) * unit}px ${FONT}`;
    this.text(label ?? (branded ? HOLO_MODEL : this.build.name), margin, margin + (label ? 62 : 46) * unit, width / 2);
    ctx.fillStyle = MUTED;
    ctx.font = `700 ${14 * unit}px ${FONT}`;
    this.spaced(branded ? "H COMPANY · BRICKYARD" : "BRICKYARD", margin, margin + (label ? 92 : 72) * unit);

    const band = CAPTION * height * 1.3;
    const shade = ctx.createLinearGradient(0, height - band, 0, height);
    shade.addColorStop(0, `rgba(${SHADE}, 0)`);
    shade.addColorStop(0.55, `rgba(${SHADE}, 0.82)`);
    shade.addColorStop(1, `rgba(${SHADE}, 0.92)`);
    ctx.fillStyle = shade;
    ctx.fillRect(0, height - band, width, band);

    const total = plan.order.length;
    const done = landed(plan, time);
    let kicker = "BUILDING";
    let title = this.build.name;
    let since = time;
    if (done === total) {
      kicker = `COMPLETE · ${plan.steps.length} ${plan.steps.length === 1 ? "STEP" : "STEPS"}`;
      since = time - (plan.starts[total - 1] + plan.flight);
    } else if (started(plan, time) > 0) {
      let step = this.captions[0];
      for (const s of this.captions) if (s.start <= time) step = s;
      kicker = `STEP ${step.number} OF ${plan.steps.length}`;
      title = step.title;
      since = time - step.start;
    }
    const base = height - margin - 18 * unit;
    const right = width - margin;
    ctx.fillStyle = INK;
    ctx.font = `800 ${52 * unit}px ${FONT}`;
    ctx.textAlign = "right";
    ctx.fillText(done.toLocaleString("en-US"), right, base - 20 * unit);
    const counter = Math.max(ctx.measureText(total.toLocaleString("en-US")).width, 120 * unit);
    ctx.fillStyle = MUTED;
    ctx.font = `700 ${14 * unit}px ${FONT}`;
    this.spaced(
      `OF ${total.toLocaleString("en-US")} ${total === 1 ? "PIECE" : "PIECES"}`,
      right,
      base + 6 * unit,
      "right",
    );

    ctx.globalAlpha = Math.min(1, since / FADE_S);
    this.spaced(kicker, margin, base - 62 * unit);
    ctx.fillStyle = INK;
    ctx.font = `700 ${30 * unit}px ${FONT}`;
    this.text(title, margin, base - 20 * unit, width - margin * 3 - counter);
    ctx.globalAlpha = 1;

    const bar = base + 16 * unit;
    ctx.fillStyle = "rgba(28, 28, 38, 0.12)";
    ctx.fillRect(margin, bar, width - margin * 2, 4 * unit);
    ctx.fillStyle = ACCENT;
    ctx.fillRect(margin, bar, ((width - margin * 2) * done) / total, 4 * unit);
  }

  private text(value: string, x: number, y: number, width: number) {
    let label = value;
    while (label.length && this.ctx.measureText(label).width > width) label = label.slice(0, -1);
    if (label !== value) label = `${label.slice(0, -1)}…`;
    this.ctx.fillText(label, x, y);
  }

  private spaced(value: string, x: number, y: number, align: CanvasTextAlign = "left") {
    this.ctx.letterSpacing = "0.12em";
    this.ctx.textAlign = align;
    this.ctx.fillText(value, x, y);
    this.ctx.letterSpacing = "0px";
    this.ctx.textAlign = "left";
  }

  dispose() {
    for (const target of this.targets) target.dispose();
    this.ao?.dispose();
    this.output.dispose();
    for (const pass of [this.blend, this.tiltX, this.tiltY]) {
      pass.material.dispose();
      pass.dispose();
    }
    this.ground.geometry.dispose();
    (this.ground.material as THREE.Material).dispose();
    for (const material of this.materials.values()) material.dispose();
    this.scene.dispose();
  }
}
