import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { decompressFrames, parseGIF } from "gifuct-js";
import type { Build } from "../src/api";
import { planReplay, replayFilename, replayPieces } from "../src/replayPlan";

import { part, colors, fixture } from "./fixtures";

const PIECES = fixture().pieces.length;

async function mock(page: Page, build = fixture(), missingPart = false) {
  const mutations: string[] = [];
  const parts: string[] = [];
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
    if (path === "/api/builds/export-test/state")
      return route.fulfill({
        json: {
          token: String(build.pieces.length),
          build: new URL(request.url()).searchParams.get("after") === String(build.pieces.length) ? null : build,
          renders: [],
        },
      });
    if (path === "/api/ldconfig") return route.fulfill({ body: colors });
    if (path.startsWith("/api/parts/")) {
      parts.push(path);
      return route.fulfill({ body: part, status: missingPart ? 404 : 200 });
    }
    return route.fulfill({ status: 404 });
  });
  await page.goto("/?build=export-test");
  await expect(page.getByRole("button", { name: "Export GIF", exact: true })).toBeEnabled();
  return { mutations, parts };
}

async function downloadGif(page: Page, path: string) {
  const link = page.getByRole("dialog").getByRole("link", { name: "Download GIF" });
  await expect(link).toBeVisible({ timeout: 60000 });
  const pending = page.waitForEvent("download");
  await link.click();
  const download = await pending;
  await download.saveAs(path);
  const bytes = await readFile(path);
  const gif = parseGIF(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  return { download, bytes, gif };
}

/** Hashes of the whole preview and of its model area, which excludes the text's antialiasing noise. */
const preview = (page: Page) =>
  page
    .getByRole("dialog")
    .getByLabel("Assembly replay preview")
    .evaluate(async (canvas: HTMLCanvasElement) => {
      const hash = async (y: number, height: number) => {
        const { data } = canvas.getContext("2d")!.getImageData(0, y, canvas.width, height);
        const digest = await crypto.subtle.digest("SHA-256", data);
        return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
      };
      return { frame: await hash(0, canvas.height), model: await hash(140, canvas.height - 240) };
    });

test("timing covers a single brick and very large timelines without unbounded frames", () => {
  for (const count of [1, 2, 24, 50000])
    for (const seconds of [8, 12, 20]) {
      const frames = planReplay(count, seconds);
      expect(frames.length).toBeLessThanOrEqual(121);
      expect(frames[0].pieces).toBe(0);
      expect(frames.at(-1)!.pieces).toBe(count);
      expect(frames.at(-1)).toEqual({ pieces: count, delay: 1000, turn: 0 });
      expect(frames.reduce((sum, f) => sum + f.delay, 0)).toBe(seconds * 1000);
      expect(frames.every((f) => f.delay > 0 && f.delay % 10 === 0)).toBe(true);
      const assembly = frames.filter((f) => f.turn === undefined);
      expect(assembly.slice(1).every((f, i) => f.pieces > assembly[i].pieces)).toBe(true);
      const finale = frames.filter((f) => f.turn !== undefined);
      expect(finale.every((f) => f.pieces === count)).toBe(true);
      expect(finale.reduce((sum, f) => sum + f.delay, 0)).toBe(4000);
      expect(finale[0].turn).toBe(0);
      expect(new Set(finale.map((f) => f.turn)).size).toBe(30);
    }
  expect(() => planReplay(0, 12)).toThrow();
  const original = fixture().pieces.reverse();
  const copy = structuredClone(original);
  const { ordered, rendered } = replayPieces(original);
  expect(original).toEqual(copy);
  expect(ordered.map((p) => p.id)).toEqual(Array.from({ length: 8 }, (_, i) => i));
  expect(rendered.at(-1)!.step).toBe(7);
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
  const { mutations, parts } = await mock(page);
  await expect(page.locator(".brick-loader")).toHaveCount(0);
  await page.getByRole("slider", { name: "Step", exact: true }).fill("1");
  await page.getByRole("button", { name: "Export GIF", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Generate GIF", exact: true })).toBeEnabled();
  const loads = parts.length;
  const branding = dialog.getByRole("checkbox", { name: "HOLO4 / H Company branding" });
  const branded = await preview(page);
  await branding.uncheck();
  await expect.poll(async () => (await preview(page)).frame).not.toBe(branded.frame);
  expect((await preview(page)).model).toBe(branded.model);
  await branding.check();
  // Even when assembly is viewed from above, the finale must turn and finish at the front.
  await dialog.getByRole("combobox", { name: "Camera", exact: true }).selectOption("top");
  await expect.poll(async () => (await preview(page)).model).not.toBe(branded.model);
  expect(parts).toHaveLength(loads);
  await expect(page.locator('body > div[aria-hidden="true"]')).toHaveCount(1);
  await dialog.screenshot({ path: info.outputPath("preview.png") });
  const before = await page
    .locator(".viewer-canvas canvas")
    .evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  await dialog.getByRole("button", { name: "Generate GIF", exact: true }).click();
  const { download, bytes, gif } = await downloadGif(page, info.outputPath("assembly.gif"));
  expect(download.suggestedFilename()).toBe("A little LEGO tower-assembly.gif");
  expect(gif.lsd.width).toBe(640);
  expect(gif.lsd.height).toBe(640);
  const frames = decompressFrames(gif, true);
  const plan = planReplay(PIECES, 12, replayPieces(fixture().pieces).stepEnds);
  expect(frames.map((f) => f.delay)).toEqual(plan.map((f) => f.delay));
  expect(frames.reduce((sum, f) => sum + f.delay, 0)).toBe(12000);
  const modelPixels = (f: (typeof frames)[number]) => f.patch.slice(640 * 4 * 140, 640 * 4 * 520);
  const spin = plan.findIndex((f) => f.turn === 0);
  const [assembled, front, turning] = frames.slice(spin - 1, spin + 2).map(modelPixels);
  expect(modelPixels(frames[0])).not.toEqual(modelPixels(frames.at(-1)!));
  expect(assembled).not.toEqual(front);
  expect(front).not.toEqual(turning);
  expect(front).toEqual(modelPixels(frames.at(-1)!));
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

test("a live snapshot stays frozen, cancellation can retry, and closing releases its renderer", async ({
  page,
}, info) => {
  const build = fixture();
  build.status = "building";
  const { mutations } = await mock(page, build);
  await page.getByRole("button", { name: "Export GIF", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Generate GIF", exact: true })).toBeEnabled();
  build.pieces.push({ ...build.pieces[0], id: 100, step: 4 });
  build.steps.push({ index: 4, title: "New layer" });
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
  await expect(dialog.getByLabel("Suggested caption")).toContainText("8 LEGO pieces");
  await expect(dialog.getByLabel("Suggested caption")).toContainText("work in progress");
  await dialog.getByRole("combobox", { name: "Format", exact: true }).selectOption("portrait");
  await expect(dialog.getByLabel("Assembly replay preview")).toHaveJSProperty("height", 800);
  const still = await preview(page);
  // Hold the encoder's script so the export is still running after its first frame.
  await page.route("**/gif.worker*", () => {});
  await dialog.getByRole("button", { name: "Generate GIF", exact: true }).click();
  await expect.poll(async () => (await preview(page)).model).not.toBe(still.model);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Generate GIF", exact: true })).toBeEnabled();
  await expect(dialog.getByRole("link", { name: "Download GIF" })).toHaveCount(0);
  expect((await preview(page)).model).toBe(still.model);
  await page.unroute("**/gif.worker*");
  await dialog.getByRole("button", { name: "Generate GIF", exact: true }).click();
  const { gif } = await downloadGif(page, info.outputPath("portrait.gif"));
  expect([gif.lsd.width, gif.lsd.height]).toEqual([640, 800]);
  await expect(dialog.getByText("640 × 800", { exact: false })).toBeVisible();
  await dialog.getByRole("button", { name: "Close export" }).click();
  await expect(page.locator('body > div[aria-hidden="true"]')).toHaveCount(0);
  await expect(page.locator(".chip").filter({ hasText: "9 pieces" })).toBeVisible();
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
  await expect(dialog.getByRole("alert")).toContainText("Could not load /api/parts/");
  await expect(dialog.getByRole("button", { name: "Generate GIF", exact: true })).toBeDisabled();
  await expect(dialog.getByLabel("Suggested caption")).not.toContainText("HOLO4");
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);
  await page.route("**/api/parts/**", (route) => route.fulfill({ body: part }));
  await dialog.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Generate GIF", exact: true })).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});
