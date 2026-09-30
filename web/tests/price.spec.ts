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

test("the estimate sits beside the piece count and opens its details and upload list", async ({ page }) => {
  await open(page, TABLE);
  const trigger = page.getByRole("button", { name: /^≈/ });
  await expect(trigger).toHaveText(/≈ 4\s€/);
  await trigger.click();
  const details = page.getByRole("dialog", { name: "Price estimate" });
  await expect(details).toContainText(/≈ 4,10\s€/);
  await expect(details).toContainText("Priced 6 of 8 pieces; 2 are not sold there in their color.");
  await expect(details).toContainText("2 of them are out of stock right now.");
  await expect(details.getByRole("link", { name: /Open Pick a Brick/ })).toHaveAttribute(
    "href",
    "https://www.lego.com/fr-fr/pick-and-build/pick-a-brick",
  );

  const download = page.waitForEvent("download");
  await details.getByRole("button", { name: "Download list for Pick a Brick" }).click();
  const csv = await readFile(await (await download).path(), "utf8");
  expect(csv).toBe("elementId,quantity\r\n300121,2\r\n300124,2\r\n300123,2\r\n");
  await page.keyboard.press("Escape");
  await expect(details).toBeHidden();
});

test("the estimate follows edits, and stays away without a price table", async ({ page }) => {
  await open(page, TABLE);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const box = (await page.locator(".viewer-canvas").boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByRole("dialog", { name: "Selection" }).getByRole("button", { name: "Delete" }).click();
  await expect(page.locator(".chip").first()).toHaveText("7 pieces");
  await page.getByRole("button", { name: /^≈/ }).click();
  await expect(page.getByRole("dialog", { name: "Price estimate" })).toContainText(
    "Includes your edits in this browser.",
  );

  await page.unrouteAll({ behavior: "ignoreErrors" });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await open(page, null);
  await expect(page.getByRole("button", { name: /^≈/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});
