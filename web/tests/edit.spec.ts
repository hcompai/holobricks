import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { applyEdits, pivot } from "../src/edits";
import { fixture, site } from "./fixtures";

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

test("the ? key or the Shortcuts button lists every shortcut", async ({ page }) => {
  await open(page);
  const help = page.getByRole("dialog", { name: "Shortcuts" });
  await page.keyboard.press("?");
  await expect(help).toContainText("Duplicate beside it");
  await expect(help).toContainText("Add the pieces seen in a box");
  await expect(help).toContainText("Release the mouse; again to stop walking");
  await page.keyboard.press("Escape");
  await expect(help).toBeHidden();
  await page.getByRole("button", { name: "Shortcuts" }).click();
  await expect(help).toBeVisible();
  await page.getByRole("button", { name: "Shortcuts" }).click();
  await expect(help).toBeHidden();
});
