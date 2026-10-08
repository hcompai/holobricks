import { expect, test, type Page } from "@playwright/test";
import { gzipSync } from "node:zlib";
import type { Build } from "../src/model";
import { ACCOUNT, fixture, site } from "./fixtures";

const BLOB = "https://blob.test";
const tower = { ...fixture(), id: "tower", name: "Ada's tower" };
const castle = { ...fixture(), id: "castle", name: "Castle" };

const shown = (page: Page, revision: string) =>
  expect(page.locator(".viewer")).toHaveAttribute("data-revision", revision);

/** The public library holding Ada's tower, as `build` and under `author`. */
async function library(page: Page, build: Build = tower, author = "Ada Lovelace") {
  const published = {
    id: tower.id,
    name: tower.name,
    pieces: tower.pieces.length,
    author,
    owner: "u-ada",
    published: 1,
    thumbnail: null,
    build: `${BLOB}/builds/tower/build.json.gz`,
  };
  await page.route(`${BLOB}/builds/tower/build.json.gz`, (route) =>
    route.fulfill({ headers: { "access-control-allow-origin": "*" }, body: gzipSync(JSON.stringify(build)) }),
  );
  await page.route("**/api/builds*", (route) => {
    const id = new URL(route.request().url()).searchParams.get("id");
    if (!id) return route.fulfill({ json: [published] });
    return id === tower.id ? route.fulfill({ json: published }) : route.fulfill({ status: 404, json: {} });
  });
}

/** Every request that needs an account: the Agents API, a pass or a key, or the owner-only APIs. */
function accountRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    const headers = request.headers();
    if (
      url.hostname === "agp.eu.hcompany.ai" ||
      headers.authorization ||
      headers["x-agents-key"] ||
      /^\/api\/(forks|names|projects|imports)/.test(url.pathname)
    )
      seen.push(`${request.method()} ${request.url()}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error" && /sign in|401/i.test(message.text())) seen.push(message.text());
  });
  return seen;
}

test("signed out, home lists the public builds and the showcases, and each opens in the viewer", async ({ page }) => {
  await site(page, [castle], null);
  await library(page);
  const asked = accountRequests(page);
  await page.goto("/");

  const everyone = page.getByRole("region", { name: "Public builds" });
  await expect(everyone.locator(".tile", { hasText: tower.name })).toContainText("by Ada Lovelace");
  await expect(everyone.locator(".tile", { hasText: castle.name })).toContainText("Showcase");
  await expect(page.getByRole("region", { name: "Your builds" })).toHaveCount(0);
  await everyone.locator(".tile", { hasText: castle.name }).click();
  await expect(page).toHaveURL(/\?showcase=castle$/);
  await shown(page, castle.revision);
  await expect(page.locator(".gallery-note")).toHaveText(/^Showcase · Sign in to fork/);
  expect(asked).toEqual([]);
});

test("signed out, a public build's link opens it read only, exports it, and forking asks to sign in", async ({
  page,
}) => {
  await site(page, [], null);
  await library(page);
  const asked = accountRequests(page);
  await page.goto("/?public=tower");
  await shown(page, tower.revision);
  await expect(page.locator(".gallery-note")).toHaveText(/^By Ada Lovelace · Sign in to fork/);
  await expect(page.getByRole("textbox")).toHaveCount(0);

  await page.getByRole("button", { name: "Share", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: /Publish/ })).toHaveCount(0);
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Download model (.ldr)" }).click();
  expect((await download).suggestedFilename()).toBe("Ada's tower.ldr");

  const dialog = page.getByRole("dialog", { name: "Sign in to build" });
  await page.getByRole("button", { name: "Fork", exact: true }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.locator(".gallery-note").getByRole("button", { name: "Sign in" }).click();
  await expect(dialog).toBeVisible();
  expect(asked).toEqual([]);
});

test("a public build published with its chat shows none of it, and an author with no name shows no byline", async ({
  page,
}) => {
  const chatty: Build = {
    ...tower,
    messages: [
      { role: "user", text: "My secret request", images: [`${BLOB}/builds/tower/images/1.png`] },
      { role: "assistant", text: "Here is your secret tower.", images: [] },
    ],
  };
  await site(page, [], null);
  await library(page, chatty, "");
  await page.goto("/");
  const tile = page.getByRole("region", { name: "Public builds" }).locator(".tile", { hasText: tower.name });
  await expect(tile).toContainText("8 pieces");
  await expect(tile).not.toContainText("by");
  await tile.click();
  await shown(page, tower.revision);
  await expect(page.locator(".gallery-note")).toHaveText(/^Public build · Sign in to fork/);
  await expect(page.locator(".chat-log .msg")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("secret");
});

test("signed out, asking Holo for a build opens the sign-in, and the prompt waits in the composer once signed in", async ({
  page,
}) => {
  await site(page, [], null);
  const asked = accountRequests(page);
  await page.goto("/");
  const composer = page.getByPlaceholder("A red lighthouse on a rock… or drop a photo");
  const dialog = page.getByRole("dialog", { name: "Sign in to build" });
  await composer.fill("A blue windmill");
  await composer.press("Enter");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Continue with Google" })).toBeFocused();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(composer).toHaveValue("A blue windmill");
  await page.getByRole("button", { name: "A retro rocket" }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await composer.fill("A blue windmill");
  expect(asked).toEqual([]);

  await page.evaluate((account) => localStorage.setItem("brickyard.account", JSON.stringify(account)), ACCOUNT);
  await page.reload();
  await expect(page.getByRole("button", { name: "Account" })).toBeVisible();
  await expect(composer).toHaveValue("A blue windmill");
  expect(asked.filter((r) => r.startsWith("POST"))).toEqual([]);
});
