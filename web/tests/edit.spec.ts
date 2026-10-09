import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { applyEdits, pivot } from "../src/edits";
import { extent, replacementOffset, searchParts } from "../src/partCatalog";
import { boxPart, fixture, part, partsCatalog, revised, site } from "./fixtures";
import { platform } from "./platform";

async function open(page: Page) {
  const build = fixture();
  await site(page, [build]);
  await page.goto(`/?showcase=${build.id}`);
  await expect(page.locator(".viewer")).toHaveAttribute("data-render-state", "ready");
  return build;
}

const canvasCenter = async (page: Page) => {
  const box = (await page.locator(".viewer-canvas").boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

test("Edit explains active building and unlocks after a new revision when earlier edits were cleared", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await site(page);
  const agp = await platform(page);
  const model = fixture();
  agp.session("unlock", "idle");
  agp.say("unlock", "A tower");
  agp.share("unlock", model);
  await page.addInitScript((revision) => {
    localStorage.setItem(
      "brickyard.edits",
      JSON.stringify({
        unlock: { revision, edits: [{ kind: "move", ids: [0], by: [20, 0, 0] }] },
      }),
    );
  }, model.revision);
  await page.goto("/?build=unlock");
  const edit = page.getByRole("button", { name: "Edit", exact: true });
  const hint = page.locator(".edit-availability");
  await edit.click();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", model.revision);

  agp.state("unlock", "running");
  await expect(edit).toBeDisabled();
  await expect(edit).toHaveAccessibleDescription("Edit after Holo stops");
  await expect(hint).toBeVisible();
  await expect(hint).toHaveText("Edit after Holo stops");
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeEnabled();
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  await page.screenshot({ path: testInfo.outputPath("edit-building-desktop.png") });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(hint).toBeHidden();
  await page.getByRole("button", { name: "View controls" }).click();
  await expect(hint).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath("edit-building-mobile.png") });

  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect.poll(() => agp.posted("/force_answer")).toHaveLength(1);
  await expect(edit).toBeDisabled();
  agp.answer("unlock", "Stopped here.");
  await expect(edit).toBeEnabled();
  await expect(hint).toHaveCount(0);
  agp.state("unlock", "running");
  await expect(edit).toBeDisabled();

  const next = revised({ ...model, pieces: model.pieces.map((p) => ({ ...p, color: 4 })) });
  agp.share("unlock", next);
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", next.revision);
  await expect(edit).toBeDisabled();
  agp.answer("unlock", "The tower is ready.");
  await expect(edit).toBeEnabled();
  await expect(hint).toHaveCount(0);
  await expect(page.locator(".edit-notice")).toHaveCount(0);
  await edit.click();
  await expect(page.getByRole("toolbar", { name: "Edit mode" })).toBeVisible();
});

test("Edit preserves stale changes and points to the existing Discard action", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await site(page);
  const agp = await platform(page);
  const model = fixture();
  const next = revised({ ...model, pieces: model.pieces.map((p) => ({ ...p, color: 4 })) });
  agp.session("stale", "idle");
  agp.share("stale", next);
  await page.addInitScript((revision) => {
    localStorage.setItem(
      "brickyard.edits",
      JSON.stringify({
        stale: { revision, edits: [{ kind: "move", ids: [0], by: [20, 0, 0] }] },
      }),
    );
  }, model.revision);
  await page.goto("/?build=stale");
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", next.revision);
  const edit = page.getByRole("button", { name: "Edit", exact: true });
  await expect(edit).toBeDisabled();
  await expect(edit).toHaveAccessibleDescription("Discard earlier edits to edit");
  await expect(page.locator(".edit-availability")).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("brickyard.edits")!).stale.edits)).toHaveLength(1);
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(edit).toBeEnabled();
  await expect(page.locator(".edit-availability")).toHaveCount(0);
  await expect(page.locator(".edit-notice")).toHaveCount(0);
});

test("undoing every edit unlocks later revisions without carrying their old redo history", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await site(page);
  const agp = await platform(page);
  const model = fixture();
  agp.session("undone", "idle");
  agp.share("undone", model);
  await page.addInitScript((revision) => {
    if (localStorage.getItem("brickyard.edits")) return;
    localStorage.setItem(
      "brickyard.edits",
      JSON.stringify({
        undone: { revision, edits: [{ kind: "move", ids: [0], by: [20, 0, 0] }] },
      }),
    );
  }, model.revision);
  await page.goto("/?build=undone");
  const edit = page.getByRole("button", { name: "Edit", exact: true });
  await edit.click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByRole("button", { name: "Redo", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.getByRole("toolbar", { name: "Edit mode" })).toContainText("1 change");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", model.revision);
  const next = revised({ ...model, pieces: model.pieces.map((p) => ({ ...p, color: 4 })) });
  agp.share("undone", next);
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", next.revision);
  await expect(edit).toBeEnabled();
  await expect(page.getByRole("button", { name: "Redo", exact: true })).toBeDisabled();
  await expect(page.locator(".edit-availability")).toHaveCount(0);

  // Empty records from older saved edit formats must not lock the current model.
  await page.evaluate(() => {
    localStorage.setItem("brickyard.edits", JSON.stringify({ undone: { revision: "older-revision", edits: [] } }));
  });
  await page.reload();
  await expect(edit).toBeEnabled();
  await expect(page.locator(".edit-availability")).toHaveCount(0);
});

