import { expect, test, type Page } from "@playwright/test";
import { fixture, revised, site } from "./fixtures";
import { platform } from "./platform";

test.use({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });

// Safari changes these values for its keyboard without resizing the layout viewport.
async function viewport(page: Page, height: number, top = 0, scale = 1) {
  await page.evaluate(
    ({ height, top, scale }) => {
      for (const [key, value] of Object.entries({ height, offsetTop: top, scale }))
        Object.defineProperty(window.visualViewport!, key, { configurable: true, value });
      window.visualViewport!.dispatchEvent(new Event("resize"));
      window.visualViewport!.dispatchEvent(new Event("scroll"));
    },
    { height, top, scale },
  );
}

test("the phone sheet and composer follow the keyboard, then restore the model and desktop layout", async ({
  page,
}, info) => {
  await site(page);
  const agp = await platform(page);
  const model = fixture();
  agp.session("keyboard", "idle");
  agp.say("keyboard", "A tower");
  agp.share("keyboard", model);
  await page.goto("/?build=keyboard");
  const app = page.locator(".app");
  const sheet = page.locator("aside.sheet");
  const composer = page.getByPlaceholder("Ask for a change");
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", model.revision);
  const canvas = await page.locator(".viewer-canvas canvas").elementHandle();
  await composer.fill("Keep this draft");
  await expect(page.locator(".composer-model")).toBeHidden();
  await expect(sheet).toHaveAttribute("data-detent", "half");
  await viewport(page, 400, 40);
  await expect.poll(async () => (await app.boundingBox())!.height).toBe(400);
  await expect.poll(async () => (await app.boundingBox())!.y).toBe(40);
  await expect
    .poll(async () => {
      const box = (await composer.boundingBox())!;
      return box.y >= 40 && box.y + box.height <= 440;
    })
    .toBe(true);
  await page.locator(".sheet-handle").click();
  await expect(sheet).toHaveAttribute("data-detent", "full");
  await expect.poll(async () => (await sheet.boundingBox())!.height).toBe(336);
  await page.screenshot({ path: info.outputPath("phone-keyboard.png") });
  const handle = (await page.locator(".sheet-handle").boundingBox())!;
  await page.mouse.move(handle.x + 100, handle.y + 10);
  await page.mouse.down();
  await page.mouse.move(handle.x + 100, 430, { steps: 6 });
  await page.mouse.up();
  await expect(sheet).toHaveAttribute("data-detent", "peek");
  await expect(composer).toHaveValue("Keep this draft");

  // Browser pinch zoom must not reflow the app into a smaller workspace.
  await viewport(page, 200, 60, 2);
  await expect.poll(async () => (await app.boundingBox())!.height).toBe(400);
  await viewport(page, 844);
  await composer.blur();
  await expect.poll(async () => (await app.boundingBox())!.height).toBe(844);
  await expect.poll(async () => (await app.boundingBox())!.y).toBe(0);
  await expect(page.locator(".timeline")).toBeInViewport();
  expect(await canvas!.evaluate((node) => node === document.querySelector(".viewer-canvas canvas"))).toBe(true);
  await page.screenshot({ path: info.outputPath("phone-restored.png") });
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator("aside.sheet")).toHaveCount(0);
  await expect(app).not.toHaveCSS("position", "fixed");
  await expect(composer).toHaveValue("Keep this draft");
  expect(await app.evaluate((node) => node.style.getPropertyValue("--phone-height"))).toBe("");
});

test("the home composer remains reachable with the phone keyboard open", async ({ page }) => {
  await site(page);
  await page.goto("/");
  const composer = page.getByPlaceholder("A red lighthouse on a rock… or drop a photo");
  await composer.fill("A tower");
  await viewport(page, 380, 30);
  await expect.poll(async () => (await page.locator(".app").boundingBox())!.height).toBe(380);
  await expect
    .poll(async () => {
      const box = (await composer.boundingBox())!;
      return box.y >= 30 && box.y + box.height <= 410;
    })
    .toBe(true);
});

test("Live resumes incoming steps after scrubbing without remounting the renderer or losing a draft", async ({
  page,
}, info) => {
  await site(page);
  const agp = await platform(page);
  const model = fixture();
  agp.session("live");
  agp.say("live", "A tower");
  agp.share("live", model);
  await page.goto("/?build=live");
  const viewer = page.locator(".viewer");
  const slider = page.getByRole("slider", { name: "Step", exact: true });
  const live = page.getByRole("button", { name: "Live", exact: true });
  await expect(viewer).toHaveAttribute("data-revision", model.revision);
  const canvas = await page.locator(".viewer-canvas canvas").elementHandle();
  await expect(live).toHaveCount(0);
  await slider.fill("0");
  await expect(live).toBeInViewport();
  await page.getByPlaceholder("Ask for a change").fill("Keep this draft");
  await expect(page.locator("aside.sheet")).toHaveAttribute("data-detent", "half");
  // Wait for the opening transition before measuring the drag target.
  await page.locator(".sheet-handle").hover();
  const handle = (await page.locator(".sheet-handle").boundingBox())!;
  await page.mouse.move(handle.x + 100, handle.y + 10);
  await page.mouse.down();
  await page.mouse.move(handle.x + 100, 830, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator("aside.sheet")).toHaveAttribute("data-detent", "peek");
  // Still service the agent's render request while the user inspects an earlier step.
  agp.look("live", "inspecting", { angle: 90 });
  await expect.poll(() => agp.posted("/tool_results").length).toBe(1);
  expect(agp.posted("/tool_results")[0].result[0]).toContain(model.revision.slice(0, 8));
  const grow = (count: number) =>
    revised({
      ...model,
      steps: Array.from({ length: count }, (_, index) => ({ index, title: `Layer ${index + 1}` })),
      pieces: Array.from({ length: count * 2 }, (_, id) => ({
        ...model.pieces[id % 2],
        id,
        step: Math.floor(id / 2),
        pos: [(id % 2) * 40, -Math.floor(id / 2) * 24, 0],
      })),
    });
  agp.state("live", "running");
  const next = grow(5);
  agp.share("live", next);
  await expect(viewer).toHaveAttribute("data-revision", next.revision);
  await expect(slider).toHaveValue("0");
  await page.screenshot({ path: info.outputPath("phone-live.png") });
  await live.click();
  await expect(slider).toHaveValue("4");
  await expect(live).toHaveCount(0);
  const latest = grow(6);
  agp.share("live", latest);
  await expect(viewer).toHaveAttribute("data-revision", latest.revision);
  await expect(slider).toHaveValue("5");
  await expect(page.getByPlaceholder("Ask for a change")).toHaveValue("Keep this draft");
  expect(await canvas!.evaluate((node) => node === document.querySelector(".viewer-canvas canvas"))).toBe(true);
  await slider.fill("0");
  await expect(live).toBeVisible();
  agp.state("live", "idle");
  await expect(live).toHaveCount(0);
});
