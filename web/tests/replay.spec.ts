import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { decompressFrames, parseGIF } from "gifuct-js";
import type { Build } from "../src/api";
import { planReplay, replayFilename, replayPieces } from "../src/replayPlan";

// Offline test geometry, deliberately independent of the LDraw install and inference server.
const part = `0 FILE main.ldr
1 16 0 0 0 1 0 0 0 1 0 0 0 1 test-brick.dat
0 FILE test-brick.dat
0 BFC CERTIFY CCW
4 16 -20 0 -20 20 0 -20 20 0 20 -20 0 20
4 16 -20 24 20 20 24 20 20 24 -20 -20 24 -20
4 16 -20 0 20 20 0 20 20 24 20 -20 24 20
4 16 20 0 -20 -20 0 -20 -20 24 -20 20 24 -20
4 16 20 0 20 20 0 -20 20 24 -20 20 24 20
4 16 -20 0 -20 -20 0 20 -20 24 20 -20 24 -20
0 NOFILE`;
const colors = `0 !COLOUR Red CODE 4 VALUE #C91A09 EDGE #333333
0 !COLOUR Yellow CODE 14 VALUE #F2CD37 EDGE #333333
0 !COLOUR Blue CODE 1 VALUE #0055BF EDGE #333333
0 !COLOUR Green CODE 2 VALUE #237841 EDGE #333333
0 !COLOUR Main_Colour CODE 16 VALUE #FFFF80 EDGE #333333
0 !COLOUR Edge_Colour CODE 24 VALUE #333333 EDGE #333333`;

function fixture(): Build {
  return {
    id: "export-test",
    name: "A little LEGO tower",
    prompt: "A little LEGO tower",
    builder: "holo",
    status: "done",
    created: 1,
    updated: 1,
    width: 6,
    depth: 4,
    messages: [],
    steps: Array.from({ length: 4 }, (_, index) => ({ index, title: `Layer ${index + 1}` })),
    pieces: Array.from({ length: 24 }, (_, id) => ({
      id,
      part: "test-brick",
      color: [4, 14, 1, 2][Math.floor(id / 6)],
      step: Math.floor(id / 6),
      pos: [(id % 3) * 40, -Math.floor(id / 6) * 24, Math.floor((id % 6) / 3) * 40],
      rot: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    })),
  };
}

async function mock(page: Page, build = fixture(), missingPart = false) {
  const mutations: string[] = [];
  await page.addInitScript(() => {
    class Events {
      onmessage: ((event: { data: string }) => void) | null = null;
      constructor() {
        (window as any).events = this;
      }
      close() {}
    }
    (window as any).EventSource = Events;
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => false });
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== "GET") {
      mutations.push(`${request.method()} ${path}`);
      return route.fulfill({ status: 403 });
    }
    if (path === "/api/builds")
      return route.fulfill({
        json: [{ ...build, pieces: build.pieces.length, steps: build.steps.length, thumbnail: 9999999999999 }],
      });
    if (path === "/api/builds/export-test") return route.fulfill({ json: build });
    if (path === "/api/ldconfig") return route.fulfill({ body: colors });
    if (path.startsWith("/api/parts/")) return route.fulfill({ body: part, status: missingPart ? 404 : 200 });
    return route.fulfill({ status: 404 });
  });
  await page.goto("/?build=export-test");
  await expect(page.getByRole("button", { name: "Export GIF", exact: true })).toBeEnabled();
  return mutations;
}

test("timing covers a single brick and very large timelines without unbounded frames", () => {
  for (const count of [1, 2, 24, 50000])
    for (const seconds of [8, 12, 20]) {
      const frames = planReplay(count, seconds);
      expect(frames.length).toBeLessThanOrEqual(121);
      expect(frames[0].pieces).toBe(0);
      expect(frames.at(-1)!.pieces).toBe(count);
      expect(frames.at(-1)!.delay).toBeGreaterThanOrEqual(2000);
      expect(frames.reduce((sum, f) => sum + f.delay, 0)).toBe(seconds * 1000);
      expect(frames.every((f) => f.delay > 0 && f.delay % 10 === 0)).toBe(true);
      expect(frames.slice(1).every((f, i) => f.pieces > frames[i].pieces)).toBe(true);
    }
  expect(() => planReplay(0, 12)).toThrow();
  const original = fixture().pieces.reverse();
  const copy = structuredClone(original);
  const { ordered, rendered } = replayPieces(original);
  expect(original).toEqual(copy);
  expect(ordered.map((p) => p.id)).toEqual(Array.from({ length: 24 }, (_, i) => i));
  expect(rendered.at(-1)!.step).toBe(23);
  expect(replayFilename("a/b:c?.")).toBe("a-b-c--assembly.gif");
  const uneven = planReplay(1000, 12, [990, 991, 1000]);
  let elapsed = 0;
  const middle = uneven.find((frame) => {
    elapsed += frame.delay;
    return elapsed >= 6000;
  });
  expect(middle!.pieces).toBeGreaterThanOrEqual(991);
  expect(uneven.reduce((sum, f) => sum + f.delay, 0)).toBe(12000);
  expect(uneven.at(-1)!.pieces).toBe(1000);
});

