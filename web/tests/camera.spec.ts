import { expect, test } from "@playwright/test";
import { Box3, MathUtils, PerspectiveCamera, Vector3 } from "three";
import {
  cameraBox,
  cameraVisibility,
  planBuildCamera,
  sampleBuildCamera,
  type CameraLayer,
  type CameraBounds,
} from "../src/buildCamera";

const layers: CameraLayer[] = [
  { step: 0, start: 0, end: 1, bounds: [0, 0, 0, 24, 1, 12] },
  { step: 1, start: 1.3, end: 2.3, bounds: [2, 1, 2, 8, 8, 8] },
  { step: 1, start: 2.3, end: 3.3, bounds: [2, 8, 2, 8, 18, 8] },
  { step: 2, start: 3.6, end: 4.6, bounds: [20, 1, 3, 30, 6, 9] },
];

function insideFrame(pose: ReturnType<typeof sampleBuildCamera>, box: Box3, aspect: number, caption = 0) {
  const camera = new PerspectiveCamera(35, aspect, 0.01, 10000);
  if (caption) camera.setViewOffset(1000 * aspect, 1000, 0, (caption / 2) * 1000, 1000 * aspect, 1000);
  camera.position.copy(pose.position);
  camera.lookAt(pose.target);
  camera.updateMatrixWorld();
  for (let c = 0; c < 8; c++) {
    const point = new Vector3(
      c & 1 ? box.max.x : box.min.x,
      c & 2 ? box.max.y : box.min.y,
      c & 4 ? box.max.z : box.min.z,
    ).project(camera);
    expect(Math.abs(point.x)).toBeLessThan(0.97);
    expect(point.y).toBeGreaterThan(-0.97 + caption * 2);
    expect(point.y).toBeLessThan(0.97);
    expect(point.z).toBeGreaterThan(-1);
    expect(point.z).toBeLessThan(1);
  }
}

test("each step holds a composition that frames all its work, then the final reveal frames the whole model", () => {
  for (const aspect of [16 / 9, 1, 9 / 16]) {
    const lens = { aspect, fov: 35, caption: 0.15 };
    const plan = planBuildCamera(layers, null, lens, 4.6, 2)!;
    expect(plan.steps).toHaveLength(3);
    for (const step of plan.steps) {
      const framing = new Box3();
      for (const layer of layers.filter((layer) => layer.start >= step.start && layer.end <= step.end))
        framing.union(cameraBox(layer.bounds));
      for (let time = step.start; time <= step.end; time += 1 / 60) {
        const pose = sampleBuildCamera(plan, time);
        expect(pose).toEqual(step.pose);
        insideFrame(pose, framing, aspect, lens.caption);
      }
    }
    const final = layers.reduce((box, layer) => box.union(cameraBox(layer.bounds)), new Box3());
    insideFrame(sampleBuildCamera(plan, 100), final, aspect, lens.caption);
    expect(sampleBuildCamera(plan, 100)).toEqual(plan.hero);
    expect(planBuildCamera(layers, null, lens, 4.6, 2)).toEqual(plan);
  }
});

test("small additions fill the canvas independently of a much larger existing model", () => {
  for (const aspect of [16 / 9, 1, 9 / 16]) {
    const bounds: CameraBounds = [8, 2, 10, 13, 6, 16];
    const active = cameraBox(bounds);
    const plan = planBuildCamera(
      [{ step: 2, start: 0, end: 1, bounds }],
      [0, 0, 0, 100, 25, 100],
      { aspect, fov: 35 },
      1,
      0,
      [],
    )!;
    const pose = sampleBuildCamera(plan, 0.5);
    expect(pose.target).toEqual(active.getCenter(new Vector3()));
    insideFrame(pose, active, aspect);
    const camera = new PerspectiveCamera(35, aspect, 0.01, 10000);
    camera.position.copy(pose.position);
    camera.lookAt(pose.target);
    camera.updateMatrixWorld();
    const projected = new Box3();
    for (let c = 0; c < 8; c++)
      projected.expandByPoint(
        new Vector3(
          c & 1 ? active.max.x : active.min.x,
          c & 2 ? active.max.y : active.min.y,
          c & 4 ? active.max.z : active.min.z,
        ).project(camera),
      );
    const size = projected.getSize(new Vector3());
    expect(Math.max(size.x, size.y) / 2).toBeGreaterThan(0.82);
  }
});

