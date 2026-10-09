import { expect, test, type Locator } from "@playwright/test";
import { gzipSync } from "node:zlib";
import type { PriceTable } from "../src/pickabrick";
import { fixture, site } from "./fixtures";

const BRANDS = /lego|duplo|minecraft|mojang|pick a brick/i;
const tower = { ...fixture(), id: "tower" };
const TABLE: PriceTable = {
  source: "store",
  locale: "en-US",
  currency: "USD",
  fetched_at: 1,
  prices: { "test-brick:4": [10, 1, "300121"] },
};

const unbranded = async (where: Locator) => {
  await expect(where).toBeVisible();
  expect(await where.innerText()).not.toMatch(BRANDS);
};

test("no brand name shows on the home page, the credits, the sign-in, a public build or the shop", async ({ page }) => {
  await site(page, [], null);
  await page.route("https://blob.test/**", (route) =>
    route.fulfill({ headers: { "access-control-allow-origin": "*" }, body: gzipSync(JSON.stringify(tower)) }),
  );
  const entry = {
    id: tower.id,
    name: tower.name,
    pieces: 8,
    steps: 4,
    author: "Ada L.",
    owner: "u-ada",
    published: 1,
    thumbnail: null,
    build: "https://blob.test/builds/tower/build.json.gz",
  };
  await page.route("**/api/builds*", (route) =>
    route.fulfill({ json: new URL(route.request().url()).searchParams.has("id") ? entry : [entry] }),
  );
  await page.route("**/pick-a-brick.json", (route) => route.fulfill({ json: TABLE }));

  await page.goto("/");
  await expect(page.locator(".tile", { hasText: tower.name })).toBeVisible();
  await unbranded(page.locator("body"));
  const footer = page.locator("footer.site-footer");
  await expect(footer.getByRole("link", { name: "Docs" })).toHaveAttribute("href", "https://hub.hcompany.ai/");
  await expect(footer.getByRole("link", { name: "H Platform" })).toHaveAttribute(
    "href",
    "https://platform.hcompany.ai",
  );
  await expect(footer.getByRole("link", { name: "Terms of Service" })).toHaveAttribute(
    "href",
    /hcompany\.ai\/terms-of-use$/,
  );
  await expect(footer.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute(
    "href",
    /hcompany\.ai\/privacy-policy$/,
  );
  await footer.getByRole("button", { name: "Credits" }).click();
  const credits = page.getByRole("dialog", { name: "Credits" });
  await expect(credits).toContainText("LDraw");
  await unbranded(credits);
  await page.keyboard.press("Escape");

  await page.locator("header").getByRole("button", { name: "Sign in" }).click();
  const signIn = page.getByRole("dialog", { name: "Sign in to build" });
  await expect(signIn).toContainText("By signing in you agree to the Terms and Privacy Policy.");
  await unbranded(signIn);
  await page.keyboard.press("Escape");

  await page.goto("/?public=tower");
  await expect(page.locator(".viewer")).toHaveAttribute("data-render-state", "ready");
  await unbranded(page.locator("body"));
  await page.getByRole("button", { name: /^Buy bricks/ }).click();
  const shop = page.getByRole("dialog", { name: "Build it for real" });
  await expect(shop.getByRole("region", { name: "Official parts store" })).toBeVisible();
  await unbranded(shop);
});
