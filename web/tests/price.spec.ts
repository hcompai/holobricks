import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { PriceTable } from "../src/pickabrick";
import { uploadLists } from "../src/pickabrick";
import { fixture, site } from "./fixtures";

/** Red and yellow in stock, blue out of stock, green not sold: the fixture's tower has two of each. */
const TABLE: PriceTable = {
  source: "LEGO Pick a Brick",
  locale: "fr-FR",
  currency: "EUR",
  fetched_at: Date.UTC(2026, 8, 30) / 1000,
  prices: {
    "test-brick:4": [125, 1, "300121"],
    "test-brick:14": [50, 1, "300124"],
    "test-brick:1": [30, 0, "300123"],
  },
};

async function open(page: Page, table: PriceTable | null) {
  const build = fixture();
  await site(page, [build]);
  await page.route("**/pick-a-brick.json", (route) =>
    // Without a table, a static host answers with the app's page, as Vite's preview and Vercel do.
    table ? route.fulfill({ json: table }) : route.fulfill({ contentType: "text/html", body: "<!doctype html>" }),
  );
  await page.goto(`/?showcase=${build.id}`);
  await expect(page.locator(".viewer")).toHaveAttribute("data-render-state", "ready");
}

test("upload lists hold at most 400 different elements each", () => {
  const lines = Array.from({ length: 401 }, (_, i) => ({ element: `${i}`, quantity: i + 1, cents: 1, inStock: true }));
  const files = uploadLists(lines);
  expect(files).toHaveLength(2);
  expect(files[0].split("\r\n")).toHaveLength(402);
  expect(files[1]).toBe("elementId,quantity\r\n400,401\r\n");
});

test("one sheet gets the bricks: its price in the header, BrickLink, a Pick a Brick list", async ({ page }) => {
  await open(page, TABLE);
  const trigger = page.getByRole("button", { name: /^Get the bricks/ });
  await expect(trigger).toHaveText(/^Get the bricks · ≈ 4\s€$/);
  await trigger.click();
  const sheet = page.getByRole("dialog", { name: "Build it for real" });
  await expect(sheet.getByRole("region", { name: "BrickLink" })).toContainText("The parts list was not checked.");
  const store = sheet.getByRole("region", { name: "Pick a Brick" });
  await expect(store).toContainText(
    /≈ 4,10\s€ on Pick a Brick for 6 of 8 pieces; 2 are not sold there in their color\. 2 are out of stock\./,
  );
  await expect(store.getByRole("link", { name: /Open Pick a Brick/ })).toHaveAttribute(
    "href",
    "https://www.lego.com/fr-fr/pick-and-build/pick-a-brick",
  );

  const download = page.waitForEvent("download");
  await store.getByRole("button", { name: "Download Pick a Brick list" }).click();
  const csv = await readFile(await (await download).path(), "utf8");
  expect(csv).toBe("elementId,quantity\r\n300121,2\r\n300124,2\r\n300123,2\r\n");

  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});

test("a hand-edited build prices its edits, cannot fill a BrickLink cart until reset, and no table shows no price", async ({
  page,
}) => {
  await open(page, TABLE);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const box = (await page.locator(".viewer-canvas").boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByRole("dialog", { name: "Selection" }).getByRole("button", { name: "Delete" }).click();
  await expect(page.locator(".scrub-label span")).toHaveText(/^7 pieces /);
  await page.getByRole("button", { name: /^Get the bricks/ }).click();
  const sheet = page.getByRole("dialog", { name: "Build it for real" });
  await expect(sheet.getByRole("region", { name: "Pick a Brick" })).toContainText("Includes your edits.");
  const bricklink = sheet.getByRole("region", { name: "BrickLink" });
  await expect(bricklink.getByRole("alert")).toContainText("Reset your edits");
  await bricklink.getByRole("button", { name: "Reset my edits" }).click();
  await expect(page.locator(".scrub-label span")).toHaveText(/^8 pieces /);
  await expect(bricklink.getByRole("alert")).toContainText("The parts list was not checked.");
  await expect(sheet.getByRole("region", { name: "Pick a Brick" })).not.toContainText("Includes your edits.");

  await page.unrouteAll({ behavior: "ignoreErrors" });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await open(page, null);
  await expect(page.getByRole("button", { name: /^Get the bricks/ })).toHaveText("Get the bricks");
  expect(errors).toEqual([]);
});
