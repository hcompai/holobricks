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
  const pieces = page.locator(".chip").first();
  await expect(pieces).toHaveText("8 pieces");

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("toolbar", { name: "Edit mode" })).toContainText("Click a piece to select it");
  const center = await canvasCenter(page);
  await page.mouse.move(center.x, center.y);
  await expect(page.locator(".viewer-canvas")).toHaveCSS("cursor", "pointer");
  await page.mouse.click(center.x, center.y);
  const panel = page.getByRole("dialog", { name: "Selection" });
  await expect(panel).toContainText(/test-brick · color \d+/);

  await page.keyboard.press("ArrowRight");
  await panel.getByRole("button", { name: "Turn right" }).click();
  await expect(page.getByRole("toolbar", { name: "Edit mode" })).toContainText("2 changes");
  await panel.getByRole("button", { name: "Delete" }).click();
  await expect(panel).toBeHidden();
  await expect(pieces).toHaveText("7 pieces");
  await expect(page.locator(".viewer")).not.toHaveAttribute("data-revision", build.revision);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(pieces).toHaveText("8 pieces");
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(pieces).toHaveText("7 pieces");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download" }).click();
  await page.getByRole("menuitem", { name: "Download .ldr" }).click();
  const ldr = await readFile(await (await download).path(), "utf8");
  expect(ldr.split("\n").filter((line) => line.startsWith("1 "))).toHaveLength(7);

  await page.reload();
  await expect(page.locator(".viewer")).toHaveAttribute("data-render-state", "ready");
  await expect(pieces).toHaveText("7 pieces");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("button", { name: "Reset" }).click();
  await expect(pieces).toHaveText("8 pieces");
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", build.revision);
  expect(await page.evaluate(() => localStorage.getItem("brickyard.edits"))).toBe("{}");
});

test("Shift-click selects several pieces, and one edit changes them all", async ({ page }) => {
  await open(page);
  const pieces = page.locator(".chip").first();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const center = await canvasCenter(page);
  const panel = page.getByRole("dialog", { name: "Selection" });
  await page.mouse.click(center.x, center.y);
  await expect(panel).toContainText(/test-brick · color \d+/);
  await page.keyboard.down("Shift");
  await page.mouse.click(center.x - 150, center.y + 150);
  await page.keyboard.up("Shift");
  await expect(panel).toContainText("2 pieces");

  await page.keyboard.press("PageUp");
  await panel.getByRole("button", { name: "Delete" }).click();
  await expect(pieces).toHaveText("6 pieces");
  await expect(page.getByRole("toolbar", { name: "Edit mode" })).toContainText("2 changes");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(pieces).toHaveText("8 pieces");

  await page.mouse.click(center.x, center.y);
  await expect(panel).toContainText(/test-brick · color \d+/);
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
});

test("walk mode explains its controls and Escape leaves it", async ({ page }) => {
  await open(page);
  const walk = page.getByRole("button", { name: "Walk", exact: true });
  await walk.click();
  await expect(walk).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".walk-hint")).toContainText("Click to walk");
  await page.keyboard.press("Escape");
  await expect(walk).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".walk-hint")).toBeHidden();
});
