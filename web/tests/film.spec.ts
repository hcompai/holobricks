import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { decompressFrames, parseGIF } from "gifuct-js";
import type { Build } from "../src/model";
import { DROP, fall, filmFilename, frameCount, landed, planFilm, started } from "../src/filmPlan";
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
  const requests: string[] = [];
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => false }),
  );
  page.on("request", (r) => r.method() !== "GET" && requests.push(`${r.method()} ${r.url()}`));
  await site(page, [build]);
  await page.goto(`/?showcase=${build.id}`);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Share a GIF…" })).toBeEnabled();
  await page.keyboard.press("Escape");
  return { requests };
}

async function openFilm(page: Page) {
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await page.getByRole("menuitem", { name: "Share a GIF…" }).click();
}

/** Hashes of the whole preview and of its model area, between the corner title and the lower third. */
const preview = (page: Page) =>
  page
    .getByRole("dialog")
    .getByLabel("Film preview")
    .evaluate(async (canvas: HTMLCanvasElement) => {
      const hash = async (y: number, height: number) => {
        const { data } = canvas.getContext("2d")!.getImageData(0, y, canvas.width, height);
        const digest = await crypto.subtle.digest("SHA-256", data);
        return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
      };
      const top = Math.round(canvas.height * 0.18);
      return { frame: await hash(0, canvas.height), model: await hash(top, Math.round(canvas.height * 0.72) - top) };
    });

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
});

test("the browser makes a looping GIF and leaves the viewer untouched", async ({ page }, info) => {
  // On CPU-only CI the real 160-frame export is still progressing when the
  // default two-minute test budget expires. Keep the full render assertions.
  test.setTimeout(300000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const { requests } = await mock(page);
  await expect(page.locator(".brick-loader")).toHaveCount(0);
  await page.getByRole("slider", { name: "Step", exact: true }).fill("1");
  await openFilm(page);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Make the GIF", exact: true })).toBeEnabled({ timeout: 60000 });
  const branding = dialog.getByRole("checkbox", { name: "H Company logo" });
  const branded = await preview(page);
  await branding.uncheck();
  await expect.poll(async () => (await preview(page)).frame).not.toBe(branded.frame);
  expect((await preview(page)).model).toBe(branded.model);
  await branding.check();
  await expect(dialog.getByRole("combobox", { name: "Duration", exact: true })).toHaveValue("8");
  const still = await preview(page);
  await dialog.screenshot({ path: info.outputPath("preview.png") });
  const viewer = () =>
    page.locator(".viewer-canvas canvas").evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  const before = await viewer();

  await dialog.getByRole("button", { name: "Make the GIF", exact: true }).click();
  const link = dialog.getByRole("link", { name: "Download GIF" });
  await expect(link).toBeVisible({ timeout: 240000 });
  const pending = page.waitForEvent("download");
  await link.click();
  const download = await pending;
  await download.saveAs(info.outputPath("film.gif"));
  const bytes = await readFile(info.outputPath("film.gif"));
  expect(download.suggestedFilename()).toBe("A little LEGO tower-build.gif");
  expect(bytes.includes(Buffer.from("NETSCAPE2.0"))).toBe(true);
  const gif = parseGIF(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  expect([gif.lsd.width, gif.lsd.height]).toEqual([640, 360]);
  const frames = decompressFrames(gif, false);
  expect(frames).toHaveLength(8 * 20);
  expect(frames.every((f) => f.delay === 50)).toBe(true);
  expect(frames.slice(1).every((f) => f.transparentIndex === 255)).toBe(true);
  // A frame depends only on its index, so rendering the whole film leaves the preview exactly as it was.
  await expect(dialog.getByLabel("Film preview")).toBeHidden();
  expect((await preview(page)).model).toBe(still.model);

  await page.evaluate(() => {
    Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
    Object.defineProperty(navigator, "share", {
      value: async (data: ShareData) => {
        (window as any).shared = { name: data.files![0].name, type: data.files![0].type, text: data.text };
      },
      configurable: true,
    });
  });
  // Trigger a render so feature detection sees the newly mocked platform capability.
  await dialog.getByRole("button", { name: "Copy caption" }).click();
  await dialog.getByRole("button", { name: "Share…", exact: true }).click();
  expect(await page.evaluate(() => (window as any).shared)).toMatchObject({
    name: download.suggestedFilename(),
    type: "image/gif",
    text: expect.stringContaining("HOLO4"),
  });
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("slider", { name: "Step", exact: true })).toHaveValue("1");
  expect(await viewer()).toBe(before);
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});

test("missing parts block exporting a misleading partial model; other builders carry no Holo attribution", async ({
  page,
}) => {
  await mock(page, { ...fixture(), builder: "claude", parts: {} });
  await openFilm(page);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("alert")).toContainText("Invalid render asset: test-brick");
  await expect(dialog.getByRole("button", { name: "Make the GIF", exact: true })).toBeDisabled();
  await expect(dialog.getByLabel("Suggested caption")).not.toContainText("HOLO4");
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});
