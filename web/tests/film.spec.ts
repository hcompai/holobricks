import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { Build } from "../src/model";
import { DROP, fall, filmCaption, filmFilename, frameCount, landed, planFilm, started } from "../src/filmPlan";
import { fixture, site } from "./fixtures";

/** The fixture's tower grown to `count` pieces, two per step. */
function tower(count: number): Build {
  const build = fixture();
  const [piece] = build.pieces;
  build.pieces = Array.from({ length: count }, (_, id) => ({
    ...piece,
    id,
    step: id >> 1,
    pos: [(id % 2) * 40, -(id >> 1) * 24, 0],
  }));
  build.steps = Array.from({ length: Math.ceil(count / 2) }, (_, index) => ({ index, title: `Layer ${index + 1}` }));
  return build;
}

async function mock(page: Page, build: Build = fixture()) {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => false }),
  );
  await site(page, [build]);
  await page.goto(`/?showcase=${build.id}`);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Share a GIF…" })).toBeEnabled();
  await page.keyboard.press("Escape");
}

async function openFilm(page: Page) {
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await page.getByRole("menuitem", { name: "Share a GIF…" }).click();
}

test("film plans are deterministic and land every piece before the turntable", () => {
  for (const count of [1, 2, 24, 5000])
    for (const seconds of [6, 8, 20, 60]) {
      const build = tower(count);
      const copy = structuredClone(build);
      const plan = planFilm(build, seconds);
      expect(build).toEqual(copy);
      expect(planFilm(copy, seconds)).toEqual(plan);
      expect(frameCount({ seconds, fps: 60 })).toBe(seconds * 60);
      expect(new Set(plan.order.map((p) => p.id)).size).toBe(count);
      expect(plan.order.every((p, i) => i === 0 || p.step >= plan.order[i - 1].step)).toBe(true);
      expect(plan.starts.every((t, i) => i === 0 || t >= plan.starts[i - 1])).toBe(true);
      expect(landed(plan, 0)).toBe(0);
      expect(started(plan, plan.starts[0])).toBeGreaterThan(0);
      expect(plan.starts[count - 1] + plan.flight).toBeLessThanOrEqual(plan.assembled);
      expect(landed(plan, plan.assembled)).toBe(count);
      expect(plan.hold).toBe(seconds - 1);
      expect(plan.steps.map((s) => s.number)).toEqual(plan.steps.map((_, i) => i + 1));
      expect(plan.steps.at(-1)!.end).toBeCloseTo(plan.assembled - plan.flight, 9);
    }
  expect(fall(0).lift).toBeCloseTo(DROP, 9);
  expect(fall(1)).toEqual({ lift: 0, tilt: 0 });
  expect(Math.min(...Array.from({ length: 101 }, (_, i) => fall(i / 100).lift))).toBeLessThan(0);
  expect(() => planFilm({ pieces: [], steps: [] }, 12)).toThrow();
  expect(() => planFilm(fixture(), 5)).toThrow();
  expect(filmFilename("a/b:c?.", "gif")).toBe("a-b-c--build.gif");
  expect(filmCaption(fixture(), true)).toContain("Holo4 27B by H Company");
  expect(filmCaption(fixture(), false)).not.toContain("H Company");
  expect(filmCaption({ ...fixture(), builder: "claude" }, true)).not.toContain("H Company");
});

test("missing parts block exporting a misleading partial model; other builders carry no Holo attribution", async ({
  page,
}) => {
  await mock(page, { ...fixture(), builder: "claude", parts: {} });
  await openFilm(page);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("alert")).toContainText("Invalid render asset: test-brick");
  await expect(dialog.getByRole("button", { name: /Making the GIF/ })).toHaveCount(0);
  await expect(dialog.getByRole("link", { name: "Download GIF" })).toHaveCount(0);
  await expect(dialog.getByLabel("Suggested caption")).not.toContainText("Holo4");
  await dialog.getByText("Options").click();
  await expect(dialog.getByRole("combobox", { name: "Duration", exact: true })).toBeVisible();
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test("close-up follow camera exports a credited GIF and offers orbit and fixed alternatives", async ({
  page,
}, testInfo) => {
  // Software WebGL on CI takes several minutes to render the real 160-frame export.
  test.setTimeout(600000);
  await page.addInitScript(() => {
    const credits: { text: string; fits: boolean; font: string }[] = [];
    Object.assign(window, { filmCredits: credits });
    const fill = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, ...rest) {
      if (text.startsWith("Powered by ") || text === "from H Company")
        credits.push({ text, fits: x + this.measureText(text).width <= this.canvas.width, font: this.font });
      return fill.call(this, text, x, y, ...rest);
    };
  });
  await mock(page);
  await openFilm(page);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Suggested caption")).toContainText("Holo4 27B by H Company");
  await dialog.getByText("Options", { exact: true }).click();
  const camera = dialog.getByRole("combobox", { name: "Camera", exact: true });
  await expect(camera).toHaveValue("follow");
  await expect(camera.locator("option")).toHaveText(["Follow build", "Orbit", "Fixed"]);
  await expect(dialog.getByRole("checkbox", { name: "H Company credit" })).toBeChecked();
  const link = dialog.getByRole("link", { name: "Download GIF", exact: true });
  await expect(link).toBeVisible({ timeout: 540000 });
  const pending = page.waitForEvent("download");
  await link.click();
  const download = await pending;
  const bytes = await readFile(await download.path());
  expect(bytes.subarray(0, 6).toString()).toBe("GIF89a");
  expect(bytes.includes(Buffer.from("NETSCAPE2.0"))).toBe(true);
  expect([bytes.readUInt16LE(6), bytes.readUInt16LE(8)]).toEqual([640, 360]);
  const credits = await page.evaluate(
    () => (window as unknown as { filmCredits: { text: string; fits: boolean }[] }).filmCredits,
  );
  expect(credits.filter((c) => c.text === "Powered by Holo4 27B").length).toBeGreaterThanOrEqual(160);
  expect(credits.filter((c) => c.text === "from H Company").length).toBeGreaterThanOrEqual(160);
  expect(credits.every((c) => c.fits)).toBe(true);
  await dialog.locator(".film-preview img").screenshot({ path: testInfo.outputPath("credited-gif.png") });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
