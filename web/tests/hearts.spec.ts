import { expect, test, type Page } from "@playwright/test";
import { ACCOUNT, site } from "./fixtures";

const entry = (id: string, name: string) => ({
  id,
  name,
  prompt: name,
  pieces: 120,
  steps: 4,
  author: "Maxime",
  owner: "u-max",
  published: Math.floor(Date.now() / 1000) - 3600,
  thumbnail: null,
  build: `https://blob.test/builds/${id}/build.json.gz`,
});

/** Two public builds, one already hearted by two people; hearts are kept per user, as the API does. */
async function hearts(page: Page, mine: string[] = []) {
  const given = new Map<string, Set<string>>([["hut", new Set(["u-max", "u-other"])]]);
  for (const id of mine) (given.get(id) ?? given.set(id, new Set()).get(id)!).add(ACCOUNT.user.id);
  const calls: string[] = [];
  await page.route("**/api/builds*", (route) => route.fulfill({ json: [entry("hut", "Hut"), entry("boat", "Boat")] }));
  await page.route("**/api/hearts*", (route) => {
    const request = route.request();
    const signed = request.headers()["authorization"] === `Bearer ${ACCOUNT.pass}`;
    const id = new URL(request.url()).searchParams.get("id") ?? request.postDataJSON?.()?.id;
    if (request.method() === "PUT") {
      calls.push(`PUT ${id}`);
      (given.get(id) ?? given.set(id, new Set()).get(id)!).add(ACCOUNT.user.id);
      return route.fulfill({ status: 204 });
    }
    if (request.method() === "DELETE") {
      calls.push(`DELETE ${id}`);
      given.get(id)?.delete(ACCOUNT.user.id);
      return route.fulfill({ status: 204 });
    }
    const counts = Object.fromEntries([...given].filter(([, who]) => who.size).map(([id, who]) => [id, who.size]));
    const yours = signed ? [...given].filter(([, who]) => who.has(ACCOUNT.user.id)).map(([id]) => id) : [];
    return route.fulfill({ json: { counts, mine: yours } });
  });
  return calls;
}

const card = (page: Page, name: string) =>
  page.getByRole("region", { name: "Public builds" }).locator(".tile-frame", { hasText: name });

test("public cards show their hearts; a signed-in user gives and takes one back, and the count follows", async ({
  page,
}) => {
  await site(page);
  const calls = await hearts(page);
  await page.goto("/");
  const hut = card(page, "Hut").getByRole("button", { name: "Heart this build" });
  const boat = card(page, "Boat").getByRole("button", { name: "Heart this build" });
  await expect(hut).toHaveText("2");
  await expect(boat).toHaveText("");
  await expect(card(page, "Hut").locator(".tile-caption b")).toHaveText("Hut");

  await hut.click();
  const given = card(page, "Hut").getByRole("button", { name: "Remove your heart" });
  await expect(given).toHaveText("3");
  await expect(given).toHaveAttribute("aria-pressed", "true");
  await given.click();
  await expect(hut).toHaveText("2");
  expect(calls).toEqual(["PUT hut", "DELETE hut"]);

  await page.reload();
  await expect(card(page, "Hut").getByRole("button", { name: "Heart this build" })).toHaveText("2");
});

test("a heart that fails to save is taken back", async ({ page }) => {
  await site(page);
  await hearts(page);
  await page.route("**/api/hearts", (route) =>
    route.request().method() === "PUT" ? route.fulfill({ status: 500 }) : route.fallback(),
  );
  await page.goto("/");
  const hut = card(page, "Hut").getByRole("button", { name: "Heart this build" });
  await expect(hut).toHaveText("2");
  await hut.click();
  await expect(hut).toHaveText("2");
  await expect(hut).toHaveAttribute("aria-pressed", "false");
});

test("signed out, a heart asks to sign in", async ({ page }) => {
  await site(page, [], null);
  const calls = await hearts(page);
  await page.goto("/");
  const hut = card(page, "Hut").getByRole("button", { name: "Heart this build" });
  await expect(hut).toHaveText("2");
  await hut.click();
  await expect(page.getByRole("dialog")).toContainText(/sign in/i);
  expect(calls).toEqual([]);
});