test("downloads a decodable looping GIF, preserves the viewer, and shares the actual file", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const mutations = await mock(page);
  await expect(page.locator(".brick-loader")).toHaveCount(0);
  await page.getByRole("slider", { name: "Step", exact: true }).fill("1");
  await page.getByRole("button", { name: "Export GIF", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Generate GIF", exact: true })).toBeEnabled();
  await dialog.screenshot({ path: info.outputPath("preview.png") });
  const before = await page
    .locator(".viewer-canvas canvas")
    .evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  await dialog.getByRole("button", { name: "Generate GIF", exact: true }).click();
  const downloadLink = dialog.getByRole("link", { name: "Download GIF" });
  await expect(downloadLink).toBeVisible({ timeout: 45000 });
  const pendingDownload = page.waitForEvent("download");
  await downloadLink.click();
  const download = await pendingDownload;
  const path = info.outputPath("assembly.gif");
  await download.saveAs(path);
  expect(download.suggestedFilename()).toBe("A little LEGO tower-assembly.gif");
  const bytes = await readFile(path);
  const gif = parseGIF(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  expect(gif.lsd.width).toBe(640);
  expect(gif.lsd.height).toBe(640);
  const frames = decompressFrames(gif, true);
  expect(frames).toHaveLength(25);
  expect(frames.reduce((sum, f) => sum + f.delay, 0)).toBe(12000);
  expect(frames.at(-1)!.delay).toBeGreaterThanOrEqual(2000);
  // Check actual decoded model-area pixels, not just a changing progress label.
  const modelPixels = (f: (typeof frames)[number]) => f.patch.slice(640 * 4 * 140, 640 * 4 * 520);
  expect(modelPixels(frames[0])).not.toEqual(modelPixels(frames.at(-1)!));
  expect(bytes.includes(Buffer.from("NETSCAPE2.0"))).toBe(true);
  await expect(dialog.getByText("File sharing is unavailable", { exact: false })).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
    Object.defineProperty(navigator, "share", {
      value: async (data: ShareData) => {
        (window as any).shared = {
          name: data.files![0].name,
          type: data.files![0].type,
          size: data.files![0].size,
          text: data.text,
          url: data.url,
        };
      },
      configurable: true,
    });
  });
  // Trigger a render so feature detection sees the newly mocked platform capability.
  await dialog.getByRole("button", { name: "Copy caption" }).click();
  await dialog.getByRole("button", { name: "Share…", exact: true }).click();
  const shared = await page.evaluate(() => (window as any).shared);
  expect(shared).toMatchObject({ name: download.suggestedFilename(), type: "image/gif", size: bytes.length });
  expect(shared.text).toContain("HOLO4");
  expect(shared.url).toBeUndefined();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("slider", { name: "Step", exact: true })).toHaveValue("1");
  expect(await page.locator(".viewer-canvas canvas").evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).toBe(
    before,
  );
  expect(mutations).toEqual([]);
  expect(errors).toEqual([]);
});

test("a live snapshot stays frozen, cancellation can retry, and closing releases its renderer", async ({ page }) => {
  const build = fixture();
  build.status = "building";
  const mutations = await mock(page, build);
  await page.getByRole("button", { name: "Export GIF", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Generate GIF", exact: true })).toBeEnabled();
  await page.evaluate((piece) => {
    (window as any).events.onmessage({
      data: JSON.stringify({
        type: "step",
        step: { index: 4, title: "New layer" },
        pieces: [{ ...piece, id: 100, step: 4 }],
        width: 6,
        depth: 4,
      }),
    });
  }, build.pieces[0]);
  await expect(dialog.getByLabel("Suggested caption")).toContainText("24 LEGO pieces");
  await expect(dialog.getByLabel("Suggested caption")).toContainText("work in progress");
  await dialog.getByRole("combobox", { name: "Format", exact: true }).selectOption("portrait");
  await expect(dialog.getByRole("button", { name: "Generate GIF", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Generate GIF", exact: true }).click();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Generate GIF", exact: true })).toBeEnabled();
  await expect(dialog.getByRole("link", { name: "Download GIF" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Generate GIF", exact: true }).click();
  await expect(dialog.getByRole("link", { name: "Download GIF" })).toBeVisible({ timeout: 45000 });
  await expect(dialog.getByText("640 × 800", { exact: false })).toBeVisible();
  await dialog.getByRole("button", { name: "Close export" }).click();
  await expect(page.locator('body > div[aria-hidden="true"]')).toHaveCount(0);
  await expect(page.locator(".chip").filter({ hasText: "25 pieces" })).toBeVisible();
  expect(mutations).toEqual([]);
});

test("missing parts block exporting a misleading partial model; scripted demos carry no Holo attribution", async ({
  page,
}) => {
  const build = fixture();
  build.builder = "demo";
  await mock(page, build, true);
  await page.getByRole("button", { name: "Export GIF", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("alert")).toContainText("Could not load part");
  await expect(dialog.getByRole("button", { name: "Generate GIF", exact: true })).toBeDisabled();
  await expect(dialog.getByLabel("Suggested caption")).not.toContainText("HOLO4");
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);
  await page.route("**/api/parts/**", (route) => route.fulfill({ body: part }));
  await dialog.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Generate GIF", exact: true })).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});