test("a single held view exposes every layer of work behind an existing tower", () => {
  const tower: CameraBounds = [15, 1, 17, 25, 25, 27];
  const garden: CameraBounds = [6, 0, 6, 34, 1, 34];
  const gatehouse: CameraLayer[] = Array.from({ length: 5 }, (_, i) => ({
    step: 2,
    start: i * 0.3,
    end: (i + 1) * 0.3,
    bounds: [8, i + 2, 10, 13, i + 3, 16],
  }));
  for (const aspect of [16 / 9, 9 / 16]) {
    const plan = planBuildCamera(gatehouse, [6, 0, 6, 34, 25, 34], { aspect, fov: 35 }, 1.5, 1.8, [garden, tower])!;
    const solids = [garden, tower];
    for (const layer of gatehouse) {
      const pose = sampleBuildCamera(plan, layer.start);
      expect(pose).toEqual(plan.steps[0].pose);
      expect(cameraVisibility(pose, cameraBox(layer.bounds), solids)).toBeGreaterThanOrEqual(0.78);
      solids.push(layer.bounds);
    }
    const active = cameraBox(gatehouse[0].bounds);
    const badEye = new Vector3(55, 20, 60),
      target = active.getCenter(new Vector3());
    expect(cameraVisibility({ position: badEye, target, distance: badEye.distanceTo(target) }, active, [tower])).toBe(
      0,
    );
  }
});

test("camera transitions are confined to the gaps between steps, including tall and distant additions", () => {
  const sequence: CameraLayer[] = [
    { step: 0, start: 0, end: 1, bounds: [6, 0, 6, 34, 1, 34] },
    ...Array.from({ length: 24 }, (_, i): CameraLayer => ({
      step: 1,
      start: 1.3 + i / 12,
      end: 1.3 + (i + 1) / 12,
      bounds: [15, i + 1, 17, 25, i + 2, 27],
    })),
    ...Array.from({ length: 5 }, (_, i): CameraLayer => ({
      step: 2,
      start: 3.6 + i * 0.3,
      end: 3.6 + (i + 1) * 0.3,
      bounds: [8, i + 2, 10, 13, i + 3, 16],
    })),
  ];
  for (const aspect of [16 / 9, 9 / 16]) {
    const plan = planBuildCamera(sequence, null, { aspect, fov: 35 }, 5.1)!;
    const solids: CameraBounds[] = [];
    for (const layer of sequence) {
      const shot = plan.steps.find((step) => layer.start >= step.start && layer.end <= step.end)!;
      for (const time of [layer.start, (layer.start + layer.end) / 2, layer.end - 1e-6]) {
        const pose = sampleBuildCamera(plan, time);
        expect(pose).toEqual(shot.pose);
        expect(cameraVisibility(pose, cameraBox(layer.bounds), solids)).toBeGreaterThanOrEqual(0.78);
      }
      solids.push(layer.bounds);
    }
    for (let i = 0; i < plan.steps.length - 1; i++) {
      const a = plan.steps[i],
        b = plan.steps[i + 1];
      expect(sampleBuildCamera(plan, a.end)).toEqual(a.pose);
      expect(sampleBuildCamera(plan, b.start)).toEqual(b.pose);
      const halfway = sampleBuildCamera(plan, (a.end + b.start) / 2);
      expect(halfway.target.distanceTo(a.pose.target.clone().lerp(b.pose.target, 0.5))).toBeLessThan(1e-8);
    }
  }
});

