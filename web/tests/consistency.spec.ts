import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import type { Build, RenderRequest } from "../src/api";
import { part, colors, fixture } from "./fixtures";

function revision(build: Build) {
  build.revision = createHash("sha256")
    .update(
      JSON.stringify(
        build.pieces.map((p) => [
          p.id,
          p.part,
          p.color,
          p.step,
          ...[...p.pos, ...p.rot].map((v) => Math.round(v * 1e6)),
        ]),
      ),
    )
    .digest("hex");
  return build;
}

async function setup(page: Page) {
  const state = {
    build: revision(fixture()),
    offline: false,
    brokenPart: false,
    pending: [] as RenderRequest[],
    answers: [] as string[],
  };
  await page.addInitScript(() => {
    class Events {
      onmessage: ((event: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      closed = false;
      constructor() {
        (window as any).events = this;
      }
      close() {
        this.closed = true;
      }
    }
    (window as any).EventSource = Events;
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/builds")
      return route.fulfill({
        json: [
          {
            ...state.build,
            pieces: state.build.pieces.length,
            steps: state.build.steps.length,
            thumbnail: 9999999999999,
          },
        ],
      });
    if (path.endsWith("/state")) {
      if (state.offline) return route.fulfill({ status: 503 });
      const token = JSON.stringify(state.build);
      const after = new URL(route.request().url()).searchParams.get("after");
      return route.fulfill({ json: { token, build: token === after ? null : state.build, renders: state.pending } });
    }
    if (path.includes("/renders/")) {
      state.answers.push(route.request().headers()["x-revision"]);
      return route.fulfill({ json: { accepted: true } });
    }
    if (path === "/api/ldconfig") return route.fulfill({ body: colors });
    if (path.startsWith("/api/parts/")) return route.fulfill({ status: state.brokenPart ? 404 : 200, body: part });
    return route.fulfill({ status: 404 });
  });
  return state;
}
const ready = (page: Page, build: Build) =>
  expect(page.locator(".viewer")).toHaveAttribute("data-revision", build.revision!);
const pixels = (page: Page) => page.locator(".viewer-canvas canvas").evaluate((c: HTMLCanvasElement) => c.toDataURL());

test("lost events repair from a full snapshot; same-count changes redraw pixels and obsolete deltas cannot rewind it", async ({
  page,
}) => {
  const state = await setup(page);
  state.build.status = "building";
  await page.goto("/?build=export-test");
  await ready(page, state.build);
  const before = await pixels(page);
  state.build = revision({ ...state.build, pieces: state.build.pieces.map((p) => ({ ...p, color: 1 })) });
  // No event at all: the independent poll must detect a same-count recolor.
  await ready(page, state.build);
  expect(await pixels(page)).not.toBe(before);
  await page.evaluate(() => (window as any).events.onmessage({ data: JSON.stringify({ type: "rewind", steps: 0 }) }));
  await page.waitForTimeout(250);
  await expect(page.locator(".chip").filter({ hasText: "8 pieces" })).toBeVisible();
  await ready(page, state.build);
  // Connection failure is visible, old pixels are not presented as current, and it recovers without reload.
  state.offline = true;
  await expect(page.getByRole("alert")).toContainText("latest model cannot be confirmed");
  await expect(page.locator(".viewer-canvas")).toHaveCSS("visibility", "hidden");
  state.offline = false;
  state.build.status = "done";
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator(".viewer-canvas")).toHaveCSS("visibility", "visible");
  expect(await page.evaluate(() => (window as any).events.closed)).toBe(true);
});

test("missing geometry fails closed and reload recovers; context loss never leaves a trusted stale canvas", async ({
  page,
}) => {
  const state = await setup(page);
  state.brokenPart = true;
  await page.goto("/?build=export-test");
  await expect(page.getByRole("alert")).toContainText("HTTP 404");
  await expect(page.locator(".viewer")).not.toHaveAttribute("data-revision");
  await expect(page.locator(".viewer-canvas")).toHaveCSS("visibility", "hidden");
  state.brokenPart = false;
  await page.getByRole("button", { name: "Reload model" }).click();
  await ready(page, state.build);
  await page.locator(".viewer-canvas canvas").evaluate((canvas: HTMLCanvasElement) => {
    canvas.getContext("webgl2")!.getExtension("WEBGL_lose_context")!.loseContext();
  });
  await expect(page.getByRole("alert")).toContainText("3D connection was lost");
  await expect(page.locator(".viewer-canvas")).toHaveCSS("visibility", "hidden");
  await page.getByRole("button", { name: "Reload model" }).click();
  await ready(page, state.build);
});

test("a hung asset times out, then retries; agent requests are recovered without SSE and tied to the actual revision", async ({
  page,
}) => {
  const state = await setup(page);
  const hang = () => new Promise<void>(() => {});
  await page.route("**/api/parts/**", hang);
  await page.goto("/?build=export-test");
  await expect(page.getByRole("alert")).toContainText("timed out", { timeout: 25000 });
  await page.unroute("**/api/parts/**", hang);
  await page.getByRole("button", { name: "Reload model" }).click();
  await ready(page, state.build);
  const request = { request: "current", revision: state.build.revision!, pieces: 8, camera: null, box: null };
  state.pending = [{ ...request, revision: "obsolete", request: "obsolete" }];
  await page.waitForTimeout(5500);
  expect(state.answers).toEqual([]);
  state.pending = [request];
  await expect.poll(() => state.answers).toEqual([state.build.revision]);
  await ready(page, state.build);
});

test("an in-flight obsolete model cannot overwrite or acknowledge a newer model; a failed cache entry can retry", async ({
  page,
}) => {
  const state = await setup(page);
  await page.goto("/");
  await page.evaluate(async (build) => {
    const { BrickScene } = await import("/src/scene.ts");
    const host = document.createElement("div");
    host.style.cssText = "width:256px;height:256px";
    document.body.append(host);
    (window as any).scene = new BrickScene(host, { replay: true });
    (window as any).pieces = build.pieces;
  }, state.build);
  let release!: () => void;
  const blocked = new Promise<void>((r) => {
    release = r;
  });
  await page.route("**/api/parts/slow.dat", async (route) => {
    await blocked;
    await route.fulfill({ body: part });
  });
  const request = page.waitForRequest("**/api/parts/slow.dat");
  await page.evaluate(() => {
    const w = window as any;
    w.old = w.scene.setPieces(w.pieces.map((p: any) => ({ ...p, part: "slow.dat" })));
  });
  await request;
  await page.evaluate(() => {
    const w = window as any;
    w.latest = w.scene.setPieces(w.pieces);
  });
  release();
  const result = await page.evaluate(async () => {
    const w = window as any;
    const result = [await w.old, await w.latest];
    w.scene.dispose();
    return result;
  });
  expect(result).toEqual([false, true]);
});
