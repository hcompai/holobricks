import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { planPages } from "../src/instructions";
import type { Piece } from "../src/model";
import { fixture, site } from "./fixtures";

const brick = (id: number, step: number, plates: number): Piece => ({
  id,
  part: "test-brick",
  color: 4,
  step,
  pos: [id * 40, -plates * 8, 0],
  rot: [1, 0, 0, 0, 1, 0, 0, 0, 1],
});

test("pages split each step by height, bottom up, gathering small layers within a brick", () => {
  const many = (step: number, plates: number, count: number, from: number) =>
    Array.from({ length: count }, (_, i) => brick(from + i, step, plates));
  const pieces = [
    ...many(0, 0, 14, 0), // a full layer: its own page
    ...many(0, 3, 2, 100), // small layers one brick up, gathered...
    ...many(0, 4, 2, 200),
    ...many(0, 6, 2, 300), // ...but not beyond a brick's height
    ...many(1, 0, 1, 400), // a new step always starts a page
  ];
  const pages = planPages({ ...fixture(), pieces });
  expect(pages.map((p) => [p.step, p.pieces.length])).toEqual([
    [0, 14],
    [0, 4],
    [0, 2],
    [1, 1],
  ]);
});

test("the PDF starts on open and downloads in one click: a cover, a page per layer, then the parts list", async ({
  page,
}) => {
  const build = fixture();
  await site(page, [build]);
  await page.goto(`/?showcase=${build.id}`);
  await expect(page.locator(".viewer")).toHaveAttribute("data-render-state", "ready");
  const share = page.getByRole("button", { name: "Share", exact: true });
  await share.click();
  await expect(page.getByRole("menuitem")).toHaveText([
    "Copy link",
    "Share a GIF…",
    "Instructions (PDF)…",
    "Download model (.ldr)",
    "Download image",
  ]);
  await page.getByRole("menuitem", { name: "Instructions (PDF)…" }).click();
  const dialog = page.getByRole("dialog", { name: "Building instructions" });
  await expect(dialog).toContainText("A PDF of 4 pages for 8 pieces");
  await expect(dialog.getByRole("button", { name: /Making the instructions/ })).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();

  await share.click();
  await page.getByRole("menuitem", { name: "Instructions (PDF)…" }).click();
  const link = dialog.getByRole("link", { name: /Download instructions/ });
  await expect(link).toBeVisible({ timeout: 60000 });
  const download = page.waitForEvent("download");
  await link.click();
  const pdf = await readFile(await (await download).path(), "latin1");
  expect(pdf.startsWith("%PDF-")).toBe(true);
  expect(pdf.match(/\/Type \/Page\b/g)).toHaveLength(1 + 4 + 1);
  expect(pdf).toContain("A little LEGO tower: building instructions");
});