test("edits move, turn and delete pieces in order, skipping pieces already gone", () => {
  const [a, b] = fixture().pieces;
  const edited = applyEdits(
    [a, b],
    [
      { kind: "move", ids: [0], by: [20, -8, 0] },
      { kind: "rotate", ids: [0], turns: 1, about: [20, 0] },
      { kind: "delete", ids: [1] },
      { kind: "move", ids: [0, 1], by: [20, 0, 0] },
    ],
  );
  expect(edited).toEqual([{ ...a, pos: [40, -8, 0], rot: [0, 0, 1, 0, 1, 0, -1, 0, 0] }]);
  expect(applyEdits(edited, [{ kind: "rotate", ids: [0], turns: -1, about: [40, 0] }])[0].rot).toEqual(a.rot);
});

test("a group turns a quarter about its middle, on the half-stud grid", () => {
  const [a, b] = fixture().pieces;
  expect(pivot([a, b])).toEqual([20, 0]);
  const [ta, tb] = applyEdits([a, b], [{ kind: "rotate", ids: [0, 1], turns: 1, about: pivot([a, b]) }]);
  expect([ta.pos, tb.pos]).toEqual([
    [20, 0, 20],
    [20, 0, -20],
  ]);
  const back = applyEdits([ta, tb], [{ kind: "rotate", ids: [0, 1], turns: -1, about: pivot([ta, tb]) }]);
  expect(back.map((p) => [p.pos, p.rot])).toEqual([
    [[0, 0, 0], a.rot],
    [[40, 0, 0], b.rot],
  ]);
});

test("edit mode selects the piece under the pointer and saves its edits in this browser", async ({ page }) => {
  const build = await open(page);
  const pieces = page.locator(".scrub-label span");
  await expect(pieces).toHaveText(/^8 pieces /);

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("toolbar", { name: "Edit mode" })).toContainText("Click a piece to select it");
  const center = await canvasCenter(page);
  await page.mouse.move(center.x, center.y);
  await expect(page.locator(".viewer-canvas")).toHaveCSS("cursor", "pointer");
  await page.mouse.click(center.x, center.y);
  const panel = page.getByRole("dialog", { name: "Selection" });
  await expect(panel).toContainText(/test-brick · (Red|Yellow|Blue|Green)/);

  await page.keyboard.press("ArrowRight");
  await panel.getByRole("button", { name: "Turn right" }).click();
  await expect(page.getByRole("toolbar", { name: "Edit mode" })).toContainText("2 changes");
  await panel.getByRole("button", { name: "Delete" }).click();
  await expect(panel).toBeHidden();
  await expect(pieces).toHaveText(/^7 pieces /);
  await expect(page.locator(".viewer")).not.toHaveAttribute("data-revision", build.revision);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(pieces).toHaveText(/^8 pieces /);
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(pieces).toHaveText(/^7 pieces /);

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await page.getByRole("menuitem", { name: "Download model (.ldr)" }).click();
  const ldr = await readFile(await (await download).path(), "utf8");
  expect(ldr.split("\n").filter((line) => line.startsWith("1 "))).toHaveLength(7);

  await page.reload();
  await expect(page.locator(".viewer")).toHaveAttribute("data-render-state", "ready");
  await expect(pieces).toHaveText(/^7 pieces /);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(pieces).toHaveText(/^8 pieces /);
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", build.revision);
  expect(await page.evaluate(() => localStorage.getItem("brickyard.edits"))).toBe("{}");
});

