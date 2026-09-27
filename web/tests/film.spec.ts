import { expect, test, type Page, type Route } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { decompressFrames, parseGIF } from "gifuct-js";
import type { Build, FilmJob } from "../src/api";
import { DROP, fall, filmFilename, frameCount, landed, planFilm, started } from "../src/filmPlan";
import { colors, fixture, part } from "./fixtures";

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

type Films = (route: Route, method: string, path: string) => Promise<void> | undefined;

async function mock(
  page: Page,
  { build = fixture(), missingPart = false, films }: { build?: Build; missingPart?: boolean; films?: Films } = {},
) {
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
    const handled = films?.(route, request.method(), path);
    if (handled) return handled;
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
    if (path.startsWith("/api/parts/")) return route.fulfill({ body: part, status: missingPart ? 404 : 200 });
    return route.fulfill({ status: 404 });
  });
  await page.goto("/?build=export-test");
  await expect(page.getByRole("button", { name: "Export film", exact: true })).toBeEnabled();
  return { mutations };
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

test("without a film server, the browser makes a looping GIF and leaves the viewer untouched", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const { mutations } = await mock(page);
  await expect(page.locator(".brick-loader")).toHaveCount(0);
  await page.getByRole("slider", { name: "Step", exact: true }).fill("1");
  await page.getByRole("button", { name: "Export film", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Generate GIF", exact: true })).toBeEnabled();
  const branding = dialog.getByRole("checkbox", { name: "HOLO4 / H Company branding" });
  const branded = await preview(page);
  await branding.uncheck();
  await expect.poll(async () => (await preview(page)).frame).not.toBe(branded.frame);
  expect((await preview(page)).model).toBe(branded.model);
  await branding.check();
  await dialog.getByRole("combobox", { name: "Duration", exact: true }).selectOption("8");
  const still = await preview(page);
  await dialog.screenshot({ path: info.outputPath("preview.png") });
  const viewer = () =>
    page.locator(".viewer-canvas canvas").evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  const before = await viewer();

  await dialog.getByRole("button", { name: "Generate GIF", exact: true }).click();
  const link = dialog.getByRole("link", { name: "Download GIF" });
  await expect(link).toBeVisible({ timeout: 90000 });
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
  expect(mutations).toEqual([]);
  expect(errors).toEqual([]);
});

test("the server renders MP4 and GIF with progress, cancellation and retry, from a frozen live snapshot", async ({
  page,
}) => {
  const build = fixture();
  build.status = "building";
  const requests: string[] = [];
  const bodies: unknown[] = [];
  const polls = new Map<string, number>();
  const job = (id: string, status: FilmJob["status"], progress: number): FilmJob => ({
    id,
    build: build.id,
    name: build.name,
    status,
    progress,
    error: null,
    frames: 1200,
    samples: 12,
    budget: 900,
    elapsed: 0,
    options: { width: 1920, height: 1080, seconds: 20, fps: 60, samples: null, branded: true, label: null, dof: false },
    files:
      status === "done"
        ? {
            mp4: { size: 2 * 1024 * 1024, width: 1920, height: 1080, fps: 60 },
            gif: { size: 1024 * 1024, width: 720, height: 405, fps: 30 },
          }
        : {},
  });
  const films: Films = (route, method, path) => {
    if (path === "/api/films") return route.fulfill({ json: { available: true, reason: null } });
    if (path.includes("/film.")) return route.fulfill({ status: 404 });
    if (!path.startsWith("/api/films/") && !path.endsWith("/film")) return;
    requests.push(`${method} ${path}`);
    if (method === "POST") {
      bodies.push(route.request().postDataJSON());
      return route.fulfill({ json: job(`job-${bodies.length}`, "queued", 0) });
    }
    if (method === "DELETE") return route.fulfill({ status: 204 });
    const id = path.split("/")[3];
    const count = (polls.get(id) ?? 0) + 1;
    polls.set(id, count);
    if (id === "job-1") return route.fulfill({ json: job(id, "rendering", 0.25) });
    return route.fulfill({ json: count < 2 ? job(id, "rendering", 0.5) : job(id, "done", 1) });
  };
  const { mutations } = await mock(page, { build, films });
  await page.getByRole("button", { name: "Export film", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const render = dialog.getByRole("button", { name: "Render MP4 + GIF", exact: true });
  await expect(render).toBeEnabled();
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

  await render.click();
  await expect(dialog.getByText("Rendering… 25%")).toBeVisible();
  await expect(dialog.getByRole("progressbar", { name: "Film progress" })).toHaveJSProperty("value", 0.25);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(render).toBeEnabled();
  await expect.poll(() => requests).toContain("DELETE /api/films/job-1");

  await render.click();
  const mp4 = dialog.getByRole("link", { name: "Download MP4 · 2.0 MB" });
  await expect(mp4).toHaveAttribute("href", "/api/films/job-2/film.mp4");
  await expect(dialog.getByRole("link", { name: "Download GIF · 1.0 MB" })).toHaveAttribute(
    "href",
    "/api/films/job-2/film.gif",
  );
  await expect(dialog.getByText("1920 × 1080 · 60 fps · 12 samples per frame")).toBeVisible();
  await expect(dialog.getByText("GIF: 720 × 405 at 30 fps", { exact: false })).toBeVisible();
  expect(bodies).toEqual([
    { aspect: "16:9", seconds: 20, branded: true },
    { aspect: "16:9", seconds: 20, branded: true },
  ]);
  await dialog.getByRole("button", { name: "Close export" }).click();
  await expect(page.locator(".chip").filter({ hasText: "9 pieces" })).toBeVisible();
  expect(mutations).toEqual([]);
});

test("missing parts block exporting a misleading partial model; scripted demos carry no Holo attribution", async ({
  page,
}) => {
  const build = fixture();
  build.builder = "demo";
  await mock(page, { build, missingPart: true });
  await page.getByRole("button", { name: "Export film", exact: true }).click();
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