test("scattered placements share a stable view that exposes their separate regions", () => {
  const scattered: CameraLayer[] = Array.from({ length: 4 }, (_, i) => ({
    step: 5,
    start: i * 0.25,
    end: (i + 1) * 0.25,
    bounds: [4, 11 + i, 16, 35, 12 + i, 17],
    solids: [4, 14, 24, 34].map((x): CameraBounds => [x, 11 + i, 16, x + 1, 12 + i, 17]),
  }));
  const tower: CameraBounds = [16, 0, 18, 23, 23, 25];
  const plan = planBuildCamera(scattered, tower, { aspect: 16 / 9, fov: 35 }, 1, 0, [tower])!;
  const solids = [tower];
  for (const layer of scattered) {
    const pose = sampleBuildCamera(plan, (layer.start + layer.end) / 2);
    expect(pose).toEqual(plan.steps[0].pose);
    insideFrame(pose, cameraBox(layer.bounds), 16 / 9);
    for (const region of layer.solids!)
      expect(cameraVisibility(pose, cameraBox(region), solids)).toBeGreaterThanOrEqual(0.78);
    solids.push(...layer.solids!);
  }
});

test("shots look down on flat work, lower for towers, and choose the broad side of long builds", () => {
  const lens = { aspect: 16 / 9, fov: 35 };
  const pose = (bounds: CameraLayer["bounds"]) =>
    sampleBuildCamera(planBuildCamera([{ step: 0, start: 0, end: 2, bounds }], null, lens, 2, 0)!, 1);
  const flat = pose([0, 0, 0, 30, 1, 6]);
  const tall = pose([0, 0, 0, 6, 30, 6]);
  const longZ = pose([0, 0, 0, 6, 1, 30]);
  const direction = (p: typeof flat) => p.position.clone().sub(p.target).normalize();
  const elevation = (p: typeof flat) => MathUtils.radToDeg(Math.asin(direction(p).y));
  expect(elevation(flat)).toBeGreaterThan(elevation(tall) + 15);
  expect(direction(flat).z).toBeGreaterThan(direction(flat).x);
  expect(direction(longZ).x).toBeGreaterThan(direction(longZ).z);
  expect(planBuildCamera([], null, lens, 0)).toBeNull();
});

test("unfinished steps hold the work view without returning to an overview, including fractional durations", () => {
  const work: CameraLayer[] = [
    { step: 2, start: 0, end: 0.193, bounds: [8, 2, 10, 13, 3, 16] },
    { step: 2, start: 0.193, end: 0.47, bounds: [8, 3, 10, 13, 4, 16] },
  ];
  const plan = planBuildCamera(work, [6, 0, 6, 34, 25, 34], { aspect: 16 / 9, fov: 35 }, 0.47, 0, [
    [15, 1, 17, 25, 25, 27],
  ])!;
  const held = sampleBuildCamera(plan, 10);
  const focus = cameraBox(work[0].bounds).union(cameraBox(work[1].bounds)).getCenter(new Vector3());
  const overview = new Vector3(20, 12.5, 20);
  expect(held.target.distanceTo(focus)).toBeLessThan(held.target.distanceTo(overview) * 0.3);
  expect(held).toEqual(sampleBuildCamera(plan, 0));
});

test("LEGO replay uses the close-up worker camera and dragging returns control", async ({ page }, info) => {
  const { fixture, site } = await import("./fixtures");
  const build = fixture();
  await site(page, [build]);
  await page.goto(`/?showcase=${build.id}`);
  const viewer = page.locator(".viewer");
  await expect(viewer).toHaveAttribute("data-revision", build.revision);
  const speed = page.getByRole("button", { name: /^Playback speed:/ });
  for (let i = 0; i < 3; i++) await speed.click({ timeout: 5000 });
  await expect(speed).toHaveAttribute("aria-label", "Playback speed: 0.5×");
  await page.getByRole("button", { name: "First step", exact: true }).click();
  await page.getByRole("slider", { name: "Step", exact: true }).fill("1");
  await expect(viewer).toHaveAttribute("data-placing", "true");
  await expect.poll(async () => Number(await viewer.getAttribute("data-placed"))).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Pause placement", exact: true }).click();
  await page.screenshot({ path: info.outputPath("closeup-lego.png") });
  const follow = page.getByRole("button", { name: "Follow build", exact: true });
  await expect(follow).toHaveAttribute("aria-pressed", "true");
  const canvas = page.locator(".viewer-canvas canvas");
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 60, bounds.y + bounds.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(follow).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(viewer).toHaveAttribute("data-placing", "false");
});