test("Shift-click selects several pieces, and one edit changes them all", async ({ page }) => {
  await open(page);
  const pieces = page.locator(".scrub-label span");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const center = await canvasCenter(page);
  const panel = page.getByRole("dialog", { name: "Selection" });
  await page.mouse.click(center.x, center.y);
  await expect(panel).toContainText(/test-brick · (Red|Yellow|Blue|Green)/);
  await page.keyboard.down("Shift");
  await page.mouse.click(center.x - 150, center.y + 150);
  await page.keyboard.up("Shift");
  await expect(panel).toContainText("2 pieces");

  await page.keyboard.press("PageUp");
  await panel.getByRole("button", { name: "Delete" }).click();
  await expect(pieces).toHaveText(/^6 pieces /);
  await expect(page.getByRole("toolbar", { name: "Edit mode" })).toContainText("2 changes");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(pieces).toHaveText(/^8 pieces /);

  await page.mouse.click(center.x, center.y);
  await expect(panel).toContainText(/test-brick · (Red|Yellow|Blue|Green)/);
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
});

test("↑ ↓ lift and lower a piece, W and S slide it along the view, as do the panel's buttons", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const center = await canvasCenter(page);
  await page.mouse.click(center.x, center.y);
  const panel = page.getByRole("dialog", { name: "Selection" });
  await expect(panel).toContainText(/test-brick/);

  for (const key of ["ArrowUp", "ArrowDown", "w", "s", "ArrowLeft", "d"]) await page.keyboard.press(key);
  for (const name of ["Move up a plate", "Move away", "Move closer"]) {
    await panel.getByRole("button", { name: new RegExp(`^${name}`) }).click();
  }
  await expect(page.getByRole("toolbar", { name: "Edit mode" })).toContainText("9 changes");
  const moves = await page.evaluate(() =>
    Object.values(JSON.parse(localStorage.getItem("brickyard.edits")!) as Record<string, { edits: { by: number[] }[] }>)
      .flatMap((saved) => saved.edits)
      .map((edit) => edit.by),
  );
  // Up and down are vertical only; every other move stays level and goes somewhere.
  const lift = moves.map(([x, y, z]) => (!x && !z ? Math.sign(y) : 0));
  expect(lift).toEqual([-1, 1, 0, 0, 0, 0, -1, 0, 0]);
  for (const [x, y, z] of moves.filter((_, i) => !lift[i]))
    expect([y, Math.abs(x) + Math.abs(z) > 0]).toEqual([0, true]);
  // Away and closer are opposite, whether keyed or clicked.
  const opposite = (v: number[]) => v.map((c) => -c + 0);
  expect(moves[3]).toEqual(opposite(moves[2]));
  expect(moves[7]).toEqual(moves[2]);
  expect(moves[8]).toEqual(moves[3]);
});

