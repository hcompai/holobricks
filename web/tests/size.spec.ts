import { expect, test } from "@playwright/test";
import { fixture, revised, site } from "./fixtures";
import { platform } from "./platform";

test("model size uses the rendered parts, stays fixed during replay and follows revisions", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await site(page);
  const agp = await platform(page);
  agp.session("size");
  agp.say("size", "A tower");
  await page.goto("/?build=size");
  const size = page.getByLabel("Model size", { exact: true });
  await expect(page.locator(".thinking")).toBeVisible();
  await expect(size).toHaveCount(0);

  // Deliberately wrong grid dimensions: the geometry is 80 × 96 × 40 LDraw units.
  const model = { ...fixture(), width: 100, depth: 200 };
  agp.share("size", model);
  await expect(size).toBeVisible();
  await expect(size.locator("dt")).toHaveText(["Height", "Width", "Depth"]);
  await expect(size.locator("dd")).toHaveText(["3.8 cm", "3.2 cm", "1.6 cm"]);
  await page.screenshot({ path: testInfo.outputPath("model-size-desktop.png") });

  await page.getByRole("button", { name: "Top", exact: true }).click();
  await page.getByRole("button", { name: "Spin", exact: true }).click();
  await page.locator('.timeline input[type="range"]').fill("0");
  await expect(page.locator(".scrub-label")).toContainText("2 pieces");
  await expect(size.locator("dd")).toHaveText(["3.8 cm", "3.2 cm", "1.6 cm"]);
  await page.getByRole("button", { name: "Spin", exact: true }).click();
  await page.getByRole("button", { name: "Last step", exact: true }).click();

  // A sideways brick at an offset extends all three axes, including negative Y.
  const changed = revised({
    ...model,
    pieces: model.pieces.map((p) =>
      p.id === 7 ? { ...p, pos: [160, -240, 80], rot: [1, 0, 0, 0, 0, -1, 0, 1, 0] } : p,
    ),
  });
  agp.share("size", changed);
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", changed.revision);
  await expect(size.locator("dd")).toHaveText(["11.4 cm", "8.0 cm", "5.0 cm"]);

  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(size).toBeVisible();
  const bounds = (await size.boundingBox())!;
  const viewer = (await page.locator(".viewer").boundingBox())!;
  const sound = (await page.locator(".viewer > .placement-sound").boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(viewer.x);
  expect(bounds.y).toBeGreaterThanOrEqual(viewer.y);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(sound.x);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewer.y + viewer.height);
  await page.screenshot({ path: testInfo.outputPath("model-size-mobile.png") });

  agp.share("size", revised({ ...model, pieces: [], steps: [] }));
  await expect(size).toHaveCount(0);
});
