import { expect, test } from "@playwright/test";
import { type Solid, Solids, WALK, Walker } from "../src/walker";
import { fixture, site } from "./fixtures";

const FRAME = 1 / 60;

for (const native of [true, false]) {
  test(`walk fullscreen fills the canvas and restores its layout (${native ? "native" : "embedded browser"})`, async ({
    page,
  }) => {
    if (!native) await page.addInitScript(() => Object.defineProperty(document, "fullscreenEnabled", { value: false }));
    const build = fixture();
    await site(page, [build]);
    await page.goto(`/?showcase=${build.id}`);
    const viewer = page.locator(".viewer");
    await expect(viewer).toHaveAttribute("data-revision", build.revision);
    const original = await viewer.boundingBox();
    const walk = page.getByRole("button", { name: "Walk", exact: true });
    await walk.click();
    await page.getByTitle("Enter fullscreen", { exact: true }).click();
    await expect(viewer).toHaveClass("viewer walk-fullscreen");
    if (native)
      await expect.poll(() => page.evaluate(() => document.fullscreenElement?.classList.contains("viewer"))).toBe(true);
    const viewport = await page.evaluate(() => ({ x: 0, y: 0, width: innerWidth, height: innerHeight }));
    await expect.poll(() => viewer.boundingBox()).toEqual(viewport);
    await expect.poll(() => page.locator(".viewer-canvas canvas").boundingBox()).toEqual(viewport);
    if (!native) await page.screenshot({ path: "/private/tmp/brickyard-walk-fullscreen.png" });

    await page.getByRole("button", { name: "Exit fullscreen", exact: true }).click();
    await expect(viewer).toHaveClass("viewer");
    await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
    await expect(walk).toHaveAttribute("aria-pressed", "true");

    await page.getByTitle("Enter fullscreen", { exact: true }).click();
    await page.getByRole("button", { name: "Leave walk mode", exact: true }).click();
    await expect(walk).toHaveAttribute("aria-pressed", "false");
    await expect(viewer).toHaveClass("viewer");
    await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
    await expect.poll(() => viewer.boundingBox()).toEqual(original);

    await walk.click();
    await page.getByTitle("Enter fullscreen", { exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(viewer).toHaveClass("viewer");
    await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
  });
}
/** Heading along +x. */
const EAST = -Math.PI / 2;

const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Solid => ({
  min: { x: x0, y: y0, z: z0 },
  max: { x: x1, y: y1, z: z1 },
});

/** A walker at `feet`, heading east over `solids` on a ground at 0, driven by keys frame by frame. */
function world(solids: Solid[], feet = { x: 0, y: 0, z: 0 }) {
  const walker = new Walker(feet);
  const collider = new Solids(solids, 0);
  let time = 0;
  const run = (seconds: number) => {
    for (let t = 0; t < seconds; t += FRAME, time += FRAME * 1000) walker.step(FRAME, EAST, collider);
  };
  const hold = (seconds: number, ...codes: string[]) => {
    for (const code of codes) walker.press(code, time);
    run(seconds);
    for (const code of codes) walker.release(code);
  };
  return { walker, run, hold, tap: (code: string) => hold(0.1, code) };
}

test("the walker falls to the ground, climbs one brick but not two, and slides along walls", () => {
  const { walker, run, hold } = world([box(40, 0, -100, 120, 28, 100), box(120, 0, -100, 160, 80, 100)], {
    x: 0,
    y: 200,
    z: 0,
  });
  run(1);
  expect(walker.y).toBe(0);
  hold(2, "KeyW");
  expect(walker.y).toBe(28);
  expect(walker.x).toBeCloseTo(120 - WALK.radius);
  hold(0.5, "KeyW", "KeyA");
  expect(walker.x).toBeCloseTo(120 - WALK.radius);
  expect(walker.z).toBeLessThan(-30);
});

test("double-tapping Space flies: Space rises, Shift descends, walls still stop it; again drops", () => {
  const { walker, run, hold, tap } = world([box(40, 0, -100, 80, 1000, 100)]);
  tap("Space");
  tap("Space");
  expect(walker.flying).toBe(true);
  run(0.5);
  const hover = walker.y;
  run(0.5);
  expect(walker.y).toBe(hover);
  hold(0.5, "Space");
  expect(walker.y).toBeGreaterThan(hover + 60);
  const high = walker.y;
  hold(0.2, "ShiftLeft");
  expect(walker.y).toBeLessThan(high - 20);
  hold(1, "KeyW");
  expect(walker.x).toBeCloseTo(40 - WALK.radius);
  tap("Space");
  tap("Space");
  expect(walker.flying).toBe(false);
  run(1);
  expect(walker.y).toBe(0);
});

test("a piece showing up around the walker lifts it on top", () => {
  const { walker, run } = world([box(-20, 0, -20, 20, 28, 20)]);
  run(FRAME);
  expect(walker.y).toBe(28);
});

test("walk mode shows its controls, takes Space to fly, and Escape leaves it", async ({ page }) => {
  const build = fixture();
  await site(page, [build]);
  await page.goto(`/?showcase=${build.id}`);
  await expect(page.locator(".viewer")).toHaveAttribute("data-render-state", "ready");
  const walk = page.getByRole("button", { name: "Walk", exact: true });
  await walk.click();
  await expect(walk).toHaveAttribute("aria-pressed", "true");
  const hud = page.locator(".walk-hud");
  await expect(hud).toContainText("Click to walk");
  await expect(hud).toContainText("Sprint");
  const flying = page.locator(".walk-flying");
  await expect(flying).toBeHidden();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Space");
  await page.keyboard.press("Space");
  await expect(flying).toBeVisible();
  expect(await page.locator(".timeline .play").getAttribute("title")).toBe("Play");
  await page.keyboard.press("Space");
  await page.keyboard.press("Space");
  await expect(flying).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(walk).toHaveAttribute("aria-pressed", "false");
  await expect(hud).toBeHidden();
});

test("leaving walk mode keeps the view, so editing starts from there; choosing a view frames the model again", async ({
  page,
}) => {
  const build = fixture();
  await site(page, [build]);
  await page.goto(`/?showcase=${build.id}`);
  await expect(page.locator(".viewer")).toHaveAttribute("data-render-state", "ready");
  const canvas = page.locator(".viewer-canvas canvas");
  /** The canvas's own pixels, without the toolbars drawn over it. */
  const picture = async () => {
    await page.waitForTimeout(600); // let damping and glides settle
    return canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL());
  };
  await page.mouse.move(0, 0);
  const framed = await picture();

  const walk = page.getByRole("button", { name: "Walk", exact: true });
  await walk.click();
  await page.keyboard.down("KeyS");
  await page.waitForTimeout(500);
  await page.keyboard.up("KeyS");
  await page.keyboard.press("Escape");
  await expect(walk).toHaveAttribute("aria-pressed", "false");
  const walked = await picture();
  expect(walked).not.toBe(framed);

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  expect(await picture()).toBe(walked);

  await page.getByRole("button", { name: "3/4", exact: true }).click();
  await page.waitForTimeout(1200);
  expect(await picture()).toBe(framed);
});

test("Reset view frames the model again, from a walk or after one", async ({ page }) => {
  const build = fixture();
  await site(page, [build]);
  await page.goto(`/?showcase=${build.id}`);
  await expect(page.locator(".viewer")).toHaveAttribute("data-render-state", "ready");
  const canvas = page.locator(".viewer-canvas canvas");
  const picture = async () => {
    await page.waitForTimeout(1200); // let damping and glides settle
    return canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL());
  };
  await page.mouse.move(0, 0);
  const framed = await picture();
  const walk = page.getByRole("button", { name: "Walk", exact: true });
  const reset = page.getByRole("button", { name: "Reset view" });

  await walk.click();
  await reset.click();
  await expect(walk).toHaveAttribute("aria-pressed", "false");
  expect(await picture()).toBe(framed);

  await walk.click();
  await page.keyboard.down("KeyS");
  await page.waitForTimeout(500);
  await page.keyboard.up("KeyS");
  await page.keyboard.press("Escape");
  expect(await picture()).not.toBe(framed);
  await reset.click();
  expect(await picture()).toBe(framed);
});
