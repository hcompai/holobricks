import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { planPlacement, placedCount } from "../src/placement";
import type { Piece } from "../src/model";
import { fixture, revised, site } from "./fixtures";
import { platform } from "./platform";

test("placements follow steps and LDraw layers, preserve unchanged pieces and reveal recolors and moves", () => {
  const pieces = fixture().pieces;
  const moved: Piece = { ...pieces[0], pos: [120, 0, 0] };
  const recolored: Piece = { ...pieces[1], color: 1 };
  const next = [...pieces.slice(2), moved, recolored];
  const plan = planPlacement(next, pieces);
  expect(plan.pieces.map((p) => p.id)).toEqual([1, 0]);
  expect(plan.starts.get(1)).toBe(0);
  expect(plan.starts.get(0)).toBeGreaterThan(0);
  expect(placedCount(plan, -1)).toBe(0);
  expect(placedCount(plan, plan.duration)).toBe(2);
  const ordered = planPlacement([...pieces].reverse(), []);
  expect(ordered.pieces.map((p) => p.id)).toEqual(pieces.map((p) => p.id));
  const sameStep = pieces.map((p) => ({ ...p, step: 0 }));
  expect(planPlacement(sameStep.reverse(), []).pieces.map((p) => p.pos[1] + 0)).toEqual([
    0, 0, -24, -24, -48, -48, -72, -72,
  ]);
});

test("dense steps stay fast, with a distinct start for every piece", () => {
  const seed = fixture().pieces[0];
  const pieces = Array.from({ length: 20000 }, (_, id) => ({ ...seed, id, pos: [id * 40, 0, 0] as Piece["pos"] }));
  const plan = planPlacement(pieces, []);
  expect(new Set(plan.starts.values()).size).toBe(pieces.length);
  expect(plan.duration).toBeLessThan(2.3);
});

test("live revisions place individually, pause, resume and skip; backward steps settle immediately", async ({
  page,
}) => {
  await site(page);
  const agp = await platform(page);
  agp.session("placing");
  agp.say("placing", "A tower");
  await page.goto("/?build=placing");
  await expect(page.locator(".thinking")).toBeVisible();
  const seed = fixture();
  const model = revised({
    ...seed,
    pieces: Array.from({ length: 100 }, (_, id) => ({
      ...seed.pieces[id % 8],
      id,
      step: Math.floor(id / 25),
      pos: [(id % 5) * 40, -Math.floor(id / 5) * 24, 0],
    })),
  });
  agp.share("placing", model);
  const viewer = page.locator(".viewer");
  await expect(viewer).toHaveAttribute("data-revision", model.revision);
  await page.getByRole("button", { name: "Pause placement", exact: true }).click();
  const count = Number(await viewer.getAttribute("data-placed"));
  expect(count).toBeLessThan(100);
  await page.waitForTimeout(250);
  await expect(viewer).toHaveAttribute("data-placed", String(count));
  const png = async () => {
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Share", exact: true }).click();
    await page.getByRole("menuitem", { name: "Download image", exact: true }).click();
    return readFile(await (await download).path());
  };
  const duringPlacement = await png();
  await expect(viewer).toHaveAttribute("data-placed", String(count));
  await page.getByRole("button", { name: "Resume placement", exact: true }).click();
  await expect.poll(async () => Number(await viewer.getAttribute("data-placed"))).toBeGreaterThan(count);
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(viewer).toHaveAttribute("data-placing", "false");
  expect(await png()).toEqual(duringPlacement);
  await expect(page.locator(".thinking")).toHaveCount(0);
  // Only the new/recolored piece is animated in the next revision.
  const changed = revised({ ...model, pieces: model.pieces.map((p, i) => (i === 99 ? { ...p, color: 1 } : p)) });
  agp.share("placing", changed);
  await expect(viewer).toHaveAttribute("data-revision", changed.revision);
  await expect(viewer).toHaveAttribute("data-placement-total", "1");
  await page.locator('.timeline input[type="range"]').fill("0");
  await expect(viewer).toHaveAttribute("data-placing", "false");
});

test("reduced motion completes placement and sound is on by default, remembering an explicit mute", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await site(page);
  const agp = await platform(page);
  agp.session("quiet");
  agp.say("quiet", "A tower");
  agp.share("quiet", fixture());
  await page.goto("/?build=quiet");
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", fixture().revision);
  await expect(page.locator(".placement-hud")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Mute brick sounds", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Mute brick sounds", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Enable brick sounds", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});