test("the selection takes a new color, the model's own colors listed first", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const center = await canvasCenter(page);
  await page.mouse.click(center.x, center.y);
  const panel = page.getByRole("dialog", { name: "Selection" });
  const label = await panel.locator("b").textContent();
  const next = label!.endsWith("Green") ? "Red" : "Green";
  await panel.getByRole("button", { name: /Change color/ }).click();
  const colors = panel.getByRole("listbox", { name: "Colors" });
  await expect(colors.locator("section").first()).toContainText("In this model");
  await colors.getByRole("option", { name: next }).first().click();
  await expect(colors).toBeHidden();
  await expect(panel.locator("b")).toHaveText(`test-brick · ${next}`);
  await expect(page.getByRole("toolbar", { name: "Edit mode" })).toContainText("1 change");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await page.getByRole("menuitem", { name: "Download model (.ldr)" }).click();
  const ldr = await readFile(await (await download).path(), "utf8");
  const code = { Red: "4", Green: "2" }[next];
  expect(ldr.split("\n").filter((line) => line.startsWith(`1 ${code} `))).toHaveLength(3);

  await page.getByRole("button", { name: "Parts", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("not checked against BrickLink");
  await expect(page.getByRole("row", { name: `3× test-brick ${next}` })).toBeVisible();
});

test("duplicates take new ids after the model's, beside their originals, and come last", () => {
  const [a, b, c] = fixture().pieces;
  const edited = applyEdits(
    [a, b, c],
    [
      { kind: "duplicate", ids: [0, 1], by: [80, 0, 0], first: 3 },
      { kind: "move", ids: [3], by: [0, -8, 0] },
      { kind: "delete", ids: [1] },
    ],
  );
  expect(edited.map((p) => [p.id, p.pos[0], p.pos[1] + 0])).toEqual([
    [0, 0, 0],
    [2, 0, -24],
    [3, 80, -8],
    [4, 120, 0],
  ]);
});

test("Shift-drag selects every piece in the box, and ⌘D duplicates the selection beside it", async ({ page }) => {
  await open(page);
  const pieces = page.locator(".scrub-label span");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const box = (await page.locator(".viewer-canvas").boundingBox())!;
  await page.keyboard.down("Shift");
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
  await expect(page.locator(".select-box")).toBeVisible();
  await page.mouse.move(box.x + box.width - 10, box.y + box.height - 10, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect(page.locator(".select-box")).toBeHidden();
  const panel = page.getByRole("dialog", { name: "Selection" });
  await expect(panel.locator("b")).toHaveText("8 pieces");

  await page.keyboard.press("ControlOrMeta+d");
  await expect(pieces).toHaveText(/^16 pieces /);
  await expect(panel.locator("b")).toHaveText("8 pieces");
  await expect(page.getByRole("toolbar", { name: "Edit mode" })).toContainText("1 change");
  await panel.getByRole("button", { name: "Duplicate" }).click();
  await expect(pieces).toHaveText(/^24 pieces /);

  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(pieces).toHaveText(/^8 pieces /);
  await expect(panel).toBeHidden();
});

test("the ? key lists every shortcut", async ({ page }) => {
  await open(page);
  const help = page.getByRole("dialog", { name: "Shortcuts" });
  await page.keyboard.press("?");
  await expect(help).toContainText("Duplicate beside it");
  await expect(help).toContainText("Add the pieces seen in a box");
  await expect(help).toContainText("Release the mouse; again to stop walking");
  await page.keyboard.press("Escape");
  await expect(help).toBeHidden();
  await page.keyboard.press("?");
  await expect(help).toBeVisible();
  await page.keyboard.press("?");
  await expect(help).toBeHidden();
});

test("Replace searches parts, previews them in the selection's color and swaps the piece, keeping its bottom", async ({
  page,
}) => {
  const build = await open(page);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const center = await canvasCenter(page);
  await page.mouse.click(center.x, center.y);
  const panel = page.getByRole("dialog", { name: "Selection" });
  await panel.getByRole("button", { name: "Replace part" }).click();
  const results = panel.getByRole("listbox", { name: "Parts" });
  await expect(results.locator("section").first()).toContainText("In this model");
  await expect(results.getByRole("option", { name: /test-brick/ })).toHaveAttribute("aria-selected", "true");

  await panel.getByRole("searchbox", { name: "Search parts" }).fill("plate 2x2");
  const plate = results.getByRole("option", { name: "Test Plate 2 x 2 (test-plate)" });
  await expect(results.getByRole("option")).toHaveCount(1);
  await expect(plate.locator("img")).toHaveAttribute("src", /^data:image\/png/);
  await plate.click();

  await expect(results).toBeHidden();
  await expect(panel.locator("b")).toHaveText(/^Test Plate 2 x 2 · /);
  await expect(page.getByRole("toolbar", { name: "Edit mode" })).toContainText("1 change");
  await expect(page.locator(".viewer")).toHaveAttribute("data-render-state", "ready");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await page.getByRole("menuitem", { name: "Download model (.ldr)" }).click();
  const ldr = await readFile(await (await download).path(), "utf8");
  const replaced = ldr.split("\n").filter((line) => line.endsWith(" test-plate.dat"));
  expect(replaced).toHaveLength(1);
  // The plate sits where the brick's bottom was: 16 LDraw units lower than the brick's top.
  const [, , x, y] = replaced[0].split(" ").map(Number);
  expect(build.pieces.some((p) => p.pos[0] === x && p.pos[1] + 16 === y)).toBe(true);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(panel.locator("b")).toHaveText(/^test-brick · /);
});

test("a replaced piece keeps its bottom and first stud, turned with the piece", () => {
  const brick = fixture().pieces[0];
  const tile = boxPart("t.dat", "Tile 1 x 1", 1, 1, 8);
  expect(extent(part)).toEqual({ lo: [-20, 0, -20], hi: [20, 24, 20] });
  expect(replacementOffset(brick, part, tile)).toEqual([-10, 16, -10]);
  // A quarter turn about the vertical axis: local x runs along the model's z.
  const turned = { ...brick, rot: [0, 0, 1, 0, 1, 0, -1, 0, 0] as typeof brick.rot };
  expect(replacementOffset(turned, part, tile)).toEqual([-10, 16, 10]);
  const [edited] = applyEdits([brick], [{ kind: "replace", ids: [0], part: "t.dat", by: [[-10, 16, -10]] }]);
  expect(edited).toMatchObject({ part: "t.dat", pos: [brick.pos[0] - 10, brick.pos[1] + 16, -10] });
});

test("part search matches numbers and title words, sizes written either way", () => {
  const parts = partsCatalog.parts;
  expect(searchParts(parts, "2 x 2").map((p) => p.part)).toEqual(["test-plate.dat"]);
  expect(searchParts(parts, "test-t").map((p) => p.part)).toEqual(["test-tile.dat"]);
  expect(searchParts(parts, "test")).toHaveLength(2);
  expect(searchParts(parts, "brick")).toHaveLength(0);
});
